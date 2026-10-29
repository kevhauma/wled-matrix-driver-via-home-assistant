/**
 * The inverse of `ledEntries.ts`: a segment's `i` field read back into one
 * `'RRGGBB'` per LED, the way WLED's `deserializeSegment` walks it.
 *
 * A number sets where the next colour goes; a second number in a row makes the
 * pair a range. A colour paints the range, or one LED, and the position moves
 * on past it — so colours after a colour carry on from there, which is the
 * form neither the README nor `ledEntries.ts` writes but the painter's output
 * relies on.
 *
 * No DOM, so `tests/ledEntries.test.ts` imports it too.
 */

const OFF = '000000';

const toHexColor = color => {
    if (typeof color === 'string') {
        // An 8-digit string is WWRRGGBB, so the colour is its last six.
        return color.slice(-6).toUpperCase();
    }
    const channels = color.slice(0, 3).map(channel => {
        const clamped = Math.max(0, Math.min(255, Math.round(Number(channel) || 0)));
        return clamped.toString(16).padStart(2, '0');
    });
    return channels.join('').toUpperCase();
};

export const decodeLedEntries = (entries, length) => {
    const colors = new Array(length).fill(OFF);
    let start = 0;
    let stop = 0;
    let numbersInARow = 0;

    for (const entry of entries) {
        if (typeof entry === 'number') {
            if (numbersInARow === 0) {
                start = entry;
            } else {
                stop = entry;
            }
            numbersInARow += 1;
            continue;
        }

        if (numbersInARow < 2 || stop <= start) {
            stop = start + 1;
        }
        const color = toHexColor(entry);
        for (; start < stop; start++) {
            if (start >= 0 && start < length) {
                colors[start] = color;
            }
        }
        numbersInARow = 0;
    }

    return colors;
};
