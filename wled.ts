import { PanelEntity, RGBColor, WledDisplay } from './entities.ts';
import { Reading } from './readings.ts';
import { fillTemplate, PlaceholderValues } from './template.ts';
import { Decision } from './whatToShow.ts';

/**
 * Turns a decision into one `/json/state` body.
 *
 * The effect ids and slider meanings are from WLED's FX.cpp, by way of
 * `wled-now-playing/wled/effects.ts`, which has been run against the hardware.
 */

/**
 * `"Scrolling Text@!,Y Offset,Trail,Font size,Rotate,Gradient,Custom Font,Reverse"`
 * — so `sx` is the speed, `ix` the Y offset and `c2` the font size.
 */
const SCROLLING_TEXT_EFFECT_ID = 122;

/** `"Percent@!,% of fill,,,,One color"` — `ix` is the percentage, not `sx`. */
const PERCENT_EFFECT_ID = 98;

/**
 * `WLED_MAX_SEGNAME_LEN`: the buffer Scrolling Text copies the name into.
 * Exported because a custom display writes its own segment names and only the
 * editor's preview is in a position to say they will not fit.
 */
export const MAX_TEXT_LENGTH = 32;

/**
 * `EFFECT_FONT_SIZE` is `map(c2, 0, 255, 0, 4)` — five built-in fonts, with
 * thresholds at 64, 128, 192 and 255. Pinned rather than left alone, because
 * otherwise the panel uses whatever was last set in the device's own UI and
 * neither this service nor the editor's preview can know how much text fits.
 */
const FONT_SIZE_SLIDER = 0;

/** Font 0 is 4px wide, so eight glyphs are exactly the 32 columns of a panel. */
export const LETTER_WIDTH = 4;

/**
 * `EFFECT_Y_OFFSET`. Scrolling Text centres text that fits the segment, but at
 * 0 or 255 it then scrolls it *vertically* instead; 128 is the static middle.
 * Unpinned, a short reading like `18C` can sit there crawling upwards.
 */
const Y_OFFSET = 128;

/**
 * The 2D segment flags, pinned on every segment this file draws.
 *
 * `m12` is "Expand 1D FX": 1 is Bar, which paints one whole row per 1D pixel
 * and so fills bottom to top. `tp` transposes the segment, and because
 * `virtualWidth`/`virtualHeight` swap with it, that row becomes a column and
 * the effect's length becomes the panel's width — 32 steps across rather than
 * 8 up. `rY` is applied before the swap, so it is `rY` and not `rev` that
 * decides which end fills first: set, the bar runs left to right.
 */
const BAR_GEOMETRY = { m12: 1, tp: true, rY: true };

/**
 * Text is drawn by a native 2D effect, so of these only the orientation
 * matters — but it matters: a transposed Scrolling Text comes out sideways.
 * Pinned for the same reason `c2` and `ix` are, and for one more on top: a bar
 * and text share segment 0 in the default config, so left unset these are not
 * "whatever the device's own UI last had" but "whatever the other style set".
 */
const TEXT_GEOMETRY = { m12: 0, tp: false, rY: false };

const BLACK: RGBColor = [0, 0, 0];

export type WledPayload = Record<string, unknown>;

/** WLED's own fonts are ASCII only, so anything else comes out as noise. */
const toAscii = (text: string): string => text.replace(/[^\x20-\x7e]/g, '');

/**
 * The forms of this reading, longest first. Exported because the editor's
 * preview has to know what `toDisplayText` was choosing between to say whether
 * it had to fall back to a shorter one.
 */
export const toCandidates = (reading: Reading): readonly string[] => {
    switch (reading.kind) {
        case 'temperature':
            return [`${Math.round(reading.degrees)}${reading.unit}`];
        case 'percent':
            return [`${Math.round(reading.percent)}%`];
        case 'text':
            return reading.candidates;
        case 'unavailable':
            return [];
    }
};

/**
 * The string a text display draws, which WLED reads from the segment name.
 *
 * Takes the longest form that fits rather than cutting the longest one short:
 * the device's fonts have no ellipsis glyph, so a truncated name just looks
 * like a misspelling. Only if nothing fits is the last one cut.
 */
/** How many characters of the segment name are on the panel at once. */
export const visibleLetters = (columns: number): number =>
    Math.max(1, Math.floor(columns / LETTER_WIDTH));

export const toDisplayText = (entity: PanelEntity, reading: Reading): string => {
    const prefix = entity.display.style === 'text' ? entity.display.prefix ?? '' : '';
    const candidates = toCandidates(reading);
    const options = candidates.map(candidate => {
        const combined = `${prefix}${candidate}`;
        return toAscii(combined);
    });

    const fitting = options.find(option => option.length <= MAX_TEXT_LENGTH);
    if (fitting !== undefined) {
        return fitting;
    }

    const longest = options.at(-1) ?? '';
    return longest.slice(0, MAX_TEXT_LENGTH).trimEnd();
};

/**
 * Every segment this display writes to, which a custom one can have several
 * of. Read from the stored template rather than from a filled payload, because
 * the service has to know which segments to leave alone before it has a
 * reading — that is why `panelConfig.ts` refuses a `seg` entry whose `id` is
 * anything but a literal number.
 */
export const segmentIdsOf = (display: WledDisplay): number[] => {
    if (display.style !== 'custom') {
        return [display.segmentId];
    }

    const segments = display.payload.seg;
    if (!Array.isArray(segments)) {
        return [];
    }

    return segments.flatMap(segment => {
        const fields = segment as Record<string, unknown> | null;
        const id = fields?.id;
        return typeof id === 'number' ? [id] : [];
    });
};

/**
 * What each `{{...}}` stands for, for this entity's current reading.
 *
 * A placeholder the reading cannot supply is empty or zero rather than an
 * error: the same custom body may be in front of a sensor that has dropped
 * off, and a bar that draws empty is the established behaviour here.
 */
const toPlaceholderValues = (entity: PanelEntity, reading: Reading): PlaceholderValues => {
    const value = toDisplayText(entity, reading);
    const percent = reading.kind === 'percent' ? Math.round(reading.percent) : 0;
    const degrees = reading.kind === 'temperature' ? Math.round(reading.degrees) : 0;
    const unit = reading.kind === 'temperature' ? reading.unit : '';
    const rawTitle = reading.kind === 'text' ? reading.title ?? '' : '';
    const rawArtist = reading.kind === 'text' ? reading.artist ?? '' : '';
    return {
        value,
        percent,
        degrees,
        unit,
        title: toAscii(rawTitle),
        artist: toAscii(rawArtist),
    };
};

/** The two styles this file draws itself. `custom` writes its own body. */
type DrawnDisplay = Exclude<WledDisplay, { style: 'custom' }>;

const toSegment = (
    entity: PanelEntity,
    display: DrawnDisplay,
    reading: Reading,
): WledPayload => {
    const base = { id: display.segmentId, on: true, frz: false, pal: 0 };

    if (display.style === 'bar') {
        // A bar needs a number; anything else would draw a misleading full or
        // empty bar, so it falls back to empty.
        const percent = reading.kind === 'percent' ? Math.round(reading.percent) : 0;
        return {
            ...base,
            fx: PERCENT_EFFECT_ID,
            // `sx` is how fast the bar slides to a new value, not the value.
            sx: 255,
            ix: percent,
            // Paints the whole bar one colour keyed to the percentage, rather
            // than spreading the palette along it.
            o1: true,
            ...BAR_GEOMETRY,
            col: [display.color, display.trackColor, BLACK],
        };
    }

    const text = toDisplayText(entity, reading);
    return {
        ...base,
        fx: SCROLLING_TEXT_EFFECT_ID,
        n: text,
        sx: display.speed,
        ix: Y_OFFSET,
        c2: FONT_SIZE_SLIDER,
        ...TEXT_GEOMETRY,
        col: [display.color, BLACK, display.color],
    };
};

export type PayloadInput = {
    decision: Decision,
    entities: readonly PanelEntity[],
    readings: ReadonlyMap<string, Reading>,
    brightness: number,
};

export const toWledPayload = (
    { decision, entities, readings, brightness }: PayloadInput,
): WledPayload => {
    if (decision.show === 'nothing') {
        return { on: false };
    }

    const entity = entities.find(candidate => candidate.entityId === decision.entityId);
    if (!entity) {
        throw new Error(`whatToShow picked ${decision.entityId}, which is not a registered entity.`);
    }

    const reading = readings.get(entity.entityId) ?? { kind: 'unavailable' };
    const display = entity.display;

    /**
     * Every other segment any entity uses is switched off. An empty segment
     * name is not blank — Scrolling Text falls back to drawing the date and
     * time — so a segment is cleared by turning it off, never by emptying it.
     *
     * A custom display is not exempt. It owns the body, but it cannot know
     * which segments the *other* entities draw on, so these are appended to
     * whatever it asked for.
     */
    const usedSegmentIds = new Set(entities.flatMap(candidate => {
        const ids = segmentIdsOf(candidate.display);
        return ids;
    }));
    const ownSegmentIds = segmentIdsOf(display);
    for (const id of ownSegmentIds) {
        usedSegmentIds.delete(id);
    }
    const others = [...usedSegmentIds].map(id => ({ id, on: false }));

    if (display.style === 'custom') {
        const values = toPlaceholderValues(entity, reading);
        const filled = fillTemplate(display.payload, values) as WledPayload;
        const own = Array.isArray(filled.seg) ? filled.seg : [];
        /**
         * `on` and `bri` are defaults rather than overrides, so the editor's
         * brightness slider still reaches a custom display — spread after them,
         * a body that names its own `bri` keeps it.
         */
        return { on: true, bri: brightness, ...filled, seg: [...own, ...others] };
    }

    const segment = toSegment(entity, display, reading);
    return { on: true, bri: brightness, seg: [segment, ...others] };
};

export type WledTarget = {
    /** Returns what it sent, or undefined when the payload had not changed. */
    send: (payload: WledPayload) => Promise<WledPayload | undefined>,
};

/**
 * Sends only when the body differs from the last one, which is what keeps a
 * once-a-second decision from being once-a-second traffic.
 */
export const createWledTarget = (
    { ip, onSend }: { ip: string, onSend: (body: string, posted: boolean) => void },
): WledTarget => {
    let lastBody: string | undefined;

    return {
        send: async payload => {
            const body = JSON.stringify(payload);
            if (body === lastBody) {
                return undefined;
            }
            lastBody = body;

            if (!ip) {
                onSend(body, false);
                return payload;
            }

            const response = await fetch(`http://${ip}/json/state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });
            await response.body?.cancel();
            if (!response.ok) {
                throw new Error(`WLED ${ip} rejected the state update with ${response.status}.`);
            }
            onSend(body, true);
            return payload;
        },
    };
};
