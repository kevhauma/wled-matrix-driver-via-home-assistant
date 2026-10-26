import { toWallClock, WallClock } from './builtins.ts';
import { WledDisplay } from './entities.ts';
import { Condition, FlowRule, LoopMember, LoopState, TimeCondition } from './flow.ts';
import { Reading } from './readings.ts';

/**
 * The one decision in the service: given every current reading, what belongs on
 * the panel right now.
 *
 * The order used to be written here in code. It is now the order of the rules
 * in the flow: the first rule whose conditions match decides, and a rule with
 * no conditions always matches, which is how the trailing OTHERWISE block
 * works. A `loop` action is the exception — it declines to match when none of
 * its members can take a turn, for want of a reading or because its own `when`
 * does not match, so a panel of dropped sensors falls through to whatever
 * comes next instead of showing nothing.
 *
 * Still a pure function, which is the point: a loop's position comes in and the
 * next one goes out, rather than being hidden in a counter here. That is what
 * lets a 47-second music interruption be tested as a list of timestamps.
 */

export type Decision =
    | { show: 'nothing', reason: string }
    | {
        show: 'entity',
        entityId: string,
        /** Set when the flow overrides the entity's own display here. */
        display?: WledDisplay,
    };

const toShown = ({ entityId, display }: { entityId: string, display?: WledDisplay }): Decision =>
    display === undefined ? { show: 'entity', entityId } : { show: 'entity', entityId, display };

export type PanelInput = {
    flow: readonly FlowRule[],
    readings: ReadonlyMap<string, Reading>,
    /**
     * Raw Home Assistant state strings, which `Reading` throws away for
     * numeric kinds. Only `equals` needs them.
     */
    states: ReadonlyMap<string, string>,
    atMilliseconds: number,
    /** What a time window is read in. Empty means the host's own zone. */
    timeZone: string,
    /** Where each loop rule had got to, keyed by `FlowRule.id`. */
    loops: ReadonlyMap<string, LoopState>,
};

export type PanelOutput = {
    decision: Decision,
    /** Pass back in on the next call; this is the whole of the rotation's memory. */
    loops: ReadonlyMap<string, LoopState>,
    /** Which rule decided, so the editor can mark it. Absent when none matched. */
    matchedRuleId: string | undefined,
};

const toNumber = (reading: Reading | undefined): number | undefined => {
    if (reading?.kind === 'percent') {
        return reading.percent;
    }
    if (reading?.kind === 'temperature') {
        return reading.degrees;
    }
    return undefined;
};

/**
 * `isPlaying` reads the parsed reading rather than the raw state, so it only
 * means anything for an entity whose kind is `text` — which is what a media
 * player is.
 */
const isPlaying = (reading: Reading | undefined): boolean =>
    reading?.kind === 'text' && reading.isPlaying;

const hasReading = (reading: Reading | undefined): boolean =>
    reading !== undefined && reading.kind !== 'unavailable';

const toMinutes = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
};

/**
 * The panel's time, because a window is written as a wall-clock time — read in
 * the same zone as the clock it sits beside.
 */
const isWithinWindow = (condition: TimeCondition, clock: WallClock): boolean => {
    const now = clock.hours * 60 + clock.minutes;
    const start = toMinutes(condition.from);
    const end = toMinutes(condition.to);
    if (start < end) {
        return now >= start && now < end;
    }
    // Runs past midnight.
    return now >= start || now < end;
};

const matchesCondition = (
    condition: Condition,
    readings: ReadonlyMap<string, Reading>,
    states: ReadonlyMap<string, string>,
    clock: WallClock,
): boolean => {
    if (condition.test === 'timeBetween') {
        return isWithinWindow(condition, clock);
    }

    const reading = readings.get(condition.entityId);

    switch (condition.test) {
        case 'isPlaying':
            return isPlaying(reading);
        case 'isNotPlaying':
            return !isPlaying(reading);
        case 'isAvailable':
            return hasReading(reading);
        case 'isUnavailable':
            return !hasReading(reading);
        case 'above': {
            const value = toNumber(reading);
            const threshold = Number(condition.value);
            return value !== undefined && Number.isFinite(threshold) && value > threshold;
        }
        case 'below': {
            const value = toNumber(reading);
            const threshold = Number(condition.value);
            return value !== undefined && Number.isFinite(threshold) && value < threshold;
        }
        case 'equals': {
            const state = states.get(condition.entityId) ?? '';
            const expected = String(condition.value ?? '');
            return state === expected;
        }
    }
};

/** A rule's conditions, or a loop member's `when`: the same test either way. */
const matchesConditions = (
    { match, conditions }: { match: 'all' | 'any', conditions: readonly Condition[] },
    readings: ReadonlyMap<string, Reading>,
    states: ReadonlyMap<string, string>,
    clock: WallClock,
): boolean => {
    if (conditions.length === 0) {
        return true;
    }

    const results = conditions.map(condition => {
        const matched = matchesCondition(condition, readings, states, clock);
        return matched;
    });

    return match === 'any' ? results.includes(true) : !results.includes(false);
};

/**
 * The members of a loop that actually have something to show, and whose own
 * `when`, if they have one, matches now.
 */
const availableMembers = (
    members: readonly LoopMember[],
    readings: ReadonlyMap<string, Reading>,
    states: ReadonlyMap<string, string>,
    clock: WallClock,
): LoopMember[] =>
    members.filter(member => {
        const reading = readings.get(member.entityId);
        if (!hasReading(reading)) {
            return false;
        }
        return member.when === undefined || matchesConditions(member.when, readings, states, clock);
    });

/**
 * Which member of this loop is up now, given where it had got to.
 *
 * Coming back after an interruption keeps the member it was on and gives it a
 * whole fresh dwell, rather than counting the interruption against it: after
 * forty seconds of music you want a proper look at the sensor, not a flash of
 * it followed by an immediate jump, which reads as a bug.
 */
const advanceLoop = (
    previous: LoopState | undefined,
    memberIds: readonly string[],
    dwellSeconds: number,
    atMilliseconds: number,
): LoopState => {
    if (previous === undefined) {
        return { memberId: memberIds[0], sinceMilliseconds: atMilliseconds, wasActive: true };
    }

    // Keyed by id, so a member that has gone away hands the turn to the first
    // one rather than to whoever inherited its position.
    const isStillAMember = memberIds.includes(previous.memberId);
    const current = isStillAMember ? previous.memberId : memberIds[0];

    if (!previous.wasActive) {
        return { memberId: current, sinceMilliseconds: atMilliseconds, wasActive: true };
    }

    const elapsed = atMilliseconds - previous.sinceMilliseconds;
    const isDue = elapsed >= dwellSeconds * 1000;
    if (!isDue) {
        return { memberId: current, sinceMilliseconds: previous.sinceMilliseconds, wasActive: true };
    }

    const position = memberIds.indexOf(current);
    const next = memberIds[(position + 1) % memberIds.length];
    return { memberId: next, sinceMilliseconds: atMilliseconds, wasActive: true };
};

export const decidePanel = (
    { flow, readings, states, atMilliseconds, timeZone, loops }: PanelInput,
): PanelOutput => {
    const nextLoops = new Map<string, LoopState>();
    const clock = toWallClock(new Date(atMilliseconds), timeZone);

    /**
     * Every loop that did not win keeps exactly where it was, only marked as
     * no longer holding the panel. Its elapsed time is then never consulted
     * again, so how often the caller ticks cannot change the outcome.
     */
    const carryForward = (winnerId: string | undefined): void => {
        for (const rule of flow) {
            if (rule.action.do !== 'loop' || rule.id === winnerId) {
                continue;
            }
            const previous = loops.get(rule.id);
            if (previous === undefined) {
                continue;
            }
            nextLoops.set(rule.id, { ...previous, wasActive: false });
        }
    };

    for (const rule of flow) {
        const matched = matchesConditions(rule, readings, states, clock);
        if (!matched) {
            continue;
        }

        const reason = rule.label ?? rule.id;

        if (rule.action.do === 'blank') {
            carryForward(undefined);
            return { decision: { show: 'nothing', reason }, loops: nextLoops, matchedRuleId: rule.id };
        }

        if (rule.action.do === 'show') {
            carryForward(undefined);
            const decision = toShown(rule.action);
            return { decision, loops: nextLoops, matchedRuleId: rule.id };
        }

        const members = availableMembers(rule.action.members, readings, states, clock);
        if (members.length === 0) {
            // Nothing to take a turn, so this rule does not apply at all.
            continue;
        }

        const previous = loops.get(rule.id);
        const memberIds = members.map(member => member.id);
        const state = advanceLoop(previous, memberIds, rule.action.dwellSeconds, atMilliseconds);
        carryForward(rule.id);
        nextLoops.set(rule.id, state);
        const member = members.find(candidate => candidate.id === state.memberId) ?? members[0];
        const decision = toShown(member);
        return { decision, loops: nextLoops, matchedRuleId: rule.id };
    }

    carryForward(undefined);
    const decision: Decision = { show: 'nothing', reason: 'no rule matched' };
    return { decision, loops: nextLoops, matchedRuleId: undefined };
};
