import { Condition, FlowRule, LoopState } from './flow.ts';
import { Reading } from './readings.ts';

/**
 * The one decision in the service: given every current reading, what belongs on
 * the panel right now.
 *
 * The order used to be written here in code. It is now the order of the rules
 * in the flow: the first rule whose conditions match decides, and a rule with
 * no conditions always matches, which is how the trailing OTHERWISE block
 * works. A `loop` action is the exception — it declines to match when none of
 * its members has a reading, so a panel of dropped sensors falls through to
 * whatever comes next instead of showing nothing.
 *
 * Still a pure function, which is the point: a loop's position comes in and the
 * next one goes out, rather than being hidden in a counter here. That is what
 * lets a 47-second music interruption be tested as a list of timestamps.
 */

export type Decision =
    | { show: 'nothing', reason: string }
    | { show: 'entity', entityId: string };

export type PanelInput = {
    flow: readonly FlowRule[],
    readings: ReadonlyMap<string, Reading>,
    /**
     * Raw Home Assistant state strings, which `Reading` throws away for
     * numeric kinds. Only `equals` needs them.
     */
    states: ReadonlyMap<string, string>,
    atMilliseconds: number,
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

const matchesCondition = (
    condition: Condition,
    readings: ReadonlyMap<string, Reading>,
    states: ReadonlyMap<string, string>,
): boolean => {
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

const matchesRule = (
    rule: FlowRule,
    readings: ReadonlyMap<string, Reading>,
    states: ReadonlyMap<string, string>,
): boolean => {
    if (rule.conditions.length === 0) {
        return true;
    }

    const results = rule.conditions.map(condition => {
        const matched = matchesCondition(condition, readings, states);
        return matched;
    });

    return rule.match === 'any' ? results.includes(true) : !results.includes(false);
};

/** The members of a loop that actually have something to show. */
const availableMembers = (
    entityIds: readonly string[],
    readings: ReadonlyMap<string, Reading>,
): string[] =>
    entityIds.filter(entityId => {
        const reading = readings.get(entityId);
        return hasReading(reading);
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
    members: readonly string[],
    dwellSeconds: number,
    atMilliseconds: number,
): LoopState => {
    if (previous === undefined) {
        return { entityId: members[0], sinceMilliseconds: atMilliseconds, wasActive: true };
    }

    // Keyed by id, so a member that has gone away hands the turn to the first
    // one rather than to whoever inherited its position.
    const isStillAMember = members.includes(previous.entityId);
    const current = isStillAMember ? previous.entityId : members[0];

    if (!previous.wasActive) {
        return { entityId: current, sinceMilliseconds: atMilliseconds, wasActive: true };
    }

    const elapsed = atMilliseconds - previous.sinceMilliseconds;
    const isDue = elapsed >= dwellSeconds * 1000;
    if (!isDue) {
        return { entityId: current, sinceMilliseconds: previous.sinceMilliseconds, wasActive: true };
    }

    const position = members.indexOf(current);
    const next = members[(position + 1) % members.length];
    return { entityId: next, sinceMilliseconds: atMilliseconds, wasActive: true };
};

export const decidePanel = (
    { flow, readings, states, atMilliseconds, loops }: PanelInput,
): PanelOutput => {
    const nextLoops = new Map<string, LoopState>();

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
        const matched = matchesRule(rule, readings, states);
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
            const decision: Decision = { show: 'entity', entityId: rule.action.entityId };
            return { decision, loops: nextLoops, matchedRuleId: rule.id };
        }

        const members = availableMembers(rule.action.entityIds, readings);
        if (members.length === 0) {
            // Nothing to take a turn, so this rule does not apply at all.
            continue;
        }

        const previous = loops.get(rule.id);
        const state = advanceLoop(previous, members, rule.action.dwellSeconds, atMilliseconds);
        carryForward(rule.id);
        nextLoops.set(rule.id, state);
        const decision: Decision = { show: 'entity', entityId: state.entityId };
        return { decision, loops: nextLoops, matchedRuleId: rule.id };
    }

    carryForward(undefined);
    const decision: Decision = { show: 'nothing', reason: 'no rule matched' };
    return { decision, loops: nextLoops, matchedRuleId: undefined };
};
