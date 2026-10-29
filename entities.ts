import { BuiltinFormat, BuiltinIds, defaultFormatFor } from './builtins.ts';
import { TextFont, TextRotation } from './fonts.ts';

/**
 * The registry: every entity the panel knows about, what kind of value it
 * carries, and how it is drawn once the flow picks it.
 *
 * `PANEL_ENTITIES` is now only the *seed* for a fresh `panel.config.json`;
 * once that file exists it is the registry and this list is unused. Which
 * entity wins is `flow.ts`'s business, not a `role` on the entity.
 *
 * The Home Assistant ids here are mocks; `deno task entities` lists the real
 * ones. The two `builtin.` ones are not Home Assistant's at all — see
 * `builtins.ts`.
 */

export type RGBColor = [number, number, number];

/**
 * How text looks, apart from what it says: every knob WLED's Scrolling Text
 * effect has, bar the *Custom Font* checkbox — that one needs a font file
 * uploaded to the device, which nothing here can put there.
 *
 * This is the shape of the configuration's `textSettings`, which both styles
 * that draw text inherit. A display stores only the ones it sets for itself,
 * as `TextOverrides`, so changing a global reaches the rest of them.
 */
export type TextSettings = {
    color: RGBColor,
    /**
     * The far end of the gradient, `col[2]`, read only while `gradient` is on.
     * Equal to `color` draws no visible gradient, which is what the effect
     * does by itself when the checkbox is off.
     */
    gradientColor: RGBColor,
    /** Scroll speed, `sx`, 0-255 as in the WLED UI. */
    speed: number,
    /**
     * `ix`, 0-255; 128 is the vertical middle. At exactly 0 or 255, text that
     * fits the segment scrolls up or down instead of sitting still.
     */
    yOffset: number,
    /**
     * `c1`, 0-255: how much of the last frame each new one leaves behind, as
     * `fade_out(255 - (c1 >> 4))`. 0 is no trail, which is what a scrolling
     * reading wants — anything else smears it.
     */
    trail: number,
    /** One of WLED 16's built-in fonts, sent as `c2` — see `fonts.ts`. */
    font: TextFont,
    /** Which way up the letters are, sent as `c3` — see `fonts.ts`. */
    rotation: TextRotation,
    /** `o1`: draw the letters as a gradient from `color` to `gradientColor`. */
    gradient: boolean,
    /** `o3`: scroll left to right rather than right to left. */
    reverse: boolean,
};

/**
 * What one text view sets for itself. Every key left out is taken from the
 * configuration's `textSettings` instead, which is what makes a global edit
 * reach a view that already exists.
 */
export type TextOverrides = Partial<TextSettings>;

/**
 * The global's own starting values. The colour and speed are what a text
 * display used to be seeded with; the font and Y offset are the values
 * `wled.ts` used to pin for every plain text segment, so a panel reads the
 * same after the upgrade as before it. The rest are WLED's own defaults for
 * the effect — no trail, upright, no gradient, scrolling right to left.
 */
export const DEFAULT_TEXT_SETTINGS: TextSettings = {
    color: [255, 255, 255],
    gradientColor: [255, 255, 255],
    speed: 70,
    yOffset: 128,
    trail: 0,
    font: 0,
    rotation: 'normal',
    gradient: false,
    reverse: false,
};

/**
 * A text view's effective look. Written out field by field rather than as a
 * spread so that a key present but undefined — which `structuredClone` of a
 * half-cleared override can leave behind — still falls through to the global,
 * and so that adding a setting without handling it here will not compile.
 */
export const resolveTextSettings = (
    global: TextSettings,
    overrides: TextOverrides,
): TextSettings => ({
    color: overrides.color ?? global.color,
    gradientColor: overrides.gradientColor ?? global.gradientColor,
    speed: overrides.speed ?? global.speed,
    yOffset: overrides.yOffset ?? global.yOffset,
    trail: overrides.trail ?? global.trail,
    font: overrides.font ?? global.font,
    rotation: overrides.rotation ?? global.rotation,
    gradient: overrides.gradient ?? global.gradient,
    reverse: overrides.reverse ?? global.reverse,
});

export const ReadingKinds = {
    /** Numeric state treated as 0-100. */
    Percent: 'percent',
    /** Numeric state, with the unit taken from the entity. */
    Temperature: 'temperature',
    /** A string: a media player's title and artist, or any sensor's state. */
    Text: 'text',
} as const;

export type ReadingKind = typeof ReadingKinds[keyof typeof ReadingKinds];

/**
 * How one entity is drawn. For `text` and `bar`, `style` is the intent rather
 * than a WLED effect id: which effect that becomes, and which sliders carry
 * what, is `wled.ts`'s business.
 *
 * `custom` is the escape hatch from that, for the displays those two intents
 * cannot express — a title and a progress bar on two segments at once, say.
 * It gives up the abstraction entirely: you write the device's own JSON, and
 * nothing here knows what any of it means.
 */
export type PlainDisplay =
    | {
        style: 'text',
        segmentId: number,
        /**
         * What the segment name says, with `template.ts`'s placeholders:
         * `'{{value}}'` on its own, or with anything around it, e.g.
         * `'PV {{value}}W'`. That is the whole of prefixes and suffixes.
         */
        text: string,
        /**
         * Only what this view sets for itself; `{}` follows the global
         * `textSettings` entirely. Nested rather than spread flat so that a
         * setting it has overridden can be told from one it has not.
         */
        settings: TextOverrides,
    }
    | {
        style: 'bar',
        segmentId: number,
        color: RGBColor,
        /** The unfilled part of the bar. */
        trackColor: RGBColor,
    }
    | {
        /**
         * A picture with a reading beside it, the one custom body every glyph
         * used to be written as: the picture on segment 0 across the whole
         * panel, frozen, and the text on segment 1 from `textStart`, blended
         * over it with Lighten — so the picture may run on under the text, as
         * the solar one does by a column. `wled.ts` writes both.
         */
        style: 'iconText',
        /** The whole 32x8 panel, row by row, each `'RRGGBB'`: segment 0 exactly. */
        pixels: string[],
        textStart: number,
        text: string,
        /** Its text half's own settings, over the global, exactly as `text`'s. */
        settings: TextOverrides,
    }
    | {
        style: 'custom',
        /**
         * A whole `/json/state` body, with `{{...}}` placeholders from
         * `template.ts` standing in for the reading. There is no `segmentId`:
         * the segments are the ones its own `seg` array names, which is why
         * `panelConfig.ts` insists each of those carries a literal `id`.
         */
        payload: Record<string, unknown>,
    };

/**
 * One case of a `byState` display. `is` is drawn while the entity's raw state
 * is any of `states`, compared exactly — `sunny`, `clear-night`, `playing`.
 * `above` and `below` read the raw state as a number and compare it with
 * `value`, strictly, as the flow's own tests do; a state that is not a number
 * — `unavailable`, say — matches neither.
 */
export type StateCase =
    | {
        test: 'is',
        states: string[],
        display: PlainDisplay,
    }
    | {
        test: 'above' | 'below',
        value: number,
        display: PlainDisplay,
    };

export type StateCaseTest = StateCase['test'];

/** The raw state as a number, or `undefined` when it is not one. */
const toStateNumber = (state: string): number | undefined => {
    // `Number('')` is 0, which would put an empty state below 1.
    if (state.trim() === '') {
        return undefined;
    }
    const number = Number(state);
    return Number.isFinite(number) ? number : undefined;
};

export const matchesStateCase = (stateCase: StateCase, state: string): boolean => {
    if (stateCase.test === 'is') {
        return stateCase.states.includes(state);
    }
    const number = toStateNumber(state);
    if (number === undefined) {
        return false;
    }
    return stateCase.test === 'above' ? number > stateCase.value : number < stateCase.value;
};

/**
 * Either one way of drawing the entity, or a choice between several made on
 * its raw state: the first case the state matches wins, and `otherwise` is
 * drawn when none does. The cases are plain displays — a choice inside a
 * choice would be a second flow, and the flow is where conditions belong.
 *
 * A glyph for a state is an `iconText` case: WLED's fonts are ASCII only, so a
 * picture is per-pixel data in a segment's `i`.
 */
export type WledDisplay =
    | PlainDisplay
    | {
        style: 'byState',
        cases: StateCase[],
        otherwise: PlainDisplay,
    };

export type PanelEntity = {
    entityId: string,
    kind: ReadingKind,
    display: WledDisplay,
    /**
     * Built-in items only, where it is required: which of that item's fixed
     * formats it renders in. `panelConfig.ts` refuses it on a Home Assistant
     * entity, which has nothing to do with it, and refuses its absence on a
     * built-in — so the two invalid combinations cannot be saved or read.
     */
    format?: BuiltinFormat,
};

/** Named so the registry and the mock data cannot drift apart. */
export const EntityIds = {
    Speaker: 'media_player.living_room_2_0',
    Television: 'media_player.bedroom_tv',
    Temperature: 'sensor.kitchen_temperature',
    Battery: 'sensor.battery_level',
} as const;

const GREEN: RGBColor = [0, 255, 80];
const DIM_BLUE: RGBColor = [0, 20, 40];
const AMBER: RGBColor = [255, 160, 0];
const SKY: RGBColor = [110, 175, 255];

/**
 * Each of these overrides only what it wants to differ from the global, so the
 * seed reads as the handful of deliberate choices it is — and a later change to
 * the global's font or trail reaches all of them. White is the global's own
 * colour, so the two media players name none.
 */
export const PANEL_ENTITIES: PanelEntity[] = [
    {
        entityId: EntityIds.Speaker,
        kind: ReadingKinds.Text,
        display: { style: 'text', segmentId: 0, text: '{{value}}', settings: { speed: 80 } },
    },
    {
        entityId: EntityIds.Television,
        kind: ReadingKinds.Text,
        // Never drawn: the default flow only ever blanks the panel on this
        // one. The display is here because every entity has one.
        display: { style: 'text', segmentId: 0, text: '{{value}}', settings: { speed: 80 } },
    },
    {
        entityId: EntityIds.Temperature,
        kind: ReadingKinds.Temperature,
        display: { style: 'text', segmentId: 0, text: '{{value}}', settings: { color: AMBER, speed: 60 } },
    },
    {
        entityId: EntityIds.Battery,
        kind: ReadingKinds.Percent,
        display: { style: 'bar', segmentId: 0, color: GREEN, trackColor: DIM_BLUE },
    },
    // Seeded but not in the default flow, which is still exactly the order that
    // used to be hardcoded. The README says how to make the clock the
    // OTHERWISE block if you want the panel lit when nothing else is on.
    {
        entityId: BuiltinIds.Time,
        kind: ReadingKinds.Text,
        format: defaultFormatFor(BuiltinIds.Time),
        display: { style: 'text', segmentId: 0, text: '{{value}}', settings: { color: SKY, speed: 60 } },
    },
    {
        entityId: BuiltinIds.Date,
        kind: ReadingKinds.Text,
        format: defaultFormatFor(BuiltinIds.Date),
        display: { style: 'text', segmentId: 0, text: '{{value}}', settings: { color: SKY, speed: 60 } },
    },
];
