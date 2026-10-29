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

/**
 * Which way up the letters are drawn. A quarter turn is not just a rotation of
 * the glyphs: `mode_2Dscrollingtext` swaps each one's width and height, so it
 * changes what fits across the panel too.
 */
export const TEXT_ROTATIONS = ['normal', 'clockwise', 'counterClockwise', 'upsideDown'] as const;

export type TextRotation = typeof TEXT_ROTATIONS[number];

type FontMetrics = {
    height: number,
    /** One width for every glyph, or one per character from space to `~`. */
    widths: number | readonly number[],
};

/**
 * Every built-in font sets one column between glyphs, and a quarter turn makes
 * the effect use one regardless — so this holds whatever the rotation.
 */
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

/**
 * `c3` is the one slider on this effect that is not 0-255. WLED declares
 * `custom3` as a five-bit field and the effect reads it as
 * `map(c3, 0, 31, -2, 2)`, giving quarter turns of -2 to +2 — so a value above
 * 31 maps far outside that range and is drawn at an orientation nothing names.
 *
 * Hence a rotation is stored by name and sent as the lowest `c3` that selects
 * it, the way a font is: upright is 16, not 0, and 0 is upside down. Offering
 * the raw slider would make "no rotation" the one value nobody would guess.
 */
const ROTATION_SLIDERS: Record<TextRotation, number> = {
    upsideDown: 0,
    clockwise: 8,
    normal: 16,
    counterClockwise: 24,
};

export const rotationSliderOf = (rotation: TextRotation): number => ROTATION_SLIDERS[rotation];

/** Which rotation a raw `c3` selects, for a custom body that writes its own. */
export const rotationOfSlider = (slider: number): TextRotation => {
    const atLeastZero = Math.max(0, slider);
    const clamped = Math.min(31, atLeastZero);
    const turns = mapRange(clamped, 0, 31, -2, 2);
    if (turns === -1) {
        return 'clockwise';
    }
    if (turns === 1) {
        return 'counterClockwise';
    }
    // Both ends of the range are a half turn: -2 at 0, and +2 at 31 alone.
    return turns === 0 ? 'normal' : 'upsideDown';
};

/**
 * A quarter turn, where WLED swaps a glyph's width and height. A half turn
 * leaves both alone, so only these two change what fits.
 */
const isQuarterTurn = (rotation: TextRotation): boolean =>
    rotation === 'clockwise' || rotation === 'counterClockwise';

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
    height: number,
    /**
     * The row this glyph's top edge is on while nothing moves it vertically.
     * Per glyph rather than per string: WLED centres each one by its own
     * height, which under a quarter turn is its own *width* and so differs
     * from letter to letter.
     */
    top: number,
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
    /** The tallest glyph; under a quarter turn, the widest letter's width. */
    height: number,
    /**
     * The rows the Y offset moves the text, before each glyph is centred by
     * its own height. Separated out because the preview replaces it while
     * animating a vertical scroll and still has to centre each glyph itself.
     */
    shift: number,
    /** Where a glyph of the layout's own height sits. `shift` plus its centring. */
    top: number,
    motion: TextMotion,
};

export type TextLayoutInput = {
    /** Already ASCII: the device has no glyph for anything else. */
    text: string,
    font: TextFont,
    /** `ix`, 0-255. */
    yOffset: number,
    rotation: TextRotation,
    columns: number,
    rows: number,
};

export const layoutText = (
    { text, font, yOffset, rotation, columns, rows }: TextLayoutInput,
): TextLayout => {
    const fontHeight = FONTS[font].height;
    const quarterTurn = isQuarterTurn(rotation);
    const half = Math.trunc(rows / 2);
    const shift = mapRange(yOffset, 0, 255, -half, half);
    const topOf = (glyphHeight: number): number => shift + Math.trunc((rows - glyphHeight) / 2);

    const glyphs: TextGlyph[] = [];
    let x = 0;
    for (const character of text) {
        const unrotated = glyphWidth(character, font);
        // A quarter turn stands the glyph on its side, so what was its width
        // now costs rows and the font's height is what it costs columns.
        const width = quarterTurn ? fontHeight : unrotated;
        const height = quarterTurn ? unrotated : fontHeight;
        glyphs.push({ character, x, width, height, top: topOf(height) });
        x += width + LETTER_SPACING;
    }
    const width = Math.max(0, x - LETTER_SPACING);

    const heights = glyphs.map(glyph => glyph.height);
    const height = heights.length === 0 ? fontHeight : Math.max(...heights);

    const fits = width <= columns;
    const motion: TextMotion = !fits
        ? 'across'
        : yOffset === 0
        ? 'up'
        : yOffset === 255
        ? 'down'
        : 'still';

    return { glyphs, width, height, shift, top: topOf(height), motion };
};
