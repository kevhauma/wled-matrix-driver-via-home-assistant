/**
 * Where Scrolling Text (FX 122) puts each letter, worked out the way WLED 16
 * does it in `mode_2Dscrollingtext`, so the editor can say whether a string
 * fits and where on the panel it sits without the device to look at.
 *
 * The metrics are the header bytes and width tables of
 * `wled00/src/font/*.h` at v16.0.1, read out of the arrays themselves. The
 * comments above those arrays are wrong: they call four of the five fonts
 * fixed-width and give tom-thumb as 4 wide, when it is 3 plus a column of
 * spacing. WLED 0.15 had different fonts with different widths, so none of
 * this holds before 16.
 */

export const TEXT_FONTS = [0, 1, 2, 3, 4] as const;

export type TextFont = typeof TEXT_FONTS[number];

type FontMetrics = {
    height: number,
    /** One width for every glyph, or one per character from space to `~`. */
    widths: number | readonly number[],
};

/** Every built-in font sets one column between glyphs. */
const LETTER_SPACING = 1;

const FIRST_CHARACTER = 32;

const FONTS: Record<TextFont, FontMetrics> = {
    // tom-thumb
    0: { height: 6, widths: 3 },
    // TinyUnicode. The space is 7 wide; that is the font, not a typo.
    1: {
        height: 8,
        widths: [
            7, 1, 3, 5, 4, 3, 5, 1, 2, 2, 3, 3, 2, 3, 1, 3, 4, 2, 4, 4, 4, 4, 4, 4,
            4, 4, 1, 2, 2, 4, 2, 4, 7, 4, 4, 3, 4, 3, 3, 4, 4, 3, 4, 4, 3, 5, 4, 4,
            4, 4, 4, 4, 3, 4, 4, 5, 4, 4, 3, 2, 3, 2, 3, 5, 2, 4, 4, 3, 4, 4, 3, 4,
            4, 1, 2, 4, 1, 5, 4, 4, 4, 4, 3, 4, 3, 4, 4, 5, 3, 4, 4, 3, 1, 3, 5,
        ],
    },
    // console 6x8
    2: {
        height: 8,
        widths: [
            6, 3, 5, 5, 4, 5, 5, 2, 2, 2, 5, 5, 2, 5, 2, 5, 5, 3, 5, 5, 5, 5, 5, 5,
            5, 5, 2, 2, 4, 5, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5,
            5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 3, 5, 3, 5, 6, 2, 5, 5, 5, 5, 5, 4, 5,
            4, 2, 4, 4, 2, 5, 4, 5, 5, 5, 5, 5, 4, 4, 5, 5, 4, 4, 4, 4, 1, 4, 4,
        ],
    },
    // c64esque
    3: {
        height: 9,
        widths: [
            2, 2, 5, 6, 6, 6, 7, 2, 4, 4, 5, 6, 3, 4, 2, 5, 6, 3, 6, 6, 6, 6, 6, 6,
            6, 6, 2, 3, 5, 6, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 2, 4, 6, 6, 7, 6, 6,
            6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 6, 4, 5, 4, 6, 6, 3, 6, 6, 6, 6, 6, 5, 6,
            6, 2, 4, 6, 3, 7, 6, 6, 6, 6, 6, 6, 5, 6, 6, 7, 6, 6, 6, 4, 2, 4, 6,
        ],
    },
    // 5x12, which is taller than an 8-row panel: WLED centres it and crops both ends.
    4: {
        height: 12,
        widths: [
            2, 1, 3, 5, 5, 5, 5, 1, 3, 3, 5, 5, 3, 5, 2, 5, 5, 5, 5, 5, 5, 5, 5, 5,
            5, 5, 2, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 5, 5, 5, 5, 5,
            5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 3, 5, 3, 5, 5, 2, 5, 5, 5, 5, 5, 5, 5,
            5, 3, 4, 5, 3, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 1, 5, 5,
        ],
    },
};

/** Arduino's `map`, which WLED uses for every slider: integer, truncating. */
const mapRange = (value: number, low: number, high: number, toLow: number, toHigh: number): number =>
    Math.trunc((value - low) * (toHigh - toLow) / (high - low)) + toLow;

/**
 * `c2` picks the font as `map(c2, 0, 255, 0, 4)`, so everything between the
 * thresholds at 64, 128, 192 and 255 is the same font. A font is stored as
 * 0-4 and sent as the lowest `c2` that selects it.
 */
export const fontSliderOf = (font: TextFont): number => [0, 64, 128, 192, 255][font];

/** Which font a raw `c2` selects, for a custom body that writes its own. */
export const fontOfSlider = (slider: number): TextFont => {
    const atLeastZero = Math.max(0, slider);
    const clamped = Math.min(255, atLeastZero);
    return mapRange(clamped, 0, 255, 0, 4) as TextFont;
};

const glyphWidth = (character: string, font: TextFont): number => {
    const { widths } = FONTS[font];
    const index = character.charCodeAt(0) - FIRST_CHARACTER;
    // WLED draws a character the font lacks as nothing, but still spaces it.
    if (index < 0 || index > 94) {
        return 0;
    }
    return typeof widths === 'number' ? widths : widths[index];
};

export type TextGlyph = {
    character: string,
    /** Columns from the left edge of the first glyph. */
    x: number,
    width: number,
};

/**
 * - `still`: fits the segment and sits centred.
 * - `across`: wider than the segment, so it scrolls right to left.
 * - `up` / `down`: fits, but a Y offset of 0 or 255 scrolls it vertically.
 */
export type TextMotion = 'still' | 'across' | 'up' | 'down';

export type TextLayout = {
    glyphs: TextGlyph[],
    /** As WLED counts it: every glyph and the spacing between, none after the last. */
    width: number,
    height: number,
    /** The row the glyphs' top edges are on while nothing moves them vertically. */
    top: number,
    motion: TextMotion,
};

export type TextLayoutInput = {
    /** Already ASCII: the device has no glyph for anything else. */
    text: string,
    font: TextFont,
    /** `ix`, 0-255. */
    yOffset: number,
    columns: number,
    rows: number,
};

export const layoutText = ({ text, font, yOffset, columns, rows }: TextLayoutInput): TextLayout => {
    const glyphs: TextGlyph[] = [];
    let x = 0;
    for (const character of text) {
        const width = glyphWidth(character, font);
        glyphs.push({ character, x, width });
        x += width + LETTER_SPACING;
    }
    const width = Math.max(0, x - LETTER_SPACING);

    const { height } = FONTS[font];
    const half = Math.trunc(rows / 2);
    const shift = mapRange(yOffset, 0, 255, -half, half);
    const top = shift + Math.trunc((rows - height) / 2);

    const fits = width <= columns;
    const motion: TextMotion = !fits
        ? 'across'
        : yOffset === 0
        ? 'up'
        : yOffset === 255
        ? 'down'
        : 'still';

    return { glyphs, width, height, top, motion };
};
