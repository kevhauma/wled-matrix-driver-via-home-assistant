import { CompressedEntity, CompressedEntityDiff, CompressedStateEvent } from './types.ts';

/**
 * Rebuilds whole entity states from the snapshot-then-diffs stream that
 * `subscribe_entities` sends. This is the only place that knows the compressed
 * format; everything downstream sees settled `EntityState` values.
 */

export type EntityState = {
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
    /** Epoch milliseconds, converted from the wire format's epoch seconds. */
    lastChanged: number,
    lastUpdated: number,
};

export type EntityLookup = (entityId: string) => EntityState | undefined;

export type EntityStore = {
    lookup: EntityLookup,
    /** Returns the entity ids this event touched, for deciding what to re-read. */
    apply: (event: CompressedStateEvent) => string[],
    /** Called on reconnect: the next subscription opens with a fresh snapshot. */
    clear: () => void,
};

const toMilliseconds = (seconds: number | undefined): number | undefined =>
    seconds === undefined ? undefined : Math.round(seconds * 1000);

/**
 * HA sends `lc` when last_changed moved, and omits `lu` in that case because the
 * two are then equal. It sends `lu` alone when only last_updated moved — an
 * attribute change that left the state string alone, which is most media player
 * traffic. So `lc` sets both, and `lu` sets only last_updated.
 */
const resolveTimestamps = (
    source: { lc?: number, lu?: number },
    fallback: { lastChanged: number, lastUpdated: number },
): { lastChanged: number, lastUpdated: number } => {
    const changedAt = toMilliseconds(source.lc);
    const updatedAt = toMilliseconds(source.lu);
    return {
        lastChanged: changedAt ?? fallback.lastChanged,
        lastUpdated: changedAt ?? updatedAt ?? fallback.lastUpdated,
    };
};

export const createEntityStore = (): EntityStore => {
    const entities = new Map<string, EntityState>();

    const add = (entityId: string, compressed: CompressedEntity): void => {
        const now = Date.now();
        const timestamps = resolveTimestamps(compressed, { lastChanged: now, lastUpdated: now });
        entities.set(entityId, {
            entityId,
            state: compressed.s,
            attributes: compressed.a ?? {},
            ...timestamps,
        });
    };

    const change = (entityId: string, diff: CompressedEntityDiff): boolean => {
        const current = entities.get(entityId);
        // A diff with no snapshot behind it cannot be reconstructed into a whole
        // state, and guessing one would publish a half-built entity downstream.
        if (!current) {
            return false;
        }

        const additions = diff['+'] ?? {};
        const removals = diff['-'] ?? {};
        const removedKeys = removals.a ?? [];

        let attributes = current.attributes;
        if (additions.a || removedKeys.length > 0) {
            attributes = { ...current.attributes, ...additions.a };
            for (const key of removedKeys) {
                delete attributes[key];
            }
        }

        const timestamps = resolveTimestamps(additions, current);
        entities.set(entityId, {
            entityId,
            state: additions.s ?? current.state,
            attributes,
            ...timestamps,
        });
        return true;
    };

    return {
        lookup: entityId => entities.get(entityId),

        apply: event => {
            const touched: string[] = [];

            for (const [entityId, compressed] of Object.entries(event.a ?? {})) {
                add(entityId, compressed);
                touched.push(entityId);
            }

            for (const [entityId, diff] of Object.entries(event.c ?? {})) {
                const applied = change(entityId, diff);
                if (applied) {
                    touched.push(entityId);
                }
            }

            for (const entityId of event.r ?? []) {
                const existed = entities.delete(entityId);
                if (existed) {
                    touched.push(entityId);
                }
            }

            return touched;
        },

        clear: () => entities.clear(),
    };
};

/** Attribute readers, shared by every feed so `unavailable` is handled once. */

export const readStringAttribute = (entity: EntityState | undefined, key: string): string => {
    const value = entity?.attributes[key];
    return typeof value === 'string' ? value : '';
};

export const readNumberAttribute = (entity: EntityState | undefined, key: string): number | undefined => {
    const value = entity?.attributes[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/**
 * `unknown` and `unavailable` are ordinary state strings, so a sensor that has
 * dropped off parses to NaN rather than throwing. Both mean "no reading".
 */
export const readNumericState = (entity: EntityState | undefined): number | undefined => {
    if (!entity) {
        return undefined;
    }
    const value = Number(entity.state);
    return Number.isFinite(value) ? value : undefined;
};
