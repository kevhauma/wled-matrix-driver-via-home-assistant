import { DateTimeFormat, DATE_TIME_FORMATS, defaultFormatFor, isBuiltinId, renderDateTime } from './builtins.ts';
import { EntityState } from './homeAssistant/entityStore.ts';
import { PanelEntity, ReadingKinds } from './entities.ts';

/** Parses one entity's raw state into the value its display needs. */

export type Reading =
    | { kind: 'unavailable' }
    | { kind: 'percent', percent: number }
    | { kind: 'temperature', degrees: number, unit: string }
    | {
        kind: 'text',
        /** Longest first; `wled.ts` draws the first that fits the segment name. */
        candidates: readonly string[],
        isPlaying: boolean,
        /**
         * The media player's parts, kept apart from `candidates` so a custom
         * display can give each one a segment. Absent for anything that is not
         * a media player, which is what `candidates` is for.
         */
        title?: string,
        artist?: string,
    };

export const UNAVAILABLE: Reading = { kind: 'unavailable' };

const readString = (entity: EntityState, key: string): string => {
    const value = entity.attributes[key];
    return typeof value === 'string' ? value : '';
};

/**
 * A media player's text is its title and artist; anything else just uses its
 * state string, which covers a template sensor without a special case.
 *
 * Both forms are offered because the segment name is short and the device's
 * fonts have no ellipsis glyph, so dropping the artist reads far better than
 * cutting it off mid-word.
 */
const readText = (entity: EntityState): Reading => {
    const title = readString(entity, 'media_title');
    const isPlaying = entity.state === 'playing';

    if (!title) {
        return { kind: 'text', candidates: [entity.state], isPlaying };
    }

    const artist = readString(entity, 'media_artist');
    const parts = [title, artist].filter(Boolean);
    const withArtist = parts.join(' - ');
    return { kind: 'text', candidates: [withArtist, title], isPlaying, title, artist };
};

const isGone = (entity: EntityState | undefined): entity is undefined =>
    // `unavailable` and `unknown` are ordinary state strings, so a sensor that
    // has dropped off parses to NaN rather than throwing.
    entity === undefined || entity.state === 'unavailable' || entity.state === 'unknown';

/**
 * One candidate only: the formats are already short, and a shorter fallback
 * form would be a second format nobody chose.
 */
const toTextReading = (text: string | undefined): Reading => {
    if (text === undefined) {
        return UNAVAILABLE;
    }
    return { kind: 'text', candidates: [text], isPlaying: false };
};

/**
 * Only with an explicit offset: without one, `Date` would read the string in
 * the host's zone, which is not necessarily the panel's. A timestamp sensor
 * always carries one, so this refuses nothing Home Assistant sends.
 */
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const parseTimestamp = (state: string): Date | undefined => {
    if (!TIMESTAMP_PATTERN.test(state)) {
        return undefined;
    }
    const normalized = state.replace(' ', 'T');
    const milliseconds = Date.parse(normalized);
    return Number.isFinite(milliseconds) ? new Date(milliseconds) : undefined;
};

/**
 * A time remaining that has run out reads as unavailable, so a finish time
 * that has passed drops out of a rotation and fails an `isAvailable` test
 * instead of sitting on the panel.
 */
const readTimestamp = (
    entity: EntityState,
    format: DateTimeFormat,
    now: Date,
    timeZone: string,
): Reading => {
    const target = parseTimestamp(entity.state);
    if (target === undefined) {
        return UNAVAILABLE;
    }
    const text = renderDateTime(format, target, now, timeZone);
    return toTextReading(text);
};

const readNumber = (entity: EntityState, kind: 'percent' | 'temperature'): Reading => {
    const value = Number(entity.state);
    if (!Number.isFinite(value)) {
        return UNAVAILABLE;
    }

    if (kind === ReadingKinds.Percent) {
        const percent = Math.max(0, Math.min(100, value));
        return { kind: 'percent', percent };
    }

    const unit = readString(entity, 'unit_of_measurement');
    return { kind: 'temperature', degrees: value, unit };
};

/**
 * One entity's reading, whatever it is. `state` is ignored for a built-in
 * item, whose value is `now` in its format: text like any other, so the flow,
 * the payload and the preview treat a clock as they treat a template sensor —
 * and never unavailable, which is what makes a clock a sound `OTHERWISE`
 * target and a rotation member that cannot drop out.
 *
 * The format fallbacks are only reachable from a `PanelEntity` built in code:
 * the validator requires one wherever it is read.
 */
export const readPanelEntity = (
    panelEntity: PanelEntity,
    state: EntityState | undefined,
    now: Date,
    timeZone: string,
): Reading => {
    const { entityId, kind } = panelEntity;

    if (isBuiltinId(entityId)) {
        const format = panelEntity.format ?? defaultFormatFor(entityId);
        const text = renderDateTime(format, now, now, timeZone);
        return toTextReading(text);
    }

    if (isGone(state)) {
        return UNAVAILABLE;
    }

    if (kind === ReadingKinds.Text) {
        return readText(state);
    }

    if (kind === ReadingKinds.DateTime) {
        const format = panelEntity.format ?? DATE_TIME_FORMATS[0];
        return readTimestamp(state, format, now, timeZone);
    }

    return readNumber(state, kind);
};
