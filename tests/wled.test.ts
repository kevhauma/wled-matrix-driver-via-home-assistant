import { EntityIds, PANEL_ENTITIES, PanelEntity, PlainDisplay } from '../entities.ts';
import { Reading } from '../readings.ts';
import { createWledTarget, resolveDisplay, toDisplayText, toEntityValues, toWledPayload } from '../wled.ts';
import { Decision } from '../whatToShow.ts';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const BRIGHTNESS = 96;

const NO_OTHERS = toEntityValues(new Map());

const buildPayload = (decision: Decision, readings: Record<string, Reading>) =>
    toWledPayload({
        decision,
        entities: PANEL_ENTITIES,
        flowDisplays: [],
        states: new Map(),
        readings: new Map(Object.entries(readings)),
        brightness: BRIGHTNESS,
    });

type Segment = Record<string, unknown>;

const firstSegment = (payload: Record<string, unknown>): Segment => {
    const segments = payload.seg as Segment[];
    return segments[0];
};

Deno.test('nothing to show turns the device off', () => {
    const payload = buildPayload({ show: 'nothing', reason: 'the television is playing' }, {});

    assertSame(payload.on, false, 'off');
    assertSame(payload.seg, undefined, 'and says nothing about segments');
});

Deno.test('a percent reading becomes the Percent effect with ix as the value', () => {
    const payload = buildPayload(
        { show: 'entity', entityId: EntityIds.Battery },
        { [EntityIds.Battery]: { kind: 'percent', percent: 64 } },
    );
    const segment = firstSegment(payload);

    assertSame(payload.on, true, 'on');
    assertSame(payload.bri, BRIGHTNESS, 'brightness');
    assertSame(segment.fx, 98, 'Percent effect');
    assertSame(segment.ix, 64, 'ix carries the percentage');
    assertSame(segment.sx, 255, 'sx is the slide speed, not the value');
    assertSame(segment.n, undefined, 'a bar has no text');
    assertSame(segment.m12, 1, 'expanded as a Bar, a row per 1D pixel');
    assertSame(segment.tp, true, 'transposed, so the rows are columns');
    assertSame(segment.rY, true, 'reversed before the transpose, so it fills from the left');
});

Deno.test('a temperature becomes scrolling text with its unit', () => {
    const payload = buildPayload(
        { show: 'entity', entityId: EntityIds.Temperature },
        { [EntityIds.Temperature]: { kind: 'temperature', degrees: 18.4, unit: 'C' } },
    );
    const segment = firstSegment(payload);

    assertSame(segment.fx, 122, 'Scrolling Text effect');
    assertSame(segment.n, '18C', 'rounded, with the unit from the entity');
    assertSame(segment.tp, false, 'not transposed, or the text would come out sideways');
});

Deno.test('a media title becomes the segment name', () => {
    const payload = buildPayload(
        { show: 'entity', entityId: EntityIds.Speaker },
        { [EntityIds.Speaker]: { kind: 'text', candidates: ['Lucid - Windwaker'], isPlaying: true } },
    );
    const segment = firstSegment(payload);

    assertSame(segment.n, 'Lucid - Windwaker', 'the text WLED will scroll');
});

Deno.test('segments other than the one being shown are switched off', () => {
    const entities: PanelEntity[] = [
        ...PANEL_ENTITIES,
        {
            entityId: 'sensor.other',
            kind: 'percent',
            display: { style: 'bar', segmentId: 3, color: [0, 0, 255], trackColor: [0, 0, 0] },
        },
    ];

    const payload = toWledPayload({
        decision: { show: 'entity', entityId: EntityIds.Battery },
        entities,
        flowDisplays: [],
        states: new Map(),
        readings: new Map([[EntityIds.Battery, { kind: 'percent', percent: 10 } as Reading]]),
        brightness: BRIGHTNESS,
    });

    const segments = payload.seg as Segment[];
    assertSame(segments.length, 2, 'the shown segment and the one it displaces');
    assertSame(segments[1].id, 3, 'the other segment');
    assertSame(segments[1].on, false, 'switched off rather than emptied');
});

Deno.test('a shorter whole form is preferred over cutting the longer one', () => {
    const entity = PANEL_ENTITIES[0];

    const fitted = toDisplayText(resolveDisplay(entity.display, ''), {
        kind: 'text',
        candidates: ['Superstitious Fantasy - Windwaker', 'Superstitious Fantasy'],
        isPlaying: true,
    }, NO_OTHERS);
    assertSame(fitted, 'Superstitious Fantasy', 'dropped the artist rather than cutting it mid-word');
});

Deno.test('text with no form that fits is cut to the segment name limit', () => {
    const entity = PANEL_ENTITIES[0];

    const long = toDisplayText(resolveDisplay(entity.display, ''), {
        kind: 'text',
        candidates: ['A title that runs well past the thirty-two character segment name limit'],
        isPlaying: true,
    }, NO_OTHERS);
    assertSame(long.length <= 32, true, `fits the limit, got ${long.length}`);
});

Deno.test('non-ASCII is stripped, because the device fonts cannot draw it', () => {
    const entity = PANEL_ENTITIES[0];

    const accented = toDisplayText(resolveDisplay(entity.display, ''), {
        kind: 'text',
        candidates: ['Björk • Army'],
        isPlaying: true,
    }, NO_OTHERS);
    assertSame(accented, 'Bjrk  Army', 'non-ASCII dropped');
});

Deno.test('a bar with a non-numeric reading draws empty rather than full', () => {
    const payload = buildPayload(
        { show: 'entity', entityId: EntityIds.Battery },
        { [EntityIds.Battery]: { kind: 'unavailable' } },
    );
    const segment = firstSegment(payload);

    assertSame(segment.ix, 0, 'empty');
});

const CUSTOM_ENTITY: PanelEntity = {
    entityId: 'media_player.custom',
    kind: 'text',
    display: {
        style: 'custom',
        payload: {
            seg: [
                { id: 1, fx: 122, n: '{{title}}', sx: 80 },
                { id: 2, fx: 98, ix: '{{percent}}' },
            ],
        },
    },
};

const buildCustomPayload = (reading: Reading, entities?: PanelEntity[]) =>
    toWledPayload({
        decision: { show: 'entity', entityId: CUSTOM_ENTITY.entityId },
        entities: entities ?? [CUSTOM_ENTITY],
        flowDisplays: [],
        states: new Map(),
        readings: new Map([[CUSTOM_ENTITY.entityId, reading]]),
        brightness: BRIGHTNESS,
    });

Deno.test('a custom display sends its own body, with the reading filled in', () => {
    const payload = buildCustomPayload({
        kind: 'text',
        candidates: ['Lucid - Windwaker', 'Lucid'],
        isPlaying: true,
        title: 'Lucid',
        artist: 'Windwaker',
    });
    const segments = payload.seg as Segment[];

    assertSame(segments.length, 2, 'both of its segments');
    assertSame(segments[0].n, 'Lucid', 'the title alone, because that is what it asked for');
    assertSame(segments[0].sx, 80, 'its own slider, untouched');
    assertSame(payload.bri, BRIGHTNESS, 'the brightness it did not set');
    assertSame(payload.on, true, 'and the on it did not set');
});

Deno.test('a whole-string placeholder arrives as a number', () => {
    const payload = buildCustomPayload({ kind: 'percent', percent: 64 });
    const segments = payload.seg as Segment[];

    assertSame(segments[1].ix, 64, 'the percentage');
    assertSame(typeof segments[1].ix, 'number', 'as a number — a string there is a dead slider');
});

Deno.test('a custom body that sets bri keeps it', () => {
    const entity: PanelEntity = {
        ...CUSTOM_ENTITY,
        display: { style: 'custom', payload: { bri: 12, seg: [{ id: 1, n: '{{value}}' }] } },
    };
    const payload = toWledPayload({
        decision: { show: 'entity', entityId: entity.entityId },
        entities: [entity],
        flowDisplays: [],
        states: new Map(),
        readings: new Map([[entity.entityId, { kind: 'percent', percent: 5 } as Reading]]),
        brightness: BRIGHTNESS,
    });

    assertSame(payload.bri, 12, 'its own, not the slider');
});

Deno.test('a custom display still switches the other entities segments off', () => {
    const entities = [...PANEL_ENTITIES, CUSTOM_ENTITY];
    const payload = buildCustomPayload({ kind: 'percent', percent: 10 }, entities);
    const segments = payload.seg as Segment[];

    assertSame(segments.length, 3, 'its two, plus segment 0 which the others draw on');
    assertSame(segments[2].id, 0, 'the displaced segment');
    assertSame(segments[2].on, false, 'switched off rather than emptied');
});

Deno.test('a custom display is not switched off by an entity sharing its segment', () => {
    const other: PanelEntity = {
        entityId: 'sensor.other',
        kind: 'percent',
        display: { style: 'bar', segmentId: 1, color: [0, 0, 255], trackColor: [0, 0, 0] },
    };
    const payload = buildCustomPayload({ kind: 'percent', percent: 10 }, [CUSTOM_ENTITY, other]);
    const segments = payload.seg as Segment[];

    assertSame(segments.length, 2, 'its own two and nothing else');
    assertSame(segments[0].id, 1, 'segment 1 is still its own');
});

Deno.test('a placeholder the reading cannot supply is empty rather than an error', () => {
    const payload = buildCustomPayload({ kind: 'unavailable' });
    const segments = payload.seg as Segment[];

    assertSame(segments[0].n, '', 'no title');
    assertSame(segments[1].ix, 0, 'and an empty bar, as a bar display would draw');
});

Deno.test('a decision naming an unregistered entity is a programming error', () => {
    let threw = false;
    try {
        buildPayload({ show: 'entity', entityId: 'sensor.nope' }, {});
    } catch {
        threw = true;
    }
    assertSame(threw, true, 'threw rather than sending something arbitrary');
});

Deno.test('an unchanged payload is not sent twice', () => {
    const bodies: string[] = [];
    const target = createWledTarget({
        ip: '',
        onSend: body => {
            bodies.push(body);
        },
    });

    const run = async () => {
        const first = await target.send({ on: true, bri: 96 });
        const repeat = await target.send({ on: true, bri: 96 });
        const changed = await target.send({ on: false });

        assertSame(first !== undefined, true, 'the first send went out');
        assertSame(repeat, undefined, 'the repeat was dropped');
        assertSame(changed !== undefined, true, 'a different payload went out');
        assertSame(bodies.length, 2, 'only two bodies reported');
    };

    return run();
});

const textDisplay = (text: string): PlainDisplay =>
    ({ style: 'text', segmentId: 0, color: [255, 255, 255], speed: 60, text });

Deno.test('a text template puts anything around the value, which is a suffix', () => {
    const power: Reading = { kind: 'text', candidates: ['1234'], isPlaying: false };

    const drawn = toDisplayText(textDisplay('PV {{value}}W'), power, NO_OTHERS);

    assertSame(drawn, 'PV 1234W', 'prefix and suffix around the value');
});

Deno.test('a text template is fitted per form of the value, keeping its own text', () => {
    const song: Reading = {
        kind: 'text',
        candidates: ['Superstitious Fantasy - Windwaker', 'Superstitious Fantasy'],
        isPlaying: true,
    };

    const drawn = toDisplayText(textDisplay('> {{value}} <'), song, NO_OTHERS);

    assertSame(drawn, '> Superstitious Fantasy <', 'dropped the artist, kept both ends');
});

Deno.test('a text template draws nothing for a reading that has dropped off', () => {
    const drawn = toDisplayText(textDisplay('PV {{value}}W'), { kind: 'unavailable' }, NO_OTHERS);

    assertSame(drawn, '', 'not the template around a gap');
});

Deno.test('one display can draw two entities, each read as the panel draws it', () => {
    const inside: PanelEntity = {
        entityId: 'sensor.inside',
        kind: 'temperature',
        display: textDisplay('in {{value}} out {{sensor.outside}}'),
    };
    const outside: PanelEntity = {
        entityId: 'sensor.outside',
        kind: 'temperature',
        // Its own template is not used by the reference, or two could refer
        // to each other.
        display: textDisplay('OUT {{value}}'),
    };
    const readings = new Map<string, Reading>([
        ['sensor.inside', { kind: 'temperature', degrees: 21.2, unit: 'C' }],
        ['sensor.outside', { kind: 'temperature', degrees: 7.6, unit: 'C' }],
    ]);

    const payload = toWledPayload({
        decision: { show: 'entity', entityId: 'sensor.inside' },
        entities: [inside, outside],
        flowDisplays: [],
        states: new Map(),
        readings,
        brightness: BRIGHTNESS,
    });

    assertSame(firstSegment(payload).n, 'in 21C out 8C', 'both, rounded, with their units');
});

Deno.test('a display set in the flow replaces the entity’s own, and its segment is switched off otherwise', () => {
    const temperature: PanelEntity = {
        entityId: 'sensor.temperature',
        kind: 'temperature',
        display: textDisplay('{{value}}'),
    };
    const override = { ...textDisplay('temp {{value}}'), segmentId: 2 };
    const readings = new Map<string, Reading>([
        ['sensor.temperature', { kind: 'temperature', degrees: 18, unit: 'C' }],
    ]);

    const overridden = toWledPayload({
        decision: { show: 'entity', entityId: 'sensor.temperature', display: override },
        entities: [temperature],
        flowDisplays: [override],
        states: new Map(),
        readings,
        brightness: BRIGHTNESS,
    });
    const own = toWledPayload({
        decision: { show: 'entity', entityId: 'sensor.temperature' },
        entities: [temperature],
        flowDisplays: [override],
        states: new Map(),
        readings,
        brightness: BRIGHTNESS,
    });

    const overriddenSegments = overridden.seg as Segment[];
    const ownSegments = own.seg as Segment[];
    assertSame(overriddenSegments[0].n, 'temp 18C', 'drawn by the override');
    assertSame(overriddenSegments[0].id, 2, 'on its segment');
    assertSame(overriddenSegments[1].id === 0 && overriddenSegments[1].on, false, 'the entity’s own segment off');
    assertSame(ownSegments[1].id === 2 && ownSegments[1].on, false, 'and the override’s, when it is not drawn');
});

const SUN_ICON = {
    style: 'custom' as const,
    payload: {
        seg: [
            { id: 1, fx: 0, i: [0, 64, '000000', 18, 22, 'FFC800'] },
            { id: 2, fx: 122, n: '{{value}}', ix: 128, c2: 0 },
        ],
    },
};

const weather: PanelEntity = {
    entityId: 'weather.home',
    kind: 'text',
    display: {
        style: 'byState',
        cases: [{ test: 'is', states: ['sunny', 'clear-night'], display: SUN_ICON }],
        otherwise: textDisplay('{{value}}'),
    },
};

const weatherPayload = (state: string) =>
    toWledPayload({
        decision: { show: 'entity', entityId: 'weather.home' },
        entities: [weather],
        flowDisplays: [],
        readings: new Map([['weather.home', { kind: 'text', candidates: [state], isPlaying: false } as Reading]]),
        states: new Map([['weather.home', state]]),
        brightness: BRIGHTNESS,
    });

Deno.test('a display chosen by state draws the case listing the state, as its custom body', () => {
    const segments = weatherPayload('clear-night').seg as Segment[];

    assertSame(segments[0].id, 1, 'the icon segment');
    assertSame(JSON.stringify(segments[0].i), JSON.stringify([0, 64, '000000', 18, 22, 'FFC800']), 'its pixels');
    assertSame(segments[1].n, 'clear-night', 'and the state beside it');
    assertSame(segments.some(segment => segment.id === 0 && segment.on === true), false, 'not the text case');
});

Deno.test('a state no case lists draws otherwise, and the other case’s segments go off', () => {
    const segments = weatherPayload('rainy').seg as Segment[];

    assertSame(segments[0].id === 0 && segments[0].n, 'rainy', 'the otherwise text on segment 0');
    const off = segments.filter(segment => segment.on === false).map(segment => segment.id);
    assertSame(off.join(' '), '1 2', 'the icon case’s segments switched off, so nothing lingers');
});

Deno.test('a case can pick on the state as a number, and a state that is not one matches neither', () => {
    const hot = textDisplay('HOT');
    const cold = textDisplay('COLD');
    const display = {
        style: 'byState' as const,
        cases: [
            { test: 'above' as const, value: 25, display: hot },
            { test: 'below' as const, value: 5, display: cold },
        ],
        otherwise: textDisplay('{{value}}'),
    };

    assertSame(resolveDisplay(display, '25.5'), hot, 'above');
    assertSame(resolveDisplay(display, '25'), display.otherwise, 'strictly above');
    assertSame(resolveDisplay(display, '-3'), cold, 'below');
    assertSame(resolveDisplay(display, 'unavailable'), display.otherwise, 'not a number');
    assertSame(resolveDisplay(display, ''), display.otherwise, 'and empty is not zero');
});
