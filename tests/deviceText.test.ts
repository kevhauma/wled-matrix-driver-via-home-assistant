import { foldsWithoutLoss, isRenderable, toDeviceText } from '../deviceText.ts';

/**
 * The fold that stands between Home Assistant's text and WLED's ASCII fonts.
 * `wled.ts` switches a segment off when nothing here survives, because an
 * empty segment name makes Scrolling Text draw the date.
 */

const assertSame = (actual: unknown, expected: unknown, message: string): void => {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
};

Deno.test('accents fold to their base letter rather than being dropped', () => {
    assertSame(toDeviceText('Café del Mar'), 'Cafe del Mar', 'accent');
    assertSame(toDeviceText('Björk • Army'), 'Bjork * Army', 'umlaut and bullet');
    assertSame(toDeviceText('Håkan Hellström'), 'Hakan Hellstrom', 'ring and umlaut');
});

Deno.test('the letters NFD leaves alone have their own stand-ins', () => {
    assertSame(toDeviceText('Ødegård'), 'Odegard', 'slashed o');
    assertSame(toDeviceText('Æon ß Œuf'), 'AEon ss OEuf', 'ligatures');
});

Deno.test('typographic punctuation folds to the ASCII it stands for', () => {
    assertSame(toDeviceText('Don’t Stop Me Now…'), "Don't Stop Me Now...", 'quote and ellipsis');
    assertSame(toDeviceText('Sigur Rós — Hoppípolla'), 'Sigur Ros - Hoppipolla', 'em dash');
});

Deno.test('the exotic spaces become one ordinary space', () => {
    assertSame(toDeviceText(' Spaced　​out '), 'Spaced out', 'no-break and ideographic');
});

Deno.test('a script with no stand-in at all leaves nothing renderable', () => {
    assertSame(toDeviceText('春泥棒'), '', 'kanji');
    assertSame(isRenderable(toDeviceText('Полюбила не того')), false, 'cyrillic folds to spaces');
    assertSame(isRenderable(toDeviceText('ヨルシカ - 春泥棒')), false, 'only the separator survives');
    assertSame(isRenderable(toDeviceText('18C')), true, 'an ordinary reading');
});

Deno.test('loss is what the editor warns about, not folding', () => {
    assertSame(foldsWithoutLoss('Café — Björk’s'), true, 'every character had a stand-in');
    assertSame(foldsWithoutLoss('春泥棒 Live'), false, 'the kanji had none');
});
