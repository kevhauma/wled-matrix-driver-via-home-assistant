/**
 * Folding Home Assistant's text down to what WLED's fonts can draw.
 *
 * The built-in fonts cover printable ASCII. Firmware before 16.0 copies the
 * segment name through a `name[i] > 31 && name[i] < 128` filter in
 * `mode_2DScrollingText` and draws the date when nothing survives; 16.0 keeps
 * the bytes and decodes UTF-8, but its fonts still have no glyph, so the same
 * text comes out blank. Dropping the bytes on this side used to produce both
 * symptoms: `Café` reached the panel as `Caf`, and `春泥棒` as the date.
 *
 * `wled-now-playing/wled/text.ts` in the sandbox holds the same table. It is
 * deliberately copied rather than shared: this project deploys by `git pull`
 * from its own remote and has no path to the rest of the sandbox.
 */

/**
 * Characters with an obvious ASCII stand-in. Accents are handled by NFD
 * decomposition instead, so these are the letters that do not decompose, plus
 * the punctuation that media metadata is full of. Anything missing here is
 * dropped rather than mangled.
 */
const SUBSTITUTIONS: Record<string, string> = {
    'ø': 'o', 'Ø': 'O', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ß': 'ss',
    'ð': 'd', 'Ð': 'D', 'þ': 'th', 'Þ': 'Th', 'đ': 'd', 'Đ': 'D', 'ł': 'l',
    'Ł': 'L', 'ı': 'i', 'ħ': 'h', 'ŧ': 't', 'ĸ': 'k',
    '‘': "'", '’': "'", '‛': "'", '′': "'", '‚': ',',
    '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"',
    '«': '<<', '»': '>>', '‹': '<', '›': '>',
    '–': '-', '—': '-', '―': '-', '‐': '-', '‑': '-', '‒': '-', '−': '-',
    '…': '...', '•': '*', '·': '.', '×': 'x', '÷': '/', '⁄': '/',
    '™': 'TM', '©': '(c)', '®': '(R)', '№': 'No.',
};

const NON_PRINTABLE_ASCII = /[^\x20-\x7E]/g;

/**
 * Folds text down to the printable ASCII the device's fonts can draw. Folding
 * here also makes the 32 character budget honest: `WLED_MAX_SEGNAME_LEN` is a
 * byte count, and `Segment::setName` truncates with
 * `min(strlen(newName), WLED_MAX_SEGNAME_LEN)`, so a multi-byte name would
 * otherwise be cut mid-character.
 */
export const toDeviceText = (text: string): string => {
    const decomposed = text.normalize('NFD');
    const unaccented = decomposed.replace(/\p{Diacritic}/gu, '');
    const substituted = unaccented.replace(/./gu, character => SUBSTITUTIONS[character] ?? character);
    // `\s` covers the no-break and typographic spaces; the rest go in the next step.
    const spaced = substituted.replace(/\s/gu, ' ');
    const ascii = spaced.replace(NON_PRINTABLE_ASCII, '');
    const collapsed = ascii.replace(/ +/g, ' ');
    return collapsed.trim();
};

const LETTER_OR_DIGIT = /[A-Za-z0-9]/;

/**
 * Whether folded text is worth sending at all. Emptiness is not the test:
 * `ヨルシカ - 春泥棒` folds to a bare `-` and `Полюбила не того` to two spaces,
 * which escape the date fallback while saying no more than the date did.
 */
export const isRenderable = (text: string): boolean => LETTER_OR_DIGIT.test(text);

/**
 * Whether the fold found a stand-in for everything or had to drop something:
 * `Café` folds without loss, `春泥棒 Live` does not. Only the editor cares —
 * the service draws what it can either way — but a view that quietly loses
 * most of its text is worth saying out loud.
 */
export const foldsWithoutLoss = (text: string): boolean => {
    const characters = [...text.normalize('NFC')];
    const dropped = characters.find(character => {
        const isSpace = /\s/u.test(character);
        if (isSpace) {
            return false;
        }
        const folded = toDeviceText(character);
        return folded === '';
    });
    return dropped === undefined;
};
