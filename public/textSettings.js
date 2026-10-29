import { field, fromHex, make, option, sliderField, toHex } from '/dom.js';

/**
 * The text settings every text view inherits, and the controls that edit them.
 *
 * One list, used twice: the Settings tab draws the global from it, and the
 * Display tab draws a view's own overrides from the same list — so the two
 * cannot come to offer different settings, and adding one is a line here.
 */

/**
 * WLED 16's five built-in fonts, in `c2` order. The same fonts as `fonts.ts`'s
 * `FONTS`, which this cannot import; changing one means changing both.
 */
const FONT_CHOICES = [
    { value: 0, label: '0 — tom-thumb, 6 high' },
    { value: 1, label: '1 — TinyUnicode' },
    { value: 2, label: '2 — console 6x8' },
    { value: 3, label: '3 — c64esque' },
    { value: 4, label: '4 — 5x12, cropped' },
];

/**
 * The rotations `fonts.ts` names. Offered by name because `c3` is the one
 * slider on this effect that is not 0-255: WLED reads it as
 * `map(c3, 0, 31, -2, 2)`, so upright is 16 and 0 is a half turn. The server
 * sends whichever value selects the name picked here.
 */
const ROTATION_CHOICES = [
    { value: 'normal', label: 'upright' },
    { value: 'clockwise', label: '90° clockwise' },
    { value: 'counterClockwise', label: '90° counter-clockwise' },
    { value: 'upsideDown', label: 'upside down' },
];

const colourSetting = (label, value, onValue) => field(label, make('input', {
    type: 'color',
    value: toHex(value),
    onInput: event => onValue(fromHex(event.target.value)),
}));

const checkboxSetting = (label, value, onValue) => make('label', { class: 'field check' }, [
    make('input', {
        type: 'checkbox',
        checked: value,
        onChange: event => onValue(event.target.checked),
    }),
    make('span', { textContent: label }),
]);

/**
 * Each option carries its *position* as the DOM value and the real value in
 * the list, so a choice can be a number (a font) or a string (a rotation)
 * without anything here having to know which to parse it back to.
 */
const choiceSetting = choices => (label, value, onValue) => {
    const nodes = choices.map((choice, index) =>
        option(String(index), choice.label, choice.value === value)
    );
    const select = make('select', {
        onChange: event => onValue(choices[Number(event.target.value)].value),
    }, nodes);
    return field(label, select);
};

/** `entities.ts`'s `TextSettings`, in the order they are worth reading in. */
export const TEXT_SETTINGS = [
    { name: 'color', label: 'colour', build: colourSetting },
    { name: 'speed', label: 'scroll speed', build: sliderField },
    { name: 'yOffset', label: 'y offset', build: sliderField },
    { name: 'trail', label: 'trail', build: sliderField },
    { name: 'font', label: 'font', build: choiceSetting(FONT_CHOICES) },
    { name: 'rotation', label: 'rotation', build: choiceSetting(ROTATION_CHOICES) },
    { name: 'reverse', label: 'scroll left to right', build: checkboxSetting },
    { name: 'gradient', label: 'gradient', build: checkboxSetting },
    { name: 'gradientColor', label: 'gradient far end', build: colourSetting },
];

/** What the `?` on either card explains, since both carry the same settings. */
export const TEXT_SETTINGS_HELP = [
    'Y offset 128 is the middle row. At exactly 0 or 255 WLED scrolls text that '
        + 'fits up or down instead of letting it sit still, which is almost never what '
        + 'you want for a reading.',
    'Trail is how much of the last frame each new one leaves behind. 0 is none; '
        + 'anything else smears a string that scrolls.',
    'A gradient runs from the colour to the far end and needs its checkbox. The two '
        + 'being the same colour draws no gradient at all.',
    'Rotation turns the letters. A quarter turn also stands each one on its side, so '
        + 'it changes how much text fits across the panel.',
    'Every one of these goes out on every text segment, even at its default: left '
        + 'unsent, the device keeps whatever its own UI last had, and neither the '
        + 'service nor this preview could say what the panel was showing.',
];

/**
 * `entities.ts`'s `resolveTextSettings`: the global with a view's own on top. A
 * key present in `overrides` means the view sets it, which the validator
 * guarantees by dropping any it was sent as null — the filter costs nothing and
 * keeps that guarantee from being load-bearing here.
 */
export const resolveTextSettings = (global, overrides) => {
    const own = Object.entries(overrides).filter(([, value]) => value !== undefined);
    return { ...global, ...Object.fromEntries(own) };
};

/** The global itself, edited in place. */
export const globalTextFields = (config, onEdit) =>
    TEXT_SETTINGS.map(setting =>
        setting.build(setting.label, config.textSettings[setting.name], value => {
            config.textSettings[setting.name] = value;
            onEdit();
        })
    );
