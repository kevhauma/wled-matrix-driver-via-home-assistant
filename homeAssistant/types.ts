/**
 * The Home Assistant WebSocket wire format, as far as `subscribe_entities`
 * needs it. The one-letter keys are not an abbreviation we chose: HA sends the
 * compressed form on this command, and it is not the same shape as the REST
 * `/api/states` payload.
 *
 * Timestamps here (`lc`, `lu`) are epoch *seconds* as floats. Timestamps that
 * appear inside `a` are ordinary attribute values and keep whatever form the
 * integration gave them, which for `media_position_updated_at` is an ISO string.
 */

export type CompressedEntity = {
    s: string,
    a?: Record<string, unknown>,
    lc?: number,
    lu?: number,
};

/**
 * `+` carries values to merge in, `-` names attributes to drop. `+.a` is a
 * partial attribute set, so it merges onto the stored attributes rather than
 * replacing them — treating it as a replacement silently loses every attribute
 * that did not change, which for a media player is most of them.
 */
export type CompressedEntityDiff = {
    '+'?: {
        s?: string,
        a?: Record<string, unknown>,
        lc?: number,
        lu?: number,
    },
    '-'?: {
        a?: string[],
    },
};

export type CompressedStateEvent = {
    /** Added: the full state of each entity. Arrives once per subscription. */
    a?: Record<string, CompressedEntity>,
    /** Changed. */
    c?: Record<string, CompressedEntityDiff>,
    /** Removed. */
    r?: string[],
};

export type IncomingMessage = {
    type: string,
    id?: number,
    ha_version?: string,
    success?: boolean,
    message?: string,
    event?: CompressedStateEvent,
    error?: { code?: string, message?: string },
};
