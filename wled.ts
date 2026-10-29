import { matchesStateCase, PanelEntity, PlainDisplay, RGBColor, WledDisplay } from './entities.ts';
import { fontSliderOf } from './fonts.ts';
import { encodeLedEntries } from './ledEntries.ts';
import { Reading, UNAVAILABLE } from './readings.ts';
import { EntityValues, fillTemplate, PlaceholderValues } from './template.ts';
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
 * The 2D segment flags a bar sets; text leaves them at `SEGMENT_RESET`'s.
 *
 * `m12` is "Expand 1D FX": 1 is Bar, which paints one whole row per 1D pixel
 * and so fills bottom to top. `tp` transposes the segment, and because
 * `virtualWidth`/`virtualHeight` swap with it, that row becomes a column and
 * the effect's length becomes the panel's width — 32 steps across rather than
 * 8 up. `rY` is applied before the swap, so it is `rY` and not `rev` that
 * decides which end fills first: set, the bar runs left to right.
 */
const BAR_GEOMETRY = { m12: 1, tp: true, rY: true };

const BLACK: RGBColor = [0, 0, 0];

/**
 * Where an `iconText` display draws: the segments the hand-written glyph
 * bodies used, which is the arrangement that has been seen on the panel.
 */
const ICON_SEGMENT_ID = 0;
const ICON_TEXT_SEGMENT_ID = 1;

/**
 * `bm` 8 is Lighten (WLED 16+): the text segment lies over the icon's, and
 * wherever the text is black the icon's own pixels show through.
 */
const LIGHTEN_BLEND_MODE = 8;

/** WLED's `DEFAULT_COLOR`, which a segment created over JSON starts with. */
const WLED_ORANGE: RGBColor = [255, 160, 0];

/** The panel this project drives: what a segment that names no bounds covers. */
export const PANEL_COLUMNS = 32;
export const PANEL_ROWS = 8;

/**
 * Every field of a segment's state at what a fresh segment has — FX.h's
 * `Segment` constructor and `DEFAULT_*` — bar its bounds, which are the whole
 * panel.
 *
 * WLED keeps whatever a body leaves out, so without this each view inherits
 * the one before it: a bar's `o1` turns the next text into a gradient, its
 * `tp` turns it sideways, a glyph's `i` leaves its segment frozen, a custom
 * body's bounds shrink every display after it on that segment. Every segment
 * drawn starts from here, and says only where it differs.
 *
 * `frz: false` is read before a body's own `i`, so a glyph still freezes its
 * segment — but onto a cleared one, not onto the last view's pixels.
 */
const SEGMENT_RESET = {
    on: true,
    bri: 255,
    frz: false,
    n: '',
    grp: 1,
    spc: 0,
    of: 0,
    fx: 0,
    sx: 128,
    ix: 128,
    c1: 128,
    c2: 128,
    c3: 16,
    o1: false,
    o2: false,
    o3: false,
    pal: 0,
    m12: 0,
    si: 0,
    bm: 0,
    cct: 127,
    rev: false,
    mi: false,
    rY: false,
    mY: false,
    tp: false,
    col: [WLED_ORANGE, BLACK, BLACK] as unknown[],
};

export type WledPayload = Record<string, unknown>;

/**
 * A segment as it goes out: over `SEGMENT_RESET` and the whole panel, with its
 * own fields winning.
 *
 * `col` is merged slot by slot, because WLED leaves a slot the array does not
 * reach as it was. A segment sized with `len` gets no `stop`, which WLED would
 * read in its place. An entry that only switches a segment off is left alone:
 * nothing on it is drawn, and bounds would create a segment the device lacks.
 */
const toResetSegment = (segment: WledPayload): WledPayload => {
    if (segment.on === false) {
        return segment;
    }
    const bounds = 'len' in segment
        ? { start: 0, startY: 0, stopY: PANEL_ROWS }
        : { start: 0, stop: PANEL_COLUMNS, startY: 0, stopY: PANEL_ROWS };
    const ownColors = Array.isArray(segment.col) ? segment.col : [];
    const col = SEGMENT_RESET.col.map((color, slot) => ownColors[slot] ?? color);
    return { id: segment.id, ...bounds, ...SEGMENT_RESET, ...segment, col };
};

/** WLED's own fonts are ASCII only, so anything else comes out as noise. */
const toAscii = (text: string): string => text.replace(/[^\x20-\x7e]/g, '');

/** The forms of this reading, longest first. */
const toCandidates = (reading: Reading): readonly string[] => {
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

/** How many characters of the segment name are on the panel at once. */
export const visibleLetters = (columns: number): number =>
    Math.max(1, Math.floor(columns / LETTER_WIDTH));

/**
 * Takes the longest form that fits rather than cutting the longest one short:
 * the device's fonts have no ellipsis glyph, so a truncated name just looks
 * like a misspelling. Only if nothing fits is the last one cut.
 */
const fitText = (options: readonly string[]): string => {
    const fitting = options.find(option => option.length <= MAX_TEXT_LENGTH);
    if (fitting !== undefined) {
        return fitting;
    }

    const longest = options.at(-1) ?? '';
    return longest.slice(0, MAX_TEXT_LENGTH).trimEnd();
};

/** The reading on its own, as a custom body's `{{value}}` gets it. */
const toPlainText = (reading: Reading): string => {
    const candidates = toCandidates(reading);
    const options = candidates.map(toAscii);
    return fitText(options);
};

/**
 * What placeholders other than `{{value}}` stand for, for this reading.
 *
 * A placeholder the reading cannot supply is empty or zero rather than an
 * error: the same body may be in front of a sensor that has dropped off, and
 * a bar that draws empty is the established behaviour here.
 */
const toReadingValues = (reading: Reading): Omit<PlaceholderValues, 'value'> => {
    const percent = reading.kind === 'percent' ? Math.round(reading.percent) : 0;
    const degrees = reading.kind === 'temperature' ? Math.round(reading.degrees) : 0;
    const unit = reading.kind === 'temperature' ? reading.unit : '';
    const rawTitle = reading.kind === 'text' ? reading.title ?? '' : '';
    const rawArtist = reading.kind === 'text' ? reading.artist ?? '' : '';
    return { percent, degrees, unit, title: toAscii(rawTitle), artist: toAscii(rawArtist) };
};

/** The single-segment styles this file draws itself. */
type DrawnDisplay = Extract<PlainDisplay, { style: 'text' | 'bar' }>;
/** The styles whose segment name is their own template. */
type TextDisplay = Extract<PlainDisplay, { style: 'text' | 'iconText' }>;

/**
 * The display that applies for this raw state: a `byState` display's first
 * case it matches, or its `otherwise`. Any other display is its own answer.
 */
export const resolveDisplay = (display: WledDisplay, state: string): PlainDisplay => {
    if (display.style !== 'byState') {
        return display;
    }
    const matched = display.cases.find(candidate => matchesStateCase(candidate, state));
    return matched?.display ?? display.otherwise;
};

/**
 * Every form a text display's template can take for this reading, longest
 * first: the template filled once per form of `{{value}}`. Exported because
 * the editor's preview has to know what `toDisplayText` was choosing between
 * to say whether it had to fall back to a shorter one.
 *
 * Empty when the reading has no forms at all — a sensor that has dropped off
 * draws nothing rather than its template's literal text around a gap.
 */
export const toTextOptions = (
    display: TextDisplay,
    reading: Reading,
    others: EntityValues,
): string[] => {
    const rest = toReadingValues(reading);
    const candidates = toCandidates(reading);
    return candidates.map(candidate => {
        const values = { ...rest, value: toAscii(candidate) };
        const filled = fillTemplate(display.text, values, others);
        return toAscii(String(filled));
    });
};

/**
 * The string a display draws as its segment name: the text style's template,
 * filled and fitted — or, for the other styles, the reading on its own, which
 * is what a custom body's `{{value}}` means.
 */
export const toDisplayText = (
    display: PlainDisplay,
    reading: Reading,
    others: EntityValues,
): string => {
    if (display.style !== 'text' && display.style !== 'iconText') {
        return toPlainText(reading);
    }
    const options = toTextOptions(display, reading, others);
    return fitText(options);
};

/**
 * Every segment this display can write to, which a custom one can have several
 * of, and a `byState` one the union of its cases'. Read from the stored
 * template rather than from a filled payload, because the service has to know
 * which segments to leave alone before it has a reading — that is why
 * `panelConfig.ts` refuses a `seg` entry whose `id` is anything but a literal
 * number.
 */
export const segmentIdsOf = (display: WledDisplay): number[] => {
    if (display.style === 'byState') {
        const nested = [...display.cases.map(candidate => candidate.display), display.otherwise];
        return nested.flatMap(segmentIdsOf);
    }
    if (display.style === 'iconText') {
        return [ICON_SEGMENT_ID, ICON_TEXT_SEGMENT_ID];
    }
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

/** What each `{{...}}` in a custom body stands for, for this reading. */
const toPlaceholderValues = (reading: Reading): PlaceholderValues => {
    const value = toPlainText(reading);
    const rest = toReadingValues(reading);
    return { ...rest, value };
};

/**
 * Every other entity's values, for `{{sensor.outside}}`. Its `value` is the
 * plain reading, never that entity's own text template: one template reading
 * another would let two of them refer to each other.
 */
export const toEntityValues = (readings: ReadonlyMap<string, Reading>): EntityValues =>
    entityId => {
        const reading = readings.get(entityId) ?? UNAVAILABLE;
        const values = toPlaceholderValues(reading);
        return values;
    };

const toSegment = (display: DrawnDisplay, reading: Reading, others: EntityValues): WledPayload => {
    const base = { id: display.segmentId };

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

    const text = toDisplayText(display, reading, others);
    return {
        ...base,
        fx: SCROLLING_TEXT_EFFECT_ID,
        n: text,
        sx: display.speed,
        ix: Y_OFFSET,
        c2: FONT_SIZE_SLIDER,
        col: [display.color, BLACK, display.color],
    };
};

type IconTextDisplay = Extract<PlainDisplay, { style: 'iconText' }>;

const toIconTextSegments = (
    display: IconTextDisplay,
    reading: Reading,
    others: EntityValues,
): WledPayload[] => {
    const entries = encodeLedEntries(display.pixels);
    const text = toDisplayText(display, reading, others);
    return [
        {
            id: ICON_SEGMENT_ID,
            // Frozen, so the effect never runs; 122 is what the hand-written
            // bodies had, and nothing else has been tried on the panel.
            frz: true,
            fx: SCROLLING_TEXT_EFFECT_ID,
            i: entries,
        },
        {
            id: ICON_TEXT_SEGMENT_ID,
            start: display.textStart,
            fx: SCROLLING_TEXT_EFFECT_ID,
            n: text,
            sx: display.speed,
            ix: display.yOffset,
            // Trail: none, or a scrolling reading smears.
            c1: 0,
            c2: fontSliderOf(display.font),
            bm: LIGHTEN_BLEND_MODE,
            col: [display.color, BLACK, display.color],
        },
    ];
};

export type PayloadInput = {
    decision: Decision,
    entities: readonly PanelEntity[],
    /**
     * The displays the flow sets for itself, from `displaysInFlow`. Only
     * their segment ids are read: those are segments to switch off when
     * something else is drawn.
     */
    flowDisplays: readonly WledDisplay[],
    readings: ReadonlyMap<string, Reading>,
    /**
     * Raw Home Assistant state strings, which `Reading` throws away for
     * numeric kinds. Only a `byState` display reads them.
     */
    states: ReadonlyMap<string, string>,
    brightness: number,
};

export const toWledPayload = (
    { decision, entities, flowDisplays, readings, states, brightness }: PayloadInput,
): WledPayload => {
    if (decision.show === 'nothing') {
        return { on: false };
    }

    const entity = entities.find(candidate => candidate.entityId === decision.entityId);
    if (!entity) {
        throw new Error(`whatToShow picked ${decision.entityId}, which is not a registered entity.`);
    }

    const reading = readings.get(entity.entityId) ?? UNAVAILABLE;
    const state = states.get(entity.entityId) ?? '';
    const display = resolveDisplay(decision.display ?? entity.display, state);
    const otherValues = toEntityValues(readings);

    /**
     * Every other segment any entity uses is switched off. An empty segment
     * name is not blank — Scrolling Text falls back to drawing the date and
     * time — so a segment is cleared by turning it off, never by emptying it.
     *
     * A custom display is not exempt. It owns the body, but it cannot know
     * which segments the *other* entities draw on, so these are appended to
     * whatever it asked for.
     *
     * `display` is already the case that matched, so a segment only another
     * case of the same `byState` display uses is switched off too: an icon
     * drawn for `sunny` does not linger under `rainy`'s text.
     */
    const allDisplays = [...entities.map(candidate => candidate.display), ...flowDisplays];
    const usedSegmentIds = new Set(allDisplays.flatMap(candidate => {
        const ids = segmentIdsOf(candidate);
        return ids;
    }));
    const ownSegmentIds = segmentIdsOf(display);
    for (const id of ownSegmentIds) {
        usedSegmentIds.delete(id);
    }
    const others = [...usedSegmentIds].map(id => ({ id, on: false }));

    if (display.style === 'custom') {
        const values = toPlaceholderValues(reading);
        const filled = fillTemplate(display.payload, values, otherValues) as WledPayload;
        const segments = Array.isArray(filled.seg) ? filled.seg : [];
        const own = segments.map(segment => toResetSegment(segment as WledPayload));
        /**
         * `on` and `bri` are defaults rather than overrides, so the editor's
         * brightness slider still reaches a custom display — spread after them,
         * a body that names its own `bri` keeps it.
         */
        return { on: true, bri: brightness, ...filled, seg: [...own, ...others] };
    }

    if (display.style === 'iconText') {
        const segments = toIconTextSegments(display, reading, otherValues);
        const own = segments.map(toResetSegment);
        return { on: true, bri: brightness, seg: [...own, ...others] };
    }

    const drawn = toSegment(display, reading, otherValues);
    const segment = toResetSegment(drawn);
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
