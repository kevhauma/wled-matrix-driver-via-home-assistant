import { BuiltinIds, defaultFormatFor, describeBuiltins, formatsFor, isBuiltinId, renderBuiltin } from '../builtins.ts';
import { readBuiltin } from '../readings.ts';
import { toWledPayload } from '../wled.ts';
import { PanelEntity } from '../entities.ts';
import { Reading } from '../readings.ts';

/**
 * The built-in items: the formats they render in, and the fact that the rest
 * of the service cannot tell one from an entity once it is a `Reading`.
 *
 * Every assertion names a fixed instant rather than `new Date()`, because the
 * whole point of these is the string, and `18:05` on the machine that happens
 * to run the tests is not a test.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

/** A local-time instant: Thursday 22 October 2026, 14:32:05. */
const AFTERNOON = new Date(2026, 9, 22, 14, 32, 5);
/** The same date at 09:07:00, for the 12-hour and padding cases. */
const MORNING = new Date(2026, 9, 22, 9, 7, 0);
/** Midnight, which is the hour a 12-hour clock gets wrong. */
const MIDNIGHT = new Date(2026, 9, 22, 0, 15, 0);
/** Noon, the other one. */
const NOON = new Date(2026, 9, 22, 12, 15, 0);

Deno.test('the time formats render as the editor advertises them', () => {
    assertSame(renderBuiltin('hour24', AFTERNOON), '14:32', 'afternoon, 24 hour');
    assertSame(renderBuiltin('hour24', MORNING), '09:07', 'morning is zero padded');
    assertSame(renderBuiltin('hour24Seconds', AFTERNOON), '14:32:05', 'with seconds');
    assertSame(renderBuiltin('hour12', AFTERNOON), '2:32pm', 'afternoon, 12 hour');
    assertSame(renderBuiltin('hour12', MORNING), '9:07am', 'morning, 12 hour');
});

Deno.test('a 12-hour clock says 12 at midnight and at noon, not 0', () => {
    assertSame(renderBuiltin('hour12', MIDNIGHT), '12:15am', 'midnight');
    assertSame(renderBuiltin('hour12', NOON), '12:15pm', 'noon');
});

Deno.test('the date formats render as the editor advertises them', () => {
    assertSame(renderBuiltin('weekdayDayMonth', AFTERNOON), 'Thu 22 Oct', 'weekday, day, month');
    assertSame(renderBuiltin('dayMonth', AFTERNOON), '22 Oct', 'day and month');
    assertSame(renderBuiltin('dayMonthNumeric', AFTERNOON), '22/10', 'numeric, padded');
    assertSame(renderBuiltin('isoDate', AFTERNOON), '2026-10-22', 'ISO');
});

/**
 * The device's fonts are ASCII only and `wled.ts` strips anything else, which
 * is the reason these are written out rather than taken from `toLocaleString`:
 * recent ICU puts a narrow no-break space before `PM`.
 */
Deno.test('every format is ASCII, so nothing is stripped on the way to the device', () => {
    const everyFormat = [
        ...formatsFor(BuiltinIds.Time),
        ...formatsFor(BuiltinIds.Date),
    ];
    for (const format of everyFormat) {
        const text = renderBuiltin(format, AFTERNOON);
        const ascii = text.replace(/[^\x20-\x7e]/g, '');
        assertSame(ascii, text, `${format} is ASCII`);
    }
});

Deno.test('the two ids are recognised and nothing else is', () => {
    assertSame(isBuiltinId('builtin.time'), true, 'the clock');
    assertSame(isBuiltinId('builtin.date'), true, 'the date');
    assertSame(isBuiltinId('builtin.weather'), false, 'an id that does not exist');
    assertSame(isBuiltinId('sensor.builtin.time'), false, 'an entity that merely looks like one');
});

Deno.test('each item offers only its own formats, first one as the default', () => {
    const timeFormats = formatsFor(BuiltinIds.Time);
    const dateFormats = formatsFor(BuiltinIds.Date);

    assertSame(timeFormats.includes('isoDate'), false, 'the clock does not offer a date format');
    assertSame(dateFormats.includes('hour24'), false, 'the date does not offer a time format');
    assertSame(defaultFormatFor(BuiltinIds.Time), timeFormats[0], 'the clock default');
    assertSame(defaultFormatFor(BuiltinIds.Date), dateFormats[0], 'the date default');
});

/** What `/api/builtins` serves, so the editor's list cannot drift from above. */
Deno.test('the described formats carry a live example of each', () => {
    const described = describeBuiltins(AFTERNOON);
    assertSame(described.length, 2, 'two items');

    const time = described.find(item => item.entityId === BuiltinIds.Time);
    const examples = time?.formats.map(choice => choice.example).join(' ');
    assertSame(examples, '14:32 2:32pm 14:32:05', 'the clock, in offered order');
});

Deno.test('a built-in reading is text, and never unavailable', () => {
    const reading = readBuiltin('hour24', AFTERNOON);
    assertSame(reading.kind, 'text', 'the kind');
    const candidates = reading.kind === 'text' ? reading.candidates.join('|') : '';
    assertSame(candidates, '14:32', 'one candidate, the rendered string');
    const playing = reading.kind === 'text' ? reading.isPlaying : true;
    assertSame(playing, false, 'a clock is not playing anything');
});

/**
 * The point of rendering it into a `Reading`: `wled.ts` has no idea this is a
 * clock, so a template, the segment name and the other segments all work as they
 * do for a sensor.
 */
Deno.test('a clock reaches the device as an ordinary text segment', () => {
    const clock: PanelEntity = {
        entityId: BuiltinIds.Time,
        kind: 'text',
        format: 'hour24',
        display: { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 60, text: 'at {{value}}' },
    };
    const readings = new Map<string, Reading>([
        [BuiltinIds.Time, readBuiltin('hour24', AFTERNOON)],
    ]);

    const payload = toWledPayload({
        decision: { show: 'entity', entityId: BuiltinIds.Time },
        entities: [clock],
        flowDisplays: [],
        states: new Map(),
        readings,
        brightness: 80,
    });

    const segments = payload.seg as Record<string, unknown>[];
    assertSame(segments[0].n, 'at 14:32', 'the template and the clock in the segment name');
    assertSame(segments[0].fx, 122, 'Scrolling Text, like any other text display');
});
