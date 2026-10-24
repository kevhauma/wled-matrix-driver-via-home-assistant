import { toWallClock } from '../builtins.ts';
import { builtinItems, DEFAULT_LIMIT, LibraryItem, MAX_LIMIT, selectLibrary, toFilters, toLibraryItem, toLimit } from '../library.ts';

/**
 * What the picker is sent. These are about the large installation, which is
 * the case the picker exists for: the list is filtered, ordered and cut, and
 * the counts have to say what was cut so the editor can ask for a narrower
 * filter rather than quietly showing half an answer.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const entity = (entityId: string, friendlyName = '', deviceClass = ''): LibraryItem => ({
    entityId,
    state: 'on',
    friendlyName,
    deviceClass,
    unit: '',
    source: 'homeAssistant',
});

const AT = toWallClock(new Date(2026, 9, 22, 14, 32, 5), '');

Deno.test('a page says how many matched and how many there are in all', () => {
    const items = [entity('sensor.a'), entity('sensor.b'), entity('light.c')];
    const page = selectLibrary({ items, filters: ['sensor.'], limit: 10 });

    assertSame(page.items.length, 2, 'the two sensors');
    assertSame(page.matched, 2, 'how many matched');
    assertSame(page.total, 3, 'how many there are');
});

Deno.test('more matches than the limit are cut, and the count still reports them', () => {
    const items = Array.from({ length: 400 }, (_, index) => entity(`sensor.s${index}`));
    const page = selectLibrary({ items, filters: [], limit: 50 });

    assertSame(page.items.length, 50, 'a window');
    assertSame(page.matched, 400, 'but it knows what it left out');
    assertSame(page.total, 400, 'and the total');
});

/**
 * Two items against a few thousand entities, so a built-in that matched must
 * not be the thing that falls off the end of a truncated page.
 */
Deno.test('the built-in items come first, whatever their ids sort like', () => {
    const items = [...builtinItems(AT), entity('automation.aaa')];
    const page = selectLibrary({ items, filters: [], limit: 10 });

    assertSame(page.items[0].entityId, 'builtin.time', 'the clock');
    assertSame(page.items[1].entityId, 'builtin.date', 'then the date');
    assertSame(page.items[2].entityId, 'automation.aaa', 'then Home Assistant, sorted');
});

Deno.test('the built-in rows carry what they say now and the format to start on', () => {
    const items = builtinItems(AT);
    const clock = items.find(item => item.entityId === 'builtin.time');

    assertSame(clock?.state, '14:32', 'the state column shows the live value');
    assertSame(clock?.format, 'hour24', 'the format a freshly added one gets');
    assertSame(clock?.source, 'builtin', 'marked, so the picker can badge it');
});

Deno.test('Home Assistant entities are sorted by id, not left in arrival order', () => {
    const items = [entity('sensor.z'), entity('sensor.a'), entity('sensor.m')];
    const page = selectLibrary({ items, filters: [], limit: 10 });
    const ids = page.items.map(item => item.entityId).join(' ');

    assertSame(ids, 'sensor.a sensor.m sensor.z', 'alphabetical');
});

Deno.test('filters are an OR over the id, the name and the device class', () => {
    const items = [
        entity('sensor.one', 'Kitchen humidity', 'humidity'),
        entity('sensor.two', 'Hallway motion', 'motion'),
        entity('light.three', 'Kitchen ceiling', ''),
    ];

    const byName = selectLibrary({ items, filters: toFilters('kitchen'), limit: 10 });
    assertSame(byName.matched, 2, 'the friendly name matches');

    const byClass = selectLibrary({ items, filters: toFilters('motion'), limit: 10 });
    assertSame(byClass.matched, 1, 'the device class matches');

    const either = selectLibrary({ items, filters: toFilters('motion humidity'), limit: 10 });
    assertSame(either.matched, 2, 'two terms are an OR, not an AND');
});

Deno.test('a query of nothing but spaces is no filter at all', () => {
    const filters = toFilters('   ');
    assertSame(filters.length, 0, 'no terms');
});

Deno.test('a limit that makes no sense falls back rather than failing the request', () => {
    assertSame(toLimit(null), DEFAULT_LIMIT, 'absent');
    assertSame(toLimit(''), DEFAULT_LIMIT, 'empty');
    assertSame(toLimit('nonsense'), DEFAULT_LIMIT, 'not a number');
    assertSame(toLimit('0'), DEFAULT_LIMIT, 'below one');
    assertSame(toLimit('9999'), MAX_LIMIT, 'capped, so one request cannot ask for everything');
    assertSame(toLimit('25'), 25, 'a sensible one is honoured');
});

Deno.test('a REST state becomes a row with its name, class and unit', () => {
    const item = toLibraryItem({
        entity_id: 'sensor.kitchen_temperature',
        state: '18.4',
        attributes: {
            friendly_name: 'Kitchen temperature',
            device_class: 'temperature',
            unit_of_measurement: 'C',
        },
    });

    assertSame(item.friendlyName, 'Kitchen temperature', 'the name');
    assertSame(item.deviceClass, 'temperature', 'the class the kind guess reads');
    assertSame(item.unit, 'C', 'the unit');
    assertSame(item.source, 'homeAssistant', 'not a built-in');
});
