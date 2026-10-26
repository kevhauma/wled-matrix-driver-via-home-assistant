import { BuiltinFormat, BuiltinIds, defaultFormatFor } from './builtins.ts';

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
        color: RGBColor,
        /** Scroll speed, 0-255 as in the WLED UI. */
        speed: number,
        /**
         * What the segment name says, with `template.ts`'s placeholders:
         * `'{{value}}'` on its own, or with anything around it, e.g.
         * `'PV {{value}}W'`. That is the whole of prefixes and suffixes.
         */
        text: string,
    }
    | {
        style: 'bar',
        segmentId: number,
        color: RGBColor,
        /** The unfilled part of the bar. */
        trackColor: RGBColor,
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
 * A glyph for a state is a `custom` case: WLED's fonts are ASCII only, so a
 * picture is per-pixel data in the body's own `seg[].i`.
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

const WHITE: RGBColor = [255, 255, 255];
const GREEN: RGBColor = [0, 255, 80];
const DIM_BLUE: RGBColor = [0, 20, 40];
const AMBER: RGBColor = [255, 160, 0];
const SKY: RGBColor = [110, 175, 255];

export const PANEL_ENTITIES: PanelEntity[] = [
    {
        entityId: EntityIds.Speaker,
        kind: ReadingKinds.Text,
        display: { style: 'text', segmentId: 0, color: WHITE, speed: 80, text: '{{value}}' },
    },
    {
        entityId: EntityIds.Television,
        kind: ReadingKinds.Text,
        // Never drawn: the default flow only ever blanks the panel on this
        // one. The display is here because every entity has one.
        display: { style: 'text', segmentId: 0, color: WHITE, speed: 80, text: '{{value}}' },
    },
    {
        entityId: EntityIds.Temperature,
        kind: ReadingKinds.Temperature,
        display: { style: 'text', segmentId: 0, color: AMBER, speed: 60, text: '{{value}}' },
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
        display: { style: 'text', segmentId: 0, color: SKY, speed: 60, text: '{{value}}' },
    },
    {
        entityId: BuiltinIds.Date,
        kind: ReadingKinds.Text,
        format: defaultFormatFor(BuiltinIds.Date),
        display: { style: 'text', segmentId: 0, color: SKY, speed: 60, text: '{{value}}' },
    },
];
