import { BuiltinFormat, renderBuiltin } from './builtins.ts';
import { EntityState } from './homeAssistant/entityStore.ts';
import { ReadingKind, ReadingKinds } from './entities.ts';

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

export const readEntity = (entity: EntityState | undefined, kind: ReadingKind): Reading => {
    // `unavailable` and `unknown` are ordinary state strings, so a sensor that
    // has dropped off parses to NaN rather than throwing.
    if (!entity || entity.state === 'unavailable' || entity.state === 'unknown') {
        return UNAVAILABLE;
    }

    if (kind === ReadingKinds.Text) {
        return readText(entity);
    }

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
 * A built-in item's reading. Text like any other, so everything downstream —
 * the flow, the payload, the preview — treats a clock as it treats a template
 * sensor. One candidate only: the formats are already short, and a shorter
 * fallback form would be a second format nobody chose.
 *
 * Never `unavailable`, which is what makes a clock a sound `OTHERWISE` target
 * and a rotation member that cannot drop out.
 */
export const readBuiltin = (format: BuiltinFormat, at: Date): Reading => {
    const text = renderBuiltin(format, at);
    return { kind: 'text', candidates: [text], isPlaying: false };
};
