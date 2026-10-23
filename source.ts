import { createEntityStore, EntityLookup } from './homeAssistant/entityStore.ts';
import { ConnectionState, ConnectionStates, EntityUpdate } from './homeAssistant/socket.ts';
import { EntityIds } from './entities.ts';

/**
 * Where readings come from. `createHomeAssistantSocket` already satisfies
 * `Source`, so the mock below swaps in behind the same shape and the rest of the
 * service cannot tell which it is talking to.
 */

export type Source = {
    lookup: EntityLookup,
    start: () => void,
    stop: () => Promise<void>,
    clear: () => void,
};

export type SourceOptions = {
    /** Read afresh on each subscribe, so the set can change at runtime. */
    entityIds: () => readonly string[],
    onConnectionState: (state: ConnectionState, detail?: string) => void,
    onUpdate: (update: EntityUpdate) => void,
    onError: (error: unknown) => void,
};

type MockEntityState = { state: string, attributes?: Record<string, unknown> };

/** Offered by the editor's entity picker when there is no token to list with. */
export const MOCK_ENTITY_IDS: readonly string[] = Object.values(EntityIds);

/**
 * Walks the panel through every branch of the default flow: music winning, the
 * rotation, and the television blanking it. Each step names only the entities
 * it changes; the rest keep whatever the step before left them as.
 *
 * A flow the editor has changed may not use these at all; this is a script for
 * the shipped default, not a general simulator.
 */
const MOCK_STEPS: { note: string, states: Record<string, MockEntityState> }[] = [
    {
        note: 'music playing, TV off — music takes the panel',
        states: {
            [EntityIds.Speaker]: {
                state: 'playing',
                attributes: { media_title: 'Superstitious Fantasy', media_artist: 'Windwaker' },
            },
            [EntityIds.Television]: { state: 'off' },
            [EntityIds.Temperature]: { state: '18.4', attributes: { unit_of_measurement: 'C' } },
            [EntityIds.Battery]: { state: '64', attributes: { unit_of_measurement: '%' } },
        },
    },
    {
        note: 'next track — still music, new text',
        states: {
            [EntityIds.Speaker]: {
                state: 'playing',
                attributes: { media_title: 'Lucid', media_artist: 'Windwaker' },
            },
        },
    },
    {
        note: 'music paused — the rotation takes over',
        states: { [EntityIds.Speaker]: { state: 'paused' } },
    },
    {
        note: 'the battery charges while the rotation runs',
        states: { [EntityIds.Battery]: { state: '81', attributes: { unit_of_measurement: '%' } } },
    },
    {
        note: 'TV on — the panel goes dark whatever else is happening',
        states: {
            [EntityIds.Television]: { state: 'playing', attributes: { media_title: 'Taskmaster' } },
            [EntityIds.Speaker]: {
                state: 'playing',
                attributes: { media_title: 'Lucid', media_artist: 'Windwaker' },
            },
        },
    },
    {
        note: 'TV off, music still playing — music gets it back',
        states: { [EntityIds.Television]: { state: 'off' } },
    },
    {
        note: 'the temperature sensor drops off and leaves the rotation',
        states: {
            [EntityIds.Speaker]: { state: 'off' },
            [EntityIds.Temperature]: { state: 'unavailable' },
        },
    },
];

export type MockSourceOptions = SourceOptions & {
    /** How long each step of the script holds. */
    stepSeconds: number,
    onNote: (note: string) => void,
};

export const createMockSource = (
    { onConnectionState, onUpdate, stepSeconds, onNote }: MockSourceOptions,
): Source => {
    const store = createEntityStore();
    let timer: number | undefined;
    let index = 0;

    const applyNextStep = (): void => {
        const step = MOCK_STEPS[index % MOCK_STEPS.length];
        const isSnapshot = index === 0;
        index++;

        const added: Record<string, { s: string, a: Record<string, unknown>, lc: number }> = {};
        const nowSeconds = Date.now() / 1000;
        for (const [entityId, entity] of Object.entries(step.states)) {
            added[entityId] = { s: entity.state, a: entity.attributes ?? {}, lc: nowSeconds };
        }

        const touched = store.apply({ a: added });
        onNote(step.note);
        onUpdate({ lookup: store.lookup, touched, isSnapshot });
    };

    return {
        lookup: store.lookup,

        clear: () => {
            store.clear();
            index = 0;
        },

        start: () => {
            onConnectionState(ConnectionStates.Live, 'mock source, no Home Assistant');
            applyNextStep();
            timer = setInterval(applyNextStep, stepSeconds * 1000);
        },

        stop: () => {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
            onConnectionState(ConnectionStates.Stopped);
            return Promise.resolve();
        },
    };
};
