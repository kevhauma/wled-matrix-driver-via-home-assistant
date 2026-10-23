/**
 * The flow: an ordered chain of rules, read top to bottom, where the first one
 * whose conditions match decides what the panel shows.
 *
 * This is what used to be the hardcoded order inside `whatToShow.ts`. Holding
 * it as data is what lets the editor rearrange it, and it is why entities no
 * longer carry a `role` — the order of the rules *is* the priority.
 */

export const ConditionTests = {
    /** A media player that is actually playing, not merely on. */
    IsPlaying: 'isPlaying',
    IsNotPlaying: 'isNotPlaying',
    /** Has any reading at all, i.e. has not dropped off. */
    IsAvailable: 'isAvailable',
    IsUnavailable: 'isUnavailable',
    Above: 'above',
    Below: 'below',
    /** Compares against the entity's raw state string. */
    Equals: 'equals',
} as const;

export type ConditionTest = typeof ConditionTests[keyof typeof ConditionTests];

export type Condition = {
    entityId: string,
    test: ConditionTest,
    /** Only `above`, `below` and `equals` use this. */
    value?: number | string,
};

export const ActionKinds = {
    Blank: 'blank',
    Show: 'show',
    /** Takes its members in turn, one every `dwellSeconds`. */
    Loop: 'loop',
} as const;

export type ActionKind = typeof ActionKinds[keyof typeof ActionKinds];

export type Action =
    | { do: 'blank' }
    | { do: 'show', entityId: string }
    | { do: 'loop', entityIds: string[], dwellSeconds: number };

export type FlowRule = {
    /**
     * Stable across edits, because the running loop keys each rotation's
     * position by it. Deleting and re-adding a rule restarts its rotation.
     */
    id: string,
    /** Shown on the block, and used as the `reason` when the panel blanks. */
    label?: string,
    match: 'all' | 'any',
    /** Empty always matches: that is how the trailing OTHERWISE block is held. */
    conditions: Condition[],
    action: Action,
};

/**
 * Which member of a loop is up, and when it took the panel.
 *
 * Keyed by entity id rather than by position so that reordering a loop's
 * members in the editor cannot silently point at a different entity, and so
 * that what the panel is doing survives being written into `/api/state`.
 */
export type LoopState = {
    entityId: string,
    sinceMilliseconds: number,
    /**
     * Whether this loop held the panel at the previous decision. Without it,
     * "resume where it left off" would have to be inferred from elapsed time,
     * which makes the result depend on how often the caller ticks.
     */
    wasActive: boolean,
};
