import { EntityIds, PANEL_ENTITIES, PanelEntity } from '../entities.ts';
import { Reading } from '../readings.ts';
import { createWledTarget, toDisplayText, toWledPayload } from '../wled.ts';
import { Decision } from '../whatToShow.ts';

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const BRIGHTNESS = 96;

const buildPayload = (decision: Decision, readings: Record<string, Reading>) =>
    toWledPayload({
        decision,
        entities: PANEL_ENTITIES,
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

    const fitted = toDisplayText(entity, {
        kind: 'text',
        candidates: ['Superstitious Fantasy - Windwaker', 'Superstitious Fantasy'],
        isPlaying: true,
    });
    assertSame(fitted, 'Superstitious Fantasy', 'dropped the artist rather than cutting it mid-word');
});

Deno.test('text with no form that fits is cut to the segment name limit', () => {
    const entity = PANEL_ENTITIES[0];

    const long = toDisplayText(entity, {
        kind: 'text',
        candidates: ['A title that runs well past the thirty-two character segment name limit'],
        isPlaying: true,
    });
    assertSame(long.length <= 32, true, `fits the limit, got ${long.length}`);
});

Deno.test('non-ASCII is stripped, because the device fonts cannot draw it', () => {
    const entity = PANEL_ENTITIES[0];

    const accented = toDisplayText(entity, {
        kind: 'text',
        candidates: ['Björk • Army'],
        isPlaying: true,
    });
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
