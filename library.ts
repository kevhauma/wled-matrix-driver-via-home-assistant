import { BuiltinFormat, defaultFormatFor, describeBuiltins, renderBuiltin, WallClock } from './builtins.ts';
import { RestEntityState } from './homeAssistant/states.ts';

/**
 * The list the editor's picker chooses from: the built-in items, then whatever
 * Home Assistant exposes.
 *
 * Why this is its own module rather than part of the HTTP handler: a Home
 * Assistant with a few thousand entities is the case that matters, and in that
 * case *what the picker is sent* is a decision with rules — filter, sort,
 * truncate, and say how much was left out. Keeping it here is what lets those
 * rules be tested without a server, and it is shared with `deno task entities`.
 */

export type LibraryItem = {
    entityId: string,
    state: string,
    friendlyName: string,
    deviceClass: string,
    unit: string,
    /**
     * Built-in items are rendered by this service from the host clock, so they
     * are offered whether or not there is a token, and they are the only ones
     * that carry a format.
     */
    source: 'builtin' | 'homeAssistant',
    /** Built-in items only: the format a freshly added one starts with. */
    format?: BuiltinFormat,
};

const readAttribute = (entity: RestEntityState, key: string): string => {
    const value = entity.attributes[key];
    return typeof value === 'string' ? value : '';
};

export const toLibraryItem = (entity: RestEntityState): LibraryItem => ({
    entityId: entity.entity_id,
    state: entity.state,
    friendlyName: readAttribute(entity, 'friendly_name'),
    deviceClass: readAttribute(entity, 'device_class'),
    unit: readAttribute(entity, 'unit_of_measurement'),
    source: 'homeAssistant',
});

/** The built-ins as library rows, showing what each would say right now. */
export const builtinItems = (at: WallClock): LibraryItem[] =>
    describeBuiltins(at).map(builtin => {
        const format = defaultFormatFor(builtin.entityId);
        const state = renderBuiltin(format, at);
        return {
            entityId: builtin.entityId,
            state,
            friendlyName: builtin.label,
            deviceClass: 'clock',
            unit: '',
            source: 'builtin' as const,
            format,
        };
    });

/**
 * Filters are substrings matched against the id, the friendly name and the
 * device class, as an OR. No filters means everything.
 */
export const matchesFilters = (item: LibraryItem, filters: readonly string[]): boolean => {
    if (filters.length === 0) {
        return true;
    }
    const haystack = `${item.entityId} ${item.friendlyName} ${item.deviceClass}`.toLowerCase();
    return filters.some(filter => haystack.includes(filter));
};

export const byEntityId = (first: LibraryItem, second: LibraryItem): number =>
    first.entityId.localeCompare(second.entityId);

/**
 * How many rows one request may carry. The picker shows a window of matches
 * and says how many it is not showing, rather than the browser being handed
 * every entity of a large installation on each keystroke — a few thousand of
 * these is megabytes, and no dropdown is readable at that length anyway.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export const toLimit = (raw: string | null): number => {
    if (raw === null || raw.trim() === '') {
        return DEFAULT_LIMIT;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) {
        return DEFAULT_LIMIT;
    }
    return Math.min(MAX_LIMIT, Math.floor(value));
};

export type LibraryPage = {
    items: LibraryItem[],
    /** How many matched the filter, which may be more than `items` holds. */
    matched: number,
    /** How many there are in total, filter or no filter. */
    total: number,
    limit: number,
};

export const toFilters = (query: string): string[] => {
    const terms = query.split(/\s+/).filter(Boolean);
    return terms.map(term => term.toLowerCase());
};

/**
 * Built-ins first, then Home Assistant's own sorted by id. They are the
 * service's own items and there are two of them, so a filter that matches one
 * should never push it off the end of a truncated page.
 */
export const selectLibrary = (
    { items, filters, limit }: { items: readonly LibraryItem[], filters: readonly string[], limit: number },
): LibraryPage => {
    const builtins = items.filter(item => item.source === 'builtin');
    const entities = items.filter(item => item.source !== 'builtin');
    entities.sort(byEntityId);

    const ordered = [...builtins, ...entities];
    const matching = ordered.filter(item => matchesFilters(item, filters));

    return {
        items: matching.slice(0, limit),
        matched: matching.length,
        total: ordered.length,
        limit,
    };
};
