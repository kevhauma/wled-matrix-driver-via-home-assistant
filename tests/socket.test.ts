import { isBuiltinId } from '../builtins.ts';
import { EntityIds, PANEL_ENTITIES } from '../entities.ts';
import { EntityLookup } from '../homeAssistant/entityStore.ts';
import { ConnectionStates, createHomeAssistantSocket } from '../homeAssistant/socket.ts';
import { CompressedStateEvent } from '../homeAssistant/types.ts';
import { defaultFlow } from '../panelConfig.ts';
import { Reading, readEntity } from '../readings.ts';
import { decidePanel } from '../whatToShow.ts';
import { startFakeHomeAssistant } from './fakeHomeAssistant.ts';

/**
 * Drives the real socket against a server that speaks the Home Assistant
 * handshake, so auth, the subscription and the diff stream are exercised
 * without a token or a running Home Assistant.
 */

const TOKEN = 'long-lived-test-token';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const waitFor = async (condition: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + 5_000;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${label}`);
        }
        const tick = new Promise<void>(resolve => {
            setTimeout(resolve, 10);
        });
        await tick;
    }
};

const SECONDS = 1_704_067_200;

const SNAPSHOT: CompressedStateEvent = {
    a: {
        [EntityIds.Speaker]: {
            s: 'playing',
            a: { media_title: 'Superstitious Fantasy', media_artist: 'Windwaker' },
            lc: SECONDS,
        },
        [EntityIds.Television]: { s: 'off', a: {}, lc: SECONDS },
        [EntityIds.Temperature]: { s: '18.4', a: { unit_of_measurement: 'C' }, lc: SECONDS },
        [EntityIds.Battery]: { s: '64', a: { unit_of_measurement: '%' }, lc: SECONDS },
    },
};

/** Built-in items are read from the clock, so `bridge.ts` never subscribes to
 * them; the same filter is applied here so this drives the real set. */
const HOME_ASSISTANT_ENTITIES = PANEL_ENTITIES.filter(entity => !isBuiltinId(entity.entityId));
const ENTITY_IDS = HOME_ASSISTANT_ENTITIES.map(entity => entity.entityId);
/** The socket reads this on each subscribe, so the set can change at runtime. */
const entityIds = () => ENTITY_IDS;

/** The same path `main.ts` takes: lookup -> parse per entity -> one decision. */
const decideFrom = (lookup: EntityLookup) => {
    const readings = new Map<string, Reading>();
    const states = new Map<string, string>();
    for (const entity of HOME_ASSISTANT_ENTITIES) {
        const state = lookup(entity.entityId);
        const reading = readEntity(state, entity.kind);
        readings.set(entity.entityId, reading);
        states.set(entity.entityId, state?.state ?? '');
    }
    const flow = defaultFlow(5);
    const outcome = decidePanel({ flow, readings, states, atMilliseconds: 0, timeZone: '', loops: new Map() });
    return outcome.decision;
};

Deno.test('a subscription feeds the decision, and diffs keep it current', async () => {
    const fake = startFakeHomeAssistant({ snapshot: SNAPSHOT, expectedToken: TOKEN });
    const decisions: string[] = [];
    const errors: unknown[] = [];

    const socket = createHomeAssistantSocket({
        baseUrl: fake.baseUrl,
        token: TOKEN,
        entityIds,
        onConnectionState: () => {},
        onUpdate: ({ lookup }) => {
            const decision = decideFrom(lookup);
            const text = decision.show === 'nothing' ? `off: ${decision.reason}` : decision.entityId;
            decisions.push(text);
        },
        onError: error => {
            errors.push(error);
        },
    });

    socket.start();
    await waitFor(() => decisions.length >= 1, 'the snapshot decision');

    assertSame(errors.length, 0, 'no errors');
    assertSame(decisions[0], EntityIds.Speaker, 'music playing takes the panel');

    // A partial attribute diff: the artist is not resent, and must survive.
    fake.push({ c: { [EntityIds.Speaker]: { '+': { a: { media_title: 'Lucid' } } } } });
    await waitFor(() => decisions.length >= 2, 'the track change');
    assertSame(decisions[1], EntityIds.Speaker, 'still the speaker');

    fake.push({ c: { [EntityIds.Television]: { '+': { s: 'playing' } } } });
    await waitFor(() => decisions.length >= 3, 'the television waking');
    assertSame(decisions[2], 'off: the television is playing', 'the TV blanked the panel');

    await socket.stop();
    await fake.close();
});

Deno.test('a dropped connection comes back with a fresh snapshot', async () => {
    const fake = startFakeHomeAssistant({ snapshot: SNAPSHOT, expectedToken: TOKEN });
    const states: string[] = [];
    const decisions: string[] = [];
    const errors: unknown[] = [];

    const socket = createHomeAssistantSocket({
        baseUrl: fake.baseUrl,
        token: TOKEN,
        entityIds,
        onConnectionState: state => {
            states.push(state);
        },
        onUpdate: ({ lookup }) => {
            const decision = decideFrom(lookup);
            const text = decision.show === 'nothing' ? `off: ${decision.reason}` : decision.entityId;
            decisions.push(text);
        },
        onError: error => {
            errors.push(error);
        },
    });

    socket.start();
    await waitFor(() => decisions.length >= 1, 'the first snapshot');

    /**
     * The world moves on while the service is away. A push-based service would
     * have missed it; the point of a subscription is that reconnecting is
     * itself the catch-up.
     */
    fake.setSnapshot({
        a: {
            [EntityIds.Speaker]: { s: 'off', a: {}, lc: SECONDS + 600 },
            [EntityIds.Television]: { s: 'playing', a: {}, lc: SECONDS + 600 },
            [EntityIds.Temperature]: { s: '18.4', a: { unit_of_measurement: 'C' }, lc: SECONDS + 600 },
            [EntityIds.Battery]: { s: '91', a: { unit_of_measurement: '%' }, lc: SECONDS + 600 },
        },
    });
    fake.dropConnection();

    await waitFor(() => decisions.length >= 2, 'the decision after reconnecting');

    assertSame(errors.length, 0, 'a dropped connection is not an error');
    assertSame(states.includes(ConnectionStates.Reconnecting), true, 'noticed the drop');
    assertSame(decisions.at(-1), 'off: the television is playing', 'caught up on what it missed');

    await socket.stop();
    await fake.close();
});

Deno.test('a rejected token is reported once rather than retried', async () => {
    const fake = startFakeHomeAssistant({ snapshot: SNAPSHOT, expectedToken: 'some-other-token' });
    const errors: unknown[] = [];
    const states: string[] = [];

    const socket = createHomeAssistantSocket({
        baseUrl: fake.baseUrl,
        token: TOKEN,
        entityIds,
        onConnectionState: state => {
            states.push(state);
        },
        onUpdate: () => {},
        onError: error => {
            errors.push(error);
        },
    });

    socket.start();
    await waitFor(() => errors.length > 0, 'the auth failure');

    const first = errors[0];
    const message = first instanceof Error ? first.message : String(first);
    assertSame(message.includes('rejected HA_TOKEN'), true, `names the cause, got: ${message}`);
    assertSame(states.includes(ConnectionStates.Reconnecting), false, 'did not schedule a retry');

    await socket.stop();
    await fake.close();
});

/**
 * A panel of nothing but built-in items. Home Assistant reads a missing or
 * empty `entity_ids` as *every* entity, so an empty list must not be sent as a
 * subscription at all — and the empty snapshot still has to arrive, because
 * that is what tells the bridge it may start deciding.
 */
Deno.test('no Home Assistant entities means no subscription, but still a snapshot', async () => {
    const fake = startFakeHomeAssistant({ snapshot: SNAPSHOT, expectedToken: TOKEN });
    const states: string[] = [];
    const snapshots: number[] = [];
    const errors: unknown[] = [];

    const socket = createHomeAssistantSocket({
        baseUrl: fake.baseUrl,
        token: TOKEN,
        entityIds: () => [],
        onConnectionState: state => {
            states.push(state);
        },
        onUpdate: update => {
            if (update.isSnapshot) {
                snapshots.push(update.touched.length);
            }
        },
        onError: error => {
            errors.push(error);
        },
    });

    socket.start();
    await waitFor(() => snapshots.length >= 1, 'the empty snapshot');

    assertSame(errors.length, 0, 'no errors');
    assertSame(snapshots[0], 0, 'a snapshot carrying nothing');
    assertSame(states.includes(ConnectionStates.Live), true, 'reported as live');
    assertSame(states.includes(ConnectionStates.Subscribing), false, 'never asked to subscribe');

    await socket.stop();
    await fake.close();
});
