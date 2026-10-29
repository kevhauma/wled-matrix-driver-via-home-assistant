import {
    fontOfSlider,
    fontSliderOf,
    layoutText,
    rotationOfSlider,
    rotationSliderOf,
    TEXT_FONTS,
    TEXT_ROTATIONS,
    TextFont,
    TextRotation,
} from '../fonts.ts';

/**
 * Where WLED 16's Scrolling Text puts letters, which the editor's preview
 * draws from. The widths are the ones read out of `wled00/src/font/*.h`.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

const onPanel = (
    text: string,
    font: TextFont,
    yOffset = 128,
    rotation: TextRotation = 'normal',
) => layoutText({ text, font, yOffset, rotation, columns: 32, rows: 8 });

Deno.test('font 0 is 3 wide plus a column, so eight letters fit 32 columns and nine scroll', () => {
    const eight = onPanel('ABCDEFGH', 0);
    const nine = onPanel('ABCDEFGHI', 0);

    assertSame(eight.width, 31, 'no spacing after the last letter');
    assertSame(eight.motion, 'still', 'fits, so it sits centred');
    assertSame(nine.width, 35, 'nine letters');
    assertSame(nine.motion, 'across', 'too wide, so it scrolls');
});

Deno.test('a variable-width font spaces each letter by its own width', () => {
    const layout = onPanel('i W', 1);
    const positions = layout.glyphs.map(glyph => `${glyph.character}@${glyph.x}`).join(' ');

    // TinyUnicode: i is 1 wide, the space 7, W 5.
    assertSame(positions, 'i@0  @2 W@10', 'each advance is its width plus one');
    assertSame(layout.width, 15, 'the last glyph’s right edge');
});

Deno.test('the Y offset moves the text a row at a time, and 0 or 255 scroll text that fits', () => {
    assertSame(onPanel('18C', 0).top, 1, 'font 0 is 6 tall, centred in 8 rows at 128');
    assertSame(onPanel('18C', 0, 160).top, 2, 'a step past the middle is a row down');
    assertSame(onPanel('18C', 0, 0).motion, 'up', 'at 0 it rises');
    assertSame(onPanel('18C', 0, 255).motion, 'down', 'at 255 it falls');
    assertSame(onPanel('ABCDEFGHI', 0, 0).motion, 'across', 'text that does not fit scrolls across whatever the offset');
});

Deno.test('a font taller than the panel is centred and cropped', () => {
    assertSame(onPanel('A', 4).top, -2, '12 rows centred in 8');
});

Deno.test('each font is sent as the lowest c2 that selects it', () => {
    for (const font of TEXT_FONTS) {
        const slider = fontSliderOf(font);
        assertSame(fontOfSlider(slider), font, `font ${font} round-trips through c2 ${slider}`);
        if (slider > 0) {
            assertSame(fontOfSlider(slider - 1), font - 1, `c2 ${slider - 1} is still the font below`);
        }
    }
});

Deno.test('a quarter turn swaps every glyph’s width and height, so what fits changes', () => {
    // Font 2 is 6 wide and 8 tall, so a quarter turn costs 9 columns a letter
    // (8 plus the spacing) where upright it cost 6.
    const upright = onPanel('WWWW', 2);
    const turned = onPanel('WWWW', 2, 128, 'clockwise');

    assertSame(upright.width, 23, 'four 5-wide W’s and three columns of spacing');
    assertSame(upright.motion, 'still', 'which fits');
    assertSame(turned.width, 35, 'on their sides each one is the font’s 8 rows wide');
    assertSame(turned.motion, 'across', 'so the same four letters no longer fit');

    const glyph = turned.glyphs[0];
    assertSame(glyph.width, 8, 'the font’s height is now the glyph’s width');
    assertSame(glyph.height, 5, 'and its own width is now its height');
});

Deno.test('a half turn leaves the boxes alone — only the letterforms are flipped', () => {
    const upright = onPanel('ABCDEFGH', 0);
    const flipped = onPanel('ABCDEFGH', 0, 128, 'upsideDown');

    assertSame(flipped.width, upright.width, 'the same width');
    assertSame(flipped.motion, upright.motion, 'and so the same motion');
});

Deno.test('each glyph is centred by its own height, which a quarter turn varies', () => {
    // TinyUnicode: i is 1 wide, W 5 — so on their sides, 1 and 5 tall.
    const turned = onPanel('iW', 1, 128, 'counterClockwise');
    const tops = turned.glyphs.map(glyph => `${glyph.character}@${glyph.top}`).join(' ');

    assertSame(tops, 'i@3 W@1', 'the taller letter starts higher');
    assertSame(turned.shift, 0, 'the Y offset itself moves neither of them at 128');
    assertSame(turned.height, 5, 'the layout’s height is the tallest glyph');
});

Deno.test('each rotation is sent as the lowest c3 that selects it, and 16 is upright', () => {
    for (const rotation of TEXT_ROTATIONS) {
        const slider = rotationSliderOf(rotation);
        assertSame(rotationOfSlider(slider), rotation, `${rotation} round-trips through c3 ${slider}`);
    }

    assertSame(rotationSliderOf('normal'), 16, 'c3 0 is a half turn, so upright is 16');
    assertSame(rotationOfSlider(0), 'upsideDown', 'which is what a body sending c3 0 gets');
    // c3 is five bits wide, and this effect reads it as map(c3, 0, 31, -2, 2).
    assertSame(rotationOfSlider(31), 'upsideDown', 'the far end is the other half turn');
    assertSame(rotationOfSlider(255), 'upsideDown', 'a 0-255 value is clamped into that range');
});
