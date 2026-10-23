import { FlowRule, LoopState } from '../flow.ts';
import { Reading } from '../readings.ts';
import { Decision, decidePanel } from '../whatToShow.ts';

/**
 * The flow evaluator: which rule wins, and where a loop had got to. This is the
 * only genuinely new logic in the service, so it is the only thing with tests
 * of its own.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const PLAYING: Reading = { kind: 'text', candidates: ['Lucid'], isPlaying: true };
const IDLE: Reading = { kind: 'text', candidates: ['off'], isPlaying: false };
const GONE: Reading = { kind: 'unavailable' };
const WARM: Reading = { kind: 'temperature', degrees: 21.5, unit: 'C' };
const HALF: Reading = { kind: 'percent', percent: 50 };

const TEMP = 'sensor.temp';
const BATTERY = 'sensor.battery';
const SPEAKER = 'media_player.speaker';

const rule = (id: string, partial: Partial<FlowRule>): FlowRule => ({
    id,
    match: 'all',
    conditions: [],
    action: { do: 'blank' },
    ...partial,
});

type Moment = { at: number, readings: Record<string, Reading> };

/** Plays the moments in order, carrying the loop positions forward. */
const play = (flow: readonly FlowRule[], moments: readonly Moment[]): Decision[] => {
    let loops: ReadonlyMap<string, LoopState> = new Map();

    return moments.map(moment => {
        const readings = new Map(Object.entries(moment.readings));
        const states = new Map<string, string>();
        for (const [entityId, reading] of readings) {
            const state = reading.kind === 'unavailable' ? 'unavailable' : 'on';
            states.set(entityId, state);
        }
        const outcome = decidePanel({ flow, readings, states, atMilliseconds: moment.at, loops });
        loops = outcome.loops;
        return outcome.decision;
    });
};

const once = (flow: readonly FlowRule[], readings: Record<string, Reading>): Decision => {
    const decisions = play(flow, [{ at: 0, readings }]);
    return decisions[0];
};

const shownBy = (decision: Decision): string =>
    decision.show === 'entity' ? decision.entityId : `off:${decision.reason}`;

Deno.test('the first matching rule wins, and later ones are not consulted', () => {
    const flow = [
        rule('music', {
            conditions: [{ entityId: SPEAKER, test: 'isPlaying' }],
            action: { do: 'show', entityId: SPEAKER },
        }),
        rule('temp', { action: { do: 'show', entityId: TEMP } }),
    ];

    const playing = once(flow, { [SPEAKER]: PLAYING, [TEMP]: WARM });
    const quiet = once(flow, { [SPEAKER]: IDLE, [TEMP]: WARM });

    assertSame(shownBy(playing), SPEAKER, 'the earlier rule took it');
    assertSame(shownBy(quiet), TEMP, 'and gave way when it stopped matching');
});

Deno.test('a rule with no conditions always matches, which is the OTHERWISE block', () => {
    const flow = [rule('idle', { label: 'nothing doing', action: { do: 'blank' } })];

    const decision = once(flow, {});

    assertSame(decision.show, 'nothing', 'it matched with no readings at all');
    assertSame(decision.show === 'nothing' && decision.reason, 'nothing doing', 'the label is the reason');
});

Deno.test('match all needs every condition; match any needs one', () => {
    const conditions = [
        { entityId: TEMP, test: 'above' as const, value: 20 },
        { entityId: BATTERY, test: 'above' as const, value: 80 },
    ];
    const all = [rule('all', { match: 'all', conditions, action: { do: 'show', entityId: TEMP } })];
    const any = [rule('any', { match: 'any', conditions, action: { do: 'show', entityId: TEMP } })];

    const readings = { [TEMP]: WARM, [BATTERY]: HALF };

    assertSame(once(all, readings).show, 'nothing', 'all: the battery condition failed');
    assertSame(shownBy(once(any, readings)), TEMP, 'any: the temperature condition carried it');
});

Deno.test('a flow that matches nothing says so rather than throwing', () => {
    const flow = [
        rule('music', {
            conditions: [{ entityId: SPEAKER, test: 'isPlaying' }],
            action: { do: 'show', entityId: SPEAKER },
        }),
    ];

    const decision = once(flow, { [SPEAKER]: IDLE });

    assertSame(decision.show, 'nothing', 'nothing is shown');
    assertSame(decision.show === 'nothing' && decision.reason, 'no rule matched', 'and names the cause');
});

const loopFlow = (dwellSeconds: number): FlowRule[] => [
    rule('music', {
        conditions: [{ entityId: SPEAKER, test: 'isPlaying' }],
        action: { do: 'show', entityId: SPEAKER },
    }),
    rule('sensors', {
        action: { do: 'loop', entityIds: [TEMP, BATTERY], dwellSeconds },
    }),
];

Deno.test('a loop takes its members in turn once the dwell is up', () => {
    const readings = { [SPEAKER]: IDLE, [TEMP]: WARM, [BATTERY]: HALF };
    const moments = [0, 4_999, 5_000, 10_000].map(at => ({ at, readings }));

    const shown = play(loopFlow(5), moments).map(shownBy);

    assertSame(shown.join(' '), [TEMP, TEMP, BATTERY, TEMP].join(' '), 'held, advanced, wrapped');
});

Deno.test('a loop resumes on the member it was on, with a full fresh dwell', () => {
    const quiet = { [SPEAKER]: IDLE, [TEMP]: WARM, [BATTERY]: HALF };
    const music = { [SPEAKER]: PLAYING, [TEMP]: WARM, [BATTERY]: HALF };

    const shown = play(loopFlow(5), [
        { at: 0, readings: quiet },
        { at: 5_000, readings: quiet },
        { at: 10_000, readings: quiet },
        // Music takes the panel for forty-seven seconds.
        { at: 12_000, readings: music },
        { at: 59_000, readings: quiet },
        { at: 63_999, readings: quiet },
        { at: 64_000, readings: quiet },
    ]).map(shownBy);

    const expected = [TEMP, BATTERY, TEMP, SPEAKER, TEMP, TEMP, BATTERY];
    assertSame(shown.join(' '), expected.join(' '), 'resumed on the temperature for a whole dwell');
});

Deno.test('a loop whose members have all dropped off falls through', () => {
    const flow = [
        rule('sensors', { action: { do: 'loop', entityIds: [TEMP, BATTERY], dwellSeconds: 5 } }),
        rule('idle', { label: 'no sensor has a reading', action: { do: 'blank' } }),
    ];

    const decision = once(flow, { [TEMP]: GONE, [BATTERY]: GONE });

    assertSame(decision.show, 'nothing', 'the loop declined to match');
    assertSame(
        decision.show === 'nothing' && decision.reason,
        'no sensor has a reading',
        'and the next rule answered instead',
    );
});

Deno.test('a member that drops out mid-rotation hands over rather than stalling', () => {
    const both = { [SPEAKER]: IDLE, [TEMP]: WARM, [BATTERY]: HALF };
    const tempGone = { [SPEAKER]: IDLE, [TEMP]: GONE, [BATTERY]: HALF };

    const shown = play(loopFlow(5), [
        { at: 0, readings: both },
        { at: 1_000, readings: tempGone },
    ]).map(shownBy);

    assertSame(shown.join(' '), [TEMP, BATTERY].join(' '), 'took the surviving member at once');
});
