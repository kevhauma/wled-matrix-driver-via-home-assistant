import { createEntityStore } from '../homeAssistant/entityStore.ts';

/**
 * The compressed diff format is the part of this service that can be wrong
 * without looking wrong: a mishandled diff gives plausible but stale state
 * rather than an error. These run against fixtures, with no Home Assistant.
 */

const assert = (condition: boolean, message: string): void => {
    if (!condition) {
        throw new Error(message);
    }
};

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    const same = actual === expected;
    assert(same, `${message}: expected ${String(expected)}, got ${String(actual)}`);
};

/** 2024-01-01T00:00:00Z, in the epoch seconds the wire format uses. */
const BASE_SECONDS = 1_704_067_200;

const snapshot = {
    a: {
        'media_player.speaker': {
            s: 'playing',
            a: {
                media_title: 'Superstitious Fantasy',
                media_artist: 'Windwaker',
                media_position: 12,
                volume_level: 0.11,
            },
            lc: BASE_SECONDS,
        },
        'sensor.battery_charge': {
            s: '64',
            a: { unit_of_measurement: '%', device_class: 'battery' },
            lc: BASE_SECONDS,
        },
    },
};

Deno.test('a snapshot becomes whole entity states', () => {
    const store = createEntityStore();
    const touched = store.apply(snapshot);

    assertSame(touched.length, 2, 'both entities reported as touched');

    const speaker = store.lookup('media_player.speaker');
    assertSame(speaker?.state, 'playing', 'state');
    assertSame(speaker?.attributes.media_artist, 'Windwaker', 'attribute');
    assertSame(speaker?.lastChanged, BASE_SECONDS * 1000, 'lc converted to milliseconds');
    assertSame(speaker?.lastUpdated, BASE_SECONDS * 1000, 'lu defaults to lc');
});

Deno.test('a changed attribute merges rather than replacing the set', () => {
    const store = createEntityStore();
    store.apply(snapshot);

    store.apply({
        c: {
            'media_player.speaker': {
                '+': { a: { media_position: 34 }, lu: BASE_SECONDS + 22 },
            },
        },
    });

    const speaker = store.lookup('media_player.speaker');
    assertSame(speaker?.attributes.media_position, 34, 'the changed attribute');
    assertSame(speaker?.attributes.media_artist, 'Windwaker', 'an attribute the diff left out');
    assertSame(speaker?.attributes.volume_level, 0.11, 'another untouched attribute');
    assertSame(speaker?.state, 'playing', 'the state a diff without `s` leaves alone');
});

Deno.test('`lu` alone moves only last_updated, `lc` moves both', () => {
    const store = createEntityStore();
    store.apply(snapshot);

    store.apply({
        c: { 'media_player.speaker': { '+': { lu: BASE_SECONDS + 22 } } },
    });

    const afterUpdate = store.lookup('media_player.speaker');
    assertSame(afterUpdate?.lastUpdated, (BASE_SECONDS + 22) * 1000, 'lastUpdated moved');
    assertSame(afterUpdate?.lastChanged, BASE_SECONDS * 1000, 'lastChanged held');

    store.apply({
        c: { 'media_player.speaker': { '+': { s: 'paused', lc: BASE_SECONDS + 60 } } },
    });

    const afterChange = store.lookup('media_player.speaker');
    assertSame(afterChange?.state, 'paused', 'state');
    assertSame(afterChange?.lastChanged, (BASE_SECONDS + 60) * 1000, 'lastChanged moved');
    assertSame(afterChange?.lastUpdated, (BASE_SECONDS + 60) * 1000, 'lastUpdated follows lc');
});

Deno.test('a removal list drops the named attributes only', () => {
    const store = createEntityStore();
    store.apply(snapshot);

    store.apply({
        c: {
            'media_player.speaker': {
                '+': { s: 'idle' },
                '-': { a: ['media_title', 'media_artist'] },
            },
        },
    });

    const speaker = store.lookup('media_player.speaker');
    assertSame(speaker?.attributes.media_title, undefined, 'removed attribute');
    assertSame(speaker?.attributes.media_artist, undefined, 'the other removed attribute');
    assertSame(speaker?.attributes.volume_level, 0.11, 'an attribute not named for removal');
    assertSame(speaker?.state, 'idle', 'state');
});

Deno.test('a diff for an entity with no snapshot is ignored', () => {
    const store = createEntityStore();
    const touched = store.apply({
        c: { 'sensor.never_seen': { '+': { s: '5' } } },
    });

    assertSame(touched.length, 0, 'nothing reported as touched');
    assertSame(store.lookup('sensor.never_seen'), undefined, 'no half-built entity stored');
});

Deno.test('a removal takes the entity out of the store', () => {
    const store = createEntityStore();
    store.apply(snapshot);

    const touched = store.apply({ r: ['sensor.battery_charge'] });

    assertSame(touched.length, 1, 'the removal reported as touched');
    assertSame(store.lookup('sensor.battery_charge'), undefined, 'entity gone');
    assert(store.lookup('media_player.speaker') !== undefined, 'the other entity kept');
});

Deno.test('clear empties the store for a reconnect', () => {
    const store = createEntityStore();
    store.apply(snapshot);
    store.clear();

    assertSame(store.lookup('media_player.speaker'), undefined, 'nothing kept across a reconnect');
});
