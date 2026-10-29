/**
 * The flow: an ordered chain of rules, read top to bottom, where the first one
 * whose conditions match decides what the panel shows.
 *
 * This is what used to be the hardcoded order inside `whatToShow.ts`. Holding
 * it as data is what lets the editor rearrange it, and it is why entities no
 * longer carry a `role` — the order of the rules *is* the priority.
 */

import { WledDisplay } from './entities.ts';

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
    /** Reads this host's clock, not an entity. */
    TimeBetween: 'timeBetween',
} as const;

export type ConditionTest = typeof ConditionTests[keyof typeof ConditionTests];

export type EntityCondition = {
    entityId: string,
    test: Exclude<ConditionTest, 'timeBetween'>,
    /** Only `above`, `below` and `equals` use this. */
    value?: number | string,
};

/**
 * True from `from` up to but not including `to`, both `HH:MM` on this host's
 * local clock. A window whose `to` is earlier than its `from` runs past
 * midnight, so `22:00`-`07:00` is the night. `from` and `to` cannot be equal:
 * that could mean an empty window or the whole day, and the validator refuses
 * to guess which.
 */
export type TimeCondition = {
    test: 'timeBetween',
    from: string,
    to: string,
};

export type Condition = EntityCondition | TimeCondition;

export const ActionKinds = {
    Blank: 'blank',
    Show: 'show',
    /** Takes its members in turn, each for its own `dwellSeconds` or the loop's. */
    Loop: 'loop',
} as const;

export type ActionKind = typeof ActionKinds[keyof typeof ActionKinds];

/**
 * One loop member: an entity, and optionally the display it gets in this
 * place only. Its own `id` is what lets the same entity be a member twice —
 * a media player's title, then its artist — because the rotation's position
 * is kept by member, not by entity.
 */
export type LoopMember = {
    id: string,
    entityId: string,
    /** Replaces the entity's own display here; absent means use that one. */
    display?: WledDisplay,
    /**
     * Only takes its turn while these match; absent means whenever it has a
     * reading. A member left out this way is treated exactly like one whose
     * sensor has dropped off.
     */
    when?: MemberWhen,
    /** How long this member holds the panel; absent means the loop's own. */
    dwellSeconds?: number,
};

/** A rule's conditions, scoped to one loop member. Never empty. */
export type MemberWhen = {
    match: 'all' | 'any',
    conditions: Condition[],
};

export type Action =
    | { do: 'blank' }
    | {
        do: 'show',
        entityId: string,
        /** Replaces the entity's own display for this rule only. */
        display?: WledDisplay,
    }
    | { do: 'loop', members: LoopMember[], dwellSeconds: number };

/**
 * Every display the flow sets for itself. `wled.ts` needs them to know which
 * segments exist, so that it can switch off the ones not being drawn.
 */
export const displaysInFlow = (flow: readonly FlowRule[]): WledDisplay[] =>
    flow.flatMap(rule => {
        const action = rule.action;
        if (action.do === 'show') {
            return action.display === undefined ? [] : [action.display];
        }
        if (action.do === 'loop') {
            return action.members.flatMap(member => member.display === undefined ? [] : [member.display]);
        }
        return [];
    });

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
 * Keyed by member id rather than by position so that reordering a loop's
 * members in the editor cannot silently point at a different one, and so
 * that what the panel is doing survives being written into `/api/state`.
 */
export type LoopState = {
    memberId: string,
    sinceMilliseconds: number,
    /**
     * Whether this loop held the panel at the previous decision. Without it,
     * "resume where it left off" would have to be inferred from elapsed time,
     * which makes the result depend on how often the caller ticks.
     */
    wasActive: boolean,
};
