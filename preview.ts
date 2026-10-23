import { defaultFormatFor, isBuiltinId } from './builtins.ts';
import { PanelEntity } from './entities.ts';
import { EntityState } from './homeAssistant/entityStore.ts';
import { readBuiltin, readEntity, Reading } from './readings.ts';
import {
    MAX_TEXT_LENGTH,
    segmentIdsOf,
    toCandidates,
    toDisplayText,
    toWledPayload,
    visibleLetters,
    WledPayload,
} from './wled.ts';

/**
 * What one entity would look like on the panel, for a value typed into the
 * editor rather than one coming from Home Assistant.
 *
 * Everything here goes through the same `readEntity`, `toDisplayText` and
 * `toWledPayload` the running service uses, so the preview cannot drift from
 * what actually gets sent. The browser draws the picture; this decides what
 * the picture is of.
 */

/**
 * The panel this project was built for. Segment geometry is not part of the
 * configuration — `wled.ts` only ever names a segment id and lets the device
 * own its bounds — so the preview has to assume a width to say how much text
 * is visible at once.
 */
export const PANEL_COLUMNS = 32;

export type PreviewWarning =
    | 'strippedNonAscii'
    | 'shortened'
    | 'scrolls'
    | 'segmentNameTooLong';

/** One segment of a custom display, once its placeholders are filled. */
export type CustomSegmentPreview = {
    id: number,
    /** The filled segment name; absent when that segment sets none. */
    name: string | undefined,
    length: number,
    scrolls: boolean,
};

export type Preview = {
    /**
     * Exactly the string WLED receives as the segment name — or, for a custom
     * display, what its `{{value}}` fills to, since that one has as many
     * segment names as it chooses to write.
     */
    text: string,
    length: number,
    /** How many of those characters are on the panel at once. */
    visible: number,
    percent: number | undefined,
    reading: Reading,
    payload: WledPayload,
    /** A custom display's own segments; empty for `text` and `bar`. */
    customSegments: CustomSegmentPreview[],
    warnings: PreviewWarning[],
};

/** `readings.ts` reads a title and an artist off one of these and nothing else. */
const MEDIA_PLAYER_PREFIX = 'media_player.';

/**
 * A stand-in for what the socket would have given us.
 *
 * The media attributes are only set for a media player, and that is the whole
 * reason the prefix is tested here: without them `{{title}}` and `{{artist}}`
 * would preview as permanently empty while working on the device, and with
 * them on everything a plain text sensor would preview a title it will never
 * have.
 */
const toEntityState = (
    entityId: string,
    value: string,
    unit: string,
    artist: string,
): EntityState => {
    const attributes: Record<string, unknown> = {};
    if (unit !== '') {
        attributes.unit_of_measurement = unit;
    }
    if (entityId.startsWith(MEDIA_PLAYER_PREFIX)) {
        attributes.media_title = value;
        attributes.media_artist = artist;
    }

    return { entityId, state: value, attributes, lastChanged: 0, lastUpdated: 0 };
};

export type PreviewSample = {
    value: string,
    unit: string,
    /** Only a media player has one, and only then is it asked for. */
    artist: string,
};

/**
 * A built-in item has nothing to fake: its value is the host's clock, and the
 * same clock is what the service will send. So the sample the editor typed is
 * ignored and the preview shows the real thing — which is also the only way to
 * see what changing the format does.
 */
const previewReading = (entity: PanelEntity, sample: PreviewSample): Reading => {
    const entityId = entity.entityId;

    if (isBuiltinId(entityId)) {
        const format = entity.format ?? defaultFormatFor(entityId);
        const now = new Date();
        const reading = readBuiltin(format, now);
        return reading;
    }

    const state = toEntityState(entityId, sample.value, sample.unit, sample.artist);
    const reading = readEntity(state, entity.kind);
    return reading;
};

export type PreviewInput = {
    /** Every entity, because the payload switches the other segments off. */
    entities: readonly PanelEntity[],
    entityId: string,
    sampleValue: string,
    unit: string,
    /** Only a media player has one, and only then is it asked for. */
    sampleArtist: string,
    brightness: number,
};

export const toPreview = (
    { entities, entityId, sampleValue, unit, sampleArtist, brightness }: PreviewInput,
): Preview => {
    const entity = entities.find(candidate => candidate.entityId === entityId);
    if (entity === undefined) {
        throw new Error(`${entityId} is not one of the panel's entities.`);
    }

    const isBuiltin = isBuiltinId(entityId);
    const sample = { value: sampleValue, unit, artist: sampleArtist };
    const reading = previewReading(entity, sample);
    const text = toDisplayText(entity, reading);

    /**
     * The whole payload, not just this entity's segment: `toWledPayload` adds
     * the `{ id, on: false }` entries that clear the other segments, and those
     * are part of what gets sent.
     */
    const decision = { show: 'entity' as const, entityId };
    const readings = new Map<string, Reading>([[entityId, reading]]);
    const payload = toWledPayload({ decision, entities, readings, brightness });

    const visible = visibleLetters(PANEL_COLUMNS);
    const warnings: PreviewWarning[] = [];
    const customSegments: CustomSegmentPreview[] = [];

    // The sample is not what a built-in draws, so complaining about what was
    // typed into it would be a warning about nothing.
    const asciiOnly = sampleValue.replace(/[^\x20-\x7e]/g, '');
    if (!isBuiltin && asciiOnly !== sampleValue) {
        warnings.push('strippedNonAscii');
    }

    if (entity.display.style === 'custom') {
        /**
         * Read back out of the finished payload rather than filled a second
         * time here, so what the editor lists is literally what is going to be
         * sent. The `{ id, on: false }` entries `toWledPayload` appends for the
         * other entities' segments are left out: those are not this display.
         */
        const ownIds = segmentIdsOf(entity.display);
        const segments = Array.isArray(payload.seg) ? payload.seg : [];
        for (const segment of segments) {
            const fields = segment as Record<string, unknown>;
            const id = typeof fields.id === 'number' ? fields.id : -1;
            if (!ownIds.includes(id)) {
                continue;
            }
            const name = typeof fields.n === 'string' ? fields.n : undefined;
            const length = name === undefined ? 0 : name.length;
            customSegments.push({ id, name, length, scrolls: length > visible });
        }

        const overlong = customSegments.find(segment => segment.length > MAX_TEXT_LENGTH);
        if (overlong !== undefined) {
            warnings.push('segmentNameTooLong');
        }
    }

    if (entity.display.style === 'text') {
        /**
         * Compared against the fullest form `toDisplayText` had to choose
         * from, not against the typed value: a temperature is *meant* to come
         * out as `18C`, and calling that a shortening would cry wolf on every
         * numeric reading.
         */
        const candidates = toCandidates(reading);
        const prefix = entity.display.prefix ?? '';
        const longest = `${prefix}${candidates[0] ?? ''}`;
        const asciiLongest = longest.replace(/[^\x20-\x7e]/g, '');
        if (text !== asciiLongest) {
            warnings.push('shortened');
        }
        // WLED centres text that fits and scrolls only what does not.
        if (text.length > visible) {
            warnings.push('scrolls');
        }
    }

    const percent = reading.kind === 'percent' ? Math.round(reading.percent) : undefined;

    return {
        text,
        length: text.length,
        visible,
        percent,
        reading,
        payload,
        customSegments,
        warnings,
    };
};
