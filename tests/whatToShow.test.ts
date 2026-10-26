import { EntityIds } from '../entities.ts';
import { FlowRule, LoopState } from '../flow.ts';
import { defaultFlow } from '../panelConfig.ts';
import { Reading } from '../readings.ts';
import { Decision, decidePanel } from '../whatToShow.ts';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const PLAYING: Reading = { kind: 'text', candidates: ['Lucid - Windwaker', 'Lucid'], isPlaying: true };
const PAUSED: Reading = { kind: 'text', candidates: ['Lucid - Windwaker', 'Lucid'], isPlaying: false };
const OFF: Reading = { kind: 'text', candidates: ['off'], isPlaying: false };
const TEMPERATURE: Reading = { kind: 'temperature', degrees: 18.4, unit: 'C' };
const BATTERY: Reading = { kind: 'percent', percent: 64 };

const ROTATE_SECONDS = 5;

const FLOW = defaultFlow(ROTATE_SECONDS);

/** Only `equals` reads the raw states, and no test here uses it. */
const toStates = (readings: Record<string, Reading>): Map<string, string> => {
    const entries = Object.keys(readings).map(entityId => {
        const reading = readings[entityId];
        const state = reading.kind === 'unavailable' ? 'unavailable' : 'on';
        return [entityId, state] as const;
    });
    return new Map(entries);
};

const decide = (
    readings: Record<string, Reading>,
    atMilliseconds = 0,
): Decision => {
    const states = toStates(readings);
    const outcome = decidePanel({
        flow: FLOW,
        readings: new Map(Object.entries(readings)),
        states,
        atMilliseconds,
        timeZone: '',
        loops: new Map(),
    });
    return outcome.decision;
};

/**
 * The rotation has memory now, so its tests have to play the moments in order
 * and carry the result forward, the way the running service does.
 */
const decideOverTime = (
    readings: Record<string, Reading>,
    moments: readonly number[],
): Decision[] => {
    const states = toStates(readings);
    const parsed = new Map(Object.entries(readings));
    let loops: ReadonlyMap<string, LoopState> = new Map();

    return moments.map(atMilliseconds => {
        const outcome = decidePanel({ flow: FLOW, readings: parsed, states, atMilliseconds, timeZone: '', loops });
        loops = outcome.loops;
        return outcome.decision;
    });
};

const EVERYTHING_IDLE = {
    [EntityIds.Speaker]: OFF,
    [EntityIds.Television]: OFF,
    [EntityIds.Temperature]: TEMPERATURE,
    [EntityIds.Battery]: BATTERY,
};

Deno.test('music playing takes the panel', () => {
    const decision = decide({ ...EVERYTHING_IDLE, [EntityIds.Speaker]: PLAYING });

    assertSame(decision.show, 'entity', 'shows something');
    assertSame(decision.show === 'entity' && decision.entityId, EntityIds.Speaker, 'the speaker');
});

Deno.test('the television blanks the panel even while music plays', () => {
    const decision = decide({
        ...EVERYTHING_IDLE,
        [EntityIds.Speaker]: PLAYING,
        [EntityIds.Television]: PLAYING,
    });

    assertSame(decision.show, 'nothing', 'nothing is shown');
    assertSame(
        decision.show === 'nothing' && decision.reason,
        'the television is playing',
        'and says why',
    );
});

Deno.test('paused music does not hold the panel', () => {
    const decision = decide({ ...EVERYTHING_IDLE, [EntityIds.Speaker]: PAUSED });

    assertSame(decision.show, 'entity', 'shows something');
    const isRotating = decision.show === 'entity'
        && decision.entityId !== EntityIds.Speaker;
    assertSame(isRotating, true, 'the rotation took over');
});

Deno.test('the rotation takes turns on the clock', () => {
    const moments = [0, 4_999, 5_000, 10_000];
    const [first, stillFirst, second, backToFirst] = decideOverTime(EVERYTHING_IDLE, moments);

    const firstId = first.show === 'entity' ? first.entityId : '';
    const secondId = second.show === 'entity' ? second.entityId : '';

    assertSame(firstId, EntityIds.Temperature, 'starts on the first rotating entity');
    assertSame(stillFirst.show === 'entity' && stillFirst.entityId, firstId, 'held for the full slot');
    assertSame(secondId, EntityIds.Battery, 'moved on at the slot boundary');
    assertSame(backToFirst.show === 'entity' && backToFirst.entityId, firstId, 'wrapped around');
});

Deno.test('an unavailable sensor is left out of the rotation', () => {
    const readings = { ...EVERYTHING_IDLE, [EntityIds.Temperature]: { kind: 'unavailable' } as Reading };

    const [first, second] = decideOverTime(readings, [0, 5_000]);

    assertSame(first.show === 'entity' && first.entityId, EntityIds.Battery, 'skipped to the battery');
    assertSame(second.show === 'entity' && second.entityId, EntityIds.Battery, 'and stays there');
});

Deno.test('nothing playing and no readings leaves the panel off', () => {
    const decision = decide({
        [EntityIds.Speaker]: OFF,
        [EntityIds.Television]: OFF,
        [EntityIds.Temperature]: { kind: 'unavailable' },
        [EntityIds.Battery]: { kind: 'unavailable' },
    });

    assertSame(decision.show, 'nothing', 'nothing is shown');
});

Deno.test('an empty readings map does not throw', () => {
    const decision = decide({});
    assertSame(decision.show, 'nothing', 'nothing is shown');
});

/** The default sensors' rotation, with the battery taking a turn only when low. */
const LOW_BATTERY_FLOW: FlowRule[] = [
    {
        id: 'sensors',
        match: 'all',
        conditions: [],
        action: {
            do: 'loop',
            members: [
                { id: 'temperature', entityId: EntityIds.Temperature },
                {
                    id: 'battery',
                    entityId: EntityIds.Battery,
                    when: { match: 'all', conditions: [{ entityId: EntityIds.Battery, test: 'below', value: 20 }] },
                },
            ],
            dwellSeconds: ROTATE_SECONDS,
        },
    },
    { id: 'idle', match: 'all', conditions: [], action: { do: 'blank' } },
];

const decideLowBattery = (readings: Record<string, Reading>, moments: readonly number[]): Decision[] => {
    let loops: ReadonlyMap<string, LoopState> = new Map();
    return moments.map(atMilliseconds => {
        const outcome = decidePanel({
            flow: LOW_BATTERY_FLOW,
            readings: new Map(Object.entries(readings)),
            states: toStates(readings),
            atMilliseconds,
            timeZone: '',
            loops,
        });
        loops = outcome.loops;
        return outcome.decision;
    });
};

const shownIds = (decisions: Decision[]): string =>
    decisions.map(decision => decision.show === 'entity' ? decision.entityId : 'nothing').join(' ');

Deno.test('a member whose own when does not match is left out of the rotation', () => {
    const decisions = decideLowBattery({ [EntityIds.Temperature]: TEMPERATURE, [EntityIds.Battery]: BATTERY }, [
        0,
        5_000,
        10_000,
    ]);

    const temperature = EntityIds.Temperature;
    assertSame(shownIds(decisions), `${temperature} ${temperature} ${temperature}`, 'the battery never takes a turn');
});

Deno.test('a member whose own when matches takes its turn', () => {
    const low: Reading = { kind: 'percent', percent: 12 };
    const decisions = decideLowBattery({ [EntityIds.Temperature]: TEMPERATURE, [EntityIds.Battery]: low }, [0, 5_000]);

    assertSame(shownIds(decisions), `${EntityIds.Temperature} ${EntityIds.Battery}`, 'they alternate');
});

Deno.test('a loop whose every member is left out by its when declines, so the next rule runs', () => {
    const decisions = decideLowBattery({ [EntityIds.Battery]: BATTERY }, [0]);

    assertSame(shownIds(decisions), 'nothing', 'fell through to idle');
});
