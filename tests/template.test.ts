import { fillTemplate, findPlaceholders, PlaceholderValues } from '../template.ts';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const VALUES: PlaceholderValues = {
    value: '18C',
    percent: 64,
    degrees: 18,
    unit: 'C',
    title: 'Lucid',
    artist: 'Windwaker',
};

Deno.test('a string that is nothing but a placeholder takes that value type', () => {
    const filled = fillTemplate({ ix: '{{percent}}' }, VALUES) as Record<string, unknown>;

    assertSame(filled.ix, 64, 'a number, because WLED reads ix as one');
    assertSame(typeof filled.ix, 'number', 'not the string "64"');
});

Deno.test('a placeholder inside a longer string is interpolated', () => {
    const filled = fillTemplate({ n: 'bat {{percent}}%' }, VALUES) as Record<string, unknown>;

    assertSame(filled.n, 'bat 64%', 'still text');
});

Deno.test('whitespace inside the braces is allowed', () => {
    const filled = fillTemplate({ n: '{{ title }}' }, VALUES) as Record<string, unknown>;

    assertSame(filled.n, 'Lucid', 'the same placeholder');
});

Deno.test('placeholders are filled at any depth, and nothing else is touched', () => {
    const template = {
        on: true,
        seg: [
            { id: 0, n: '{{title}}', col: [[255, 0, 0]] },
            { id: 1, ix: '{{percent}}' },
        ],
    };
    const filled = fillTemplate(template, VALUES) as Record<string, unknown>;
    const segments = filled.seg as Record<string, unknown>[];

    assertSame(filled.on, true, 'untouched');
    assertSame(segments[0].n, 'Lucid', 'filled in the first segment');
    assertSame(segments[1].ix, 64, 'and in the second');
    assertSame(JSON.stringify(segments[0].col), '[[255,0,0]]', 'colours survive the walk');
});

Deno.test('an unknown placeholder is left exactly as written', () => {
    // Validation refuses these, but the fill also runs on a draft being typed.
    const filled = fillTemplate({ n: '{{percentage}}' }, VALUES) as Record<string, unknown>;

    assertSame(filled.n, '{{percentage}}', 'untouched rather than emptied');
});

Deno.test('every placeholder is found, with the path to it', () => {
    const uses = findPlaceholders({ seg: [{ n: 'a {{title}} b {{artist}}' }] }, 'payload');

    assertSame(uses.length, 2, 'both of them');
    assertSame(uses[0].path, 'payload.seg[0].n', 'named well enough to fix');
    assertSame(uses[0].name, 'title', 'the first');
    assertSame(uses[1].name, 'artist', 'the second');
});

Deno.test('a placeholder in a key is neither found nor filled', () => {
    const uses = findPlaceholders({ '{{title}}': 1 }, 'payload');
    const filled = fillTemplate({ '{{title}}': 1 }, VALUES) as Record<string, unknown>;

    assertSame(uses.length, 0, 'keys are a fixed set, so this is a mistake not an intention');
    assertSame(filled['{{title}}'], 1, 'and the key is left alone');
});

const OUTSIDE: PlaceholderValues = { ...VALUES, value: '8C', degrees: 8 };

const others = (entityId: string): PlaceholderValues =>
    entityId === 'sensor.outside' ? OUTSIDE : { ...VALUES, value: '', degrees: 0 };

Deno.test('a dotted name reads another entity: its value, or a named one after a colon', () => {
    const filled = fillTemplate(
        { n: 'in {{value}} out {{sensor.outside}}', ix: '{{sensor.outside:degrees}}' },
        VALUES,
        others,
    ) as Record<string, unknown>;

    assertSame(filled.n, 'in 18C out 8C', 'the bare id is that entity’s value');
    assertSame(filled.ix, 8, 'and a whole-string reference keeps its type');
});

Deno.test('an entity reference is found with its id, and a bare one asks for value', () => {
    const uses = findPlaceholders('{{sensor.outside}} {{sensor.outside:unit}}', 'text');

    assertSame(uses[0].entityId, 'sensor.outside', 'the id');
    assertSame(uses[0].name, 'value', 'value when no name is given');
    assertSame(uses[1].name, 'unit', 'the named one otherwise');
});

Deno.test('with nothing to read other entities from, a reference fills empty', () => {
    const filled = fillTemplate('out {{sensor.outside}}', VALUES);

    assertSame(filled, 'out ', 'empty, as a dropped-off reading is');
});
