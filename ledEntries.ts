/**
 * A whole frame as WLED's per-pixel `i` field, which mixes two notations:
 *
 *   [index, color, ...]     a run of colours starting at `index`
 *   [start, stop, color]    a solid range, `stop` exclusive
 *
 * The full-redraw half of `wled-wrapper/render/ledDiff.ts`, ported rather than
 * imported: this project is deployed as a checkout of its own, with no sibling
 * directories. Same rules, so a frame comes out exactly as wled-matrix-painter's
 * "Copy as JSON" writes it — which is what the glyphs on the panel were.
 *
 * `public/ledEntries.js` is the inverse, for the editor.
 */

export type LedEntry = number | string;

/**
 * A solid range costs three entries, so it only pays off once it replaces four
 * or more individual colours — below that it would also split a list in two and
 * cost an extra index header.
 */
const MINIMUM_RANGE_LENGTH = 4;

/** `colors` are `'RRGGBB'`, one per LED from 0. */
export const encodeLedEntries = (colors: readonly string[]): LedEntry[] => {
    const entries: LedEntry[] = [];
    let pending: string[] = [];
    let pendingStart = 0;

    const flushPending = () => {
        if (pending.length > 0) {
            entries.push(pendingStart, ...pending);
            pending = [];
        }
    };

    let index = 0;
    while (index < colors.length) {
        let runEnd = index + 1;
        while (runEnd < colors.length && colors[runEnd] === colors[index]) {
            runEnd++;
        }

        if (runEnd - index >= MINIMUM_RANGE_LENGTH) {
            flushPending();
            entries.push(index, runEnd, colors[index]);
        } else {
            if (pending.length === 0) {
                pendingStart = index;
            }
            const run = colors.slice(index, runEnd);
            pending.push(...run);
        }

        index = runEnd;
    }

    flushPending();
    return entries;
};
