import { encodeLedEntries } from '../ledEntries.ts';
import { decodeLedEntries } from '../public/ledEntries.js';
import { BATTERY, PANEL_LEDS, SOLAR, SUN } from './glyphFixtures.ts';

/**
 * The encoder the service sends glyphs with, and the decoder the editor reads
 * an existing custom body's glyph back with.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

Deno.test('a glyph from the painter decodes and encodes back to exactly what it was', () => {
    for (const [name, entries] of Object.entries({ SOLAR, BATTERY, SUN })) {
        const colors = decodeLedEntries(entries, PANEL_LEDS);
        const encoded = encodeLedEntries(colors);
        assertSame(JSON.stringify(encoded), JSON.stringify(entries), name);
    }
});

Deno.test('colours after a colour carry on from where it left off', () => {
    const colors = decodeLedEntries([3, 'FF0000', '00FF00', 10, 12, '0000FF', 'FFFFFF'], 16);

    assertSame(colors[3], 'FF0000', 'the header places the first');
    assertSame(colors[4], '00FF00', 'the next follows it');
    assertSame(colors[10], '0000FF', 'a range starts at its start');
    assertSame(colors[11], '0000FF', 'and stops before its stop');
    assertSame(colors[12], 'FFFFFF', 'a bare colour after a range follows the range');
    assertSame(colors[0], '000000', 'anything unnamed is off');
});

Deno.test('a run of four is a range, and three are listed', () => {
    const four = encodeLedEntries(['AAAAAA', 'AAAAAA', 'AAAAAA', 'AAAAAA', '000000']);
    const three = encodeLedEntries(['AAAAAA', 'AAAAAA', 'AAAAAA', '000000']);

    assertSame(JSON.stringify(four), JSON.stringify([0, 4, 'AAAAAA', 4, '000000']), 'four');
    assertSame(JSON.stringify(three), JSON.stringify([0, 'AAAAAA', 'AAAAAA', 'AAAAAA', '000000']), 'three');
});

Deno.test('an array colour and an 8-digit string decode to RRGGBB', () => {
    const colors = decodeLedEntries([0, [255, 128, 0], 'FF00FF00'], 2);

    assertSame(colors[0], 'FF8000', 'array');
    assertSame(colors[1], '00FF00', 'the white byte leads, so it is dropped');
});
