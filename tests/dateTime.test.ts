import { describeDateTimeFormats, renderTimeRemaining } from '../builtins.ts';
import { PanelEntity } from '../entities.ts';
import { EntityState } from '../homeAssistant/entityStore.ts';
import { Reading, readPanelEntity } from '../readings.ts';

/**
 * A Home Assistant timestamp read as a date, a time, or the time left until
 * it. Every instant is fixed and every zone named, so the host running the
 * tests changes nothing.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const MINUTE = 60_000;

const NOW = new Date('2026-11-05T13:00:00Z');

const timestamp = (state: string): EntityState => ({
    entityId: 'sensor.washer_done',
    state,
    attributes: { device_class: 'timestamp' },
    lastChanged: 0,
    lastUpdated: 0,
});

const entityIn = (format: PanelEntity['format']): PanelEntity => ({
    entityId: 'sensor.washer_done',
    kind: 'datetime',
    format,
    display: { style: 'text', segmentId: 0, text: '{{value}}', settings: {} },
});

const textOf = (reading: Reading): string =>
    reading.kind === 'text' ? reading.candidates.join('|') : reading.kind;

const read = (format: PanelEntity['format'], state: string, timeZone = 'Europe/Brussels'): string => {
    const panelEntity = entityIn(format);
    const entityState = timestamp(state);
    const reading = readPanelEntity(panelEntity, entityState, NOW, timeZone);
    return textOf(reading);
};

Deno.test('time remaining is whole minutes under an hour, rounded up', () => {
    assertSame(renderTimeRemaining(30_000), '1m', 'the last minute is not 0m');
    assertSame(renderTimeRemaining(MINUTE), '1m', 'exactly one minute');
    assertSame(renderTimeRemaining(42 * MINUTE + 1), '43m', 'a part minute rounds up');
    assertSame(renderTimeRemaining(59 * MINUTE), '59m', 'the last whole-minute value');
});

Deno.test('time remaining is hours to one decimal from an hour on, never both units', () => {
    assertSame(renderTimeRemaining(59 * MINUTE + 1), '1.0h', 'rounds up into the hour, not 60m');
    assertSame(renderTimeRemaining(60 * MINUTE), '1.0h', 'exactly an hour');
    assertSame(renderTimeRemaining(95 * MINUTE), '1.6h', 'an hour and 35 minutes');
    assertSame(renderTimeRemaining(26 * 60 * MINUTE), '26.0h', 'more than a day stays in hours');
});

Deno.test('time remaining has nothing to say once the moment has come', () => {
    assertSame(renderTimeRemaining(0), undefined, 'now');
    assertSame(renderTimeRemaining(-MINUTE), undefined, 'already past');
});

Deno.test('a timestamp reads as a time or a date in the panel timezone', () => {
    // 13:30 UTC is 14:30 in Brussels in November.
    assertSame(read('hour24', '2026-11-05T13:30:00+00:00'), '14:30', '24 hour');
    assertSame(read('hour12', '2026-11-05T13:30:00+00:00'), '2:30pm', '12 hour');
    assertSame(read('weekdayDayMonth', '2026-11-05T23:30:00+00:00'), 'Fri 6 Nov', 'past midnight there');
    assertSame(read('isoDate', '2026-11-05T13:30:00.123456+00:00'), '2026-11-05', 'with fractions');
    assertSame(read('hour24', '2026-11-05T13:30:00Z', 'America/New_York'), '08:30', 'another zone');
});

Deno.test('a timestamp counts down from now, and drops out once passed', () => {
    assertSame(read('timeRemaining', '2026-11-05T13:42:00+00:00'), '42m', 'minutes');
    assertSame(read('timeRemaining', '2026-11-05T15:35:00+01:00'), '1.6h', 'offset respected');
    assertSame(read('timeRemaining', '2026-11-05T12:59:00+00:00'), 'unavailable', 'passed');
});

Deno.test('anything that is not an offset timestamp is unavailable, not a guess', () => {
    assertSame(read('hour24', 'unknown'), 'unavailable', 'unknown');
    assertSame(read('hour24', 'unavailable'), 'unavailable', 'unavailable');
    // Without an offset it would be read in the host's zone.
    assertSame(read('hour24', '2026-11-05 14:30:00'), 'unavailable', 'no offset');
    assertSame(read('hour24', 'soon'), 'unavailable', 'not a timestamp at all');
});

Deno.test('the editor is offered every format, the countdown with fixed examples', () => {
    const choices = describeDateTimeFormats(NOW, 'Europe/Brussels');
    const first = choices[0];
    const last = choices[choices.length - 1];

    assertSame(first.example, '14:00', 'the clock formats show now');
    assertSame(last.format, 'timeRemaining', 'the countdown is offered last');
    assertSame(last.example, '42m / 1.6h left', 'both of its forms');
});
