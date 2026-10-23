import { PanelConfig, parsePanelConfig } from '../panelConfig.ts';

/**
 * The validator both `panel.config.json` and `PUT /api/config` go through.
 * These cover the custom display, which is the one part of the configuration
 * holding JSON the project does not otherwise understand.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const withCustomPayload = (payload: unknown): unknown => ({
    version: 2,
    output: { wledIp: '', brightness: 80 },
    entities: [{ entityId: 'sensor.a', kind: 'percent', display: { style: 'custom', payload } }],
    flow: [{ id: 'always', match: 'all', conditions: [], action: { do: 'blank' } }],
});

const refusal = (payload: unknown): string => {
    const config = withCustomPayload(payload);
    try {
        parsePanelConfig(config);
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('it was accepted, and should not have been');
};

const accept = (payload: unknown): PanelConfig => {
    const config = withCustomPayload(payload);
    const parsed = parsePanelConfig(config);
    return parsed;
};

const WORKING = {
    on: true,
    seg: [
        { id: 0, fx: 122, n: '{{value}}', sx: 80, ix: 128, c2: 0 },
        { id: 1, fx: 98, ix: '{{percent}}', sx: 255, o1: true },
    ],
};

Deno.test('a two-segment custom body survives validation unchanged', () => {
    const parsed = accept(WORKING);
    const display = parsed.entities[0].display;

    assertSame(display.style, 'custom', 'kept its style');
    assertSame(
        JSON.stringify(display.style === 'custom' ? display.payload : null),
        JSON.stringify(WORKING),
        'and the body is stored as written',
    );
});

Deno.test('a typo in a placeholder is refused, and the message says where', () => {
    const message = refusal({ seg: [{ id: 0, n: '{{percentage}}' }] });

    assertSame(
        message.includes('config.entities[0].display.payload.seg[0].n'),
        true,
        `names the path, got: ${message}`,
    );
    assertSame(message.includes('{{percentage}}'), true, 'quotes the typo');
    assertSame(message.includes('percent'), true, 'and lists what it could have meant');
});

Deno.test('a custom body with no segments is refused', () => {
    const empty = refusal({ on: true, seg: [] });
    const missing = refusal({ on: true });

    assertSame(empty.includes('at least one segment'), true, `empty seg: ${empty}`);
    assertSame(missing.includes('must be an array'), true, `no seg at all: ${missing}`);
});

Deno.test('a segment id that is not a literal number is refused', () => {
    // The service switches the other entities' segments off, so it has to know
    // which segments this display owns before it has a reading to fill it with.
    const templated = refusal({ seg: [{ id: '{{percent}}', n: 'x' }] });
    const fractional = refusal({ seg: [{ id: 0.5, n: 'x' }] });
    const outOfRange = refusal({ seg: [{ id: 32, n: 'x' }] });

    assertSame(templated.includes('must be a number'), true, `a placeholder: ${templated}`);
    assertSame(fractional.includes('a whole number'), true, `a fraction: ${fractional}`);
    assertSame(outOfRange.includes('between 0 and 31'), true, `past the last: ${outOfRange}`);
});

Deno.test('a custom body far larger than a panel needs is refused', () => {
    const names = Array.from({ length: 200 }, () => 'x'.repeat(40));
    const message = refusal({ seg: [{ id: 0, n: 'x', notes: names }] });

    assertSame(message.includes('characters of JSON'), true, `by length: ${message}`);
});

Deno.test('a custom display does not need a segmentId or a colour', () => {
    // Both live inside the body it owns, so demanding them would be noise.
    const parsed = accept({ seg: [{ id: 3, fx: 0 }] });

    assertSame(parsed.entities[0].display.style, 'custom', 'accepted');
});

/**
 * The built-in items. Their rules are refused here rather than merely avoided
 * in the editor, because this validator is also what a hand-edited file goes
 * through — the two invalid combinations are a built-in with no format, and a
 * format on something that is not one.
 */

const TEXT_DISPLAY = { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 60, text: '{{value}}' };

const withEntity = (entity: unknown): unknown => ({
    version: 2,
    output: { wledIp: '', brightness: 80 },
    entities: [entity],
    flow: [{ id: 'always', match: 'all', conditions: [], action: { do: 'blank' } }],
});

const entityRefusal = (entity: unknown): string => {
    try {
        parsePanelConfig(withEntity(entity));
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('it was accepted, and should not have been');
};

Deno.test('a built-in item needs one of its own formats', () => {
    const absent = entityRefusal({
        entityId: 'builtin.time',
        kind: 'text',
        display: TEXT_DISPLAY,
    });
    const wrongItem = entityRefusal({
        entityId: 'builtin.time',
        kind: 'text',
        format: 'isoDate',
        display: TEXT_DISPLAY,
    });
    const nonsense = entityRefusal({
        entityId: 'builtin.date',
        kind: 'text',
        format: 'HH:mm',
        display: TEXT_DISPLAY,
    });

    assertSame(absent.includes('config.entities[0].format'), true, `no format: ${absent}`);
    assertSame(wrongItem.includes('hour24'), true, `the other item's format: ${wrongItem}`);
    assertSame(nonsense.includes('one of'), true, `a pattern string: ${nonsense}`);
});

Deno.test('a format on a Home Assistant entity is refused, not ignored', () => {
    // Accepting it would be a save that quietly did nothing.
    const message = entityRefusal({
        entityId: 'sensor.a',
        kind: 'percent',
        format: 'hour24',
        display: { style: 'bar', segmentId: 0, color: [0, 1, 2], trackColor: [0, 1, 2] },
    });

    assertSame(message.includes('only the built-in items'), true, `a stray format: ${message}`);
});

Deno.test('a built-in item reads as text and cannot be drawn as a bar', () => {
    const asPercent = entityRefusal({
        entityId: 'builtin.time',
        kind: 'percent',
        format: 'hour24',
        display: TEXT_DISPLAY,
    });
    // A bar wants a number; a clock would leave one permanently empty with
    // nothing on the panel to say why.
    const asBar = entityRefusal({
        entityId: 'builtin.time',
        kind: 'text',
        format: 'hour24',
        display: { style: 'bar', segmentId: 0, color: [0, 1, 2], trackColor: [0, 1, 2] },
    });

    assertSame(asPercent.includes('config.entities[0].kind'), true, `as a percent: ${asPercent}`);
    assertSame(asBar.includes("'text' or 'custom'"), true, `as a bar: ${asBar}`);
});

Deno.test('a built-in item survives the validator with its format intact', () => {
    const parsed = parsePanelConfig(withEntity({
        entityId: 'builtin.date',
        kind: 'text',
        format: 'dayMonthNumeric',
        display: TEXT_DISPLAY,
    }));

    assertSame(parsed.entities[0].format, 'dayMonthNumeric', 'kept');
});

Deno.test('a custom body is allowed on a built-in, which is the way to compose one', () => {
    const parsed = parsePanelConfig(withEntity({
        entityId: 'builtin.time',
        kind: 'text',
        format: 'hour24',
        display: { style: 'custom', payload: { seg: [{ id: 0, fx: 122, n: '{{value}}' }] } },
    }));

    assertSame(parsed.entities[0].display.style, 'custom', 'accepted');
});

const withCondition = (condition: unknown): unknown => ({
    version: 2,
    output: { wledIp: '', brightness: 80 },
    entities: [],
    flow: [{ id: 'night', match: 'all', conditions: [condition], action: { do: 'blank' } }],
});

const conditionRefusal = (condition: unknown): string => {
    try {
        parsePanelConfig(withCondition(condition));
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
    throw new Error('it was accepted, and should not have been');
};

Deno.test('a time window is accepted without an entity', () => {
    const parsed = parsePanelConfig(withCondition({ test: 'timeBetween', from: '22:00', to: '07:00' }));
    const condition = parsed.flow[0].conditions[0];

    assertSame(condition.test === 'timeBetween' && condition.from, '22:00', 'kept its start');
    assertSame('entityId' in condition, false, 'and gained no entity');
});

Deno.test('a time window refuses a malformed time, an equal start and end, and an entity', () => {
    const malformed = conditionRefusal({ test: 'timeBetween', from: '7:00', to: '08:00' });
    const empty = conditionRefusal({ test: 'timeBetween', from: '08:00', to: '08:00' });
    const tied = conditionRefusal({ test: 'timeBetween', entityId: 'sensor.a', from: '01:00', to: '02:00' });

    assertSame(malformed.includes('conditions[0].from'), true, `malformed names the field: ${malformed}`);
    assertSame(empty.includes('different from'), true, `equal is refused: ${empty}`);
    assertSame(tied.includes('conditions[0].entityId'), true, `an entity is refused: ${tied}`);
});

Deno.test('a text template refuses an unknown placeholder and an empty string', () => {
    const typo = entityRefusal({
        entityId: 'sensor.a',
        kind: 'text',
        display: { ...TEXT_DISPLAY, text: '{{valeu}}W' },
    });
    // An empty segment name makes Scrolling Text draw the date instead.
    const empty = entityRefusal({ entityId: 'sensor.a', kind: 'text', display: { ...TEXT_DISPLAY, text: '' } });

    assertSame(typo.includes('display.text'), true, `the typo names the field: ${typo}`);
    assertSame(empty.includes('non-empty'), true, `empty is refused: ${empty}`);
});
