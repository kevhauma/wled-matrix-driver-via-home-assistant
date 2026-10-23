/**
 * The items the panel can show that are not Home Assistant entities: a clock
 * and a date, rendered here from the host's own clock.
 *
 * They sit in the registry beside the entities and go through the same reading,
 * the same flow and the same payload, so a clock can be a rotation member, an
 * `OTHERWISE` target or the `{{value}}` of a custom body with nothing special
 * anywhere downstream. The only thing that knows they are different is
 * `bridge.ts`, which reads them from the clock rather than from the lookup, and
 * leaves them out of the subscription.
 *
 * This module imports nothing on purpose: `entities.ts` needs the format type,
 * and importing a `Reading` back from `readings.ts` would close a cycle.
 */

export const BuiltinIds = {
    Time: 'builtin.time',
    Date: 'builtin.date',
} as const;

export type BuiltinId = typeof BuiltinIds[keyof typeof BuiltinIds];

const BUILTIN_IDS: readonly string[] = Object.values(BuiltinIds);

export const isBuiltinId = (entityId: string): entityId is BuiltinId => {
    const found = BUILTIN_IDS.find(candidate => candidate === entityId);
    return found !== undefined;
};

/**
 * A fixed set of named formats rather than a pattern string, for the same
 * reason `template.ts` is not a template language: the panel shows one short
 * string, and a format you can mistype is a thing that goes wrong on a device
 * you cannot read a stack trace from.
 *
 * Every name is unique across both items, which is what lets `renderBuiltin`
 * switch on the format alone and be checked as total.
 */
export const TimeFormats = {
    /** `14:32` */
    Hour24: 'hour24',
    /** `2:32pm` */
    Hour12: 'hour12',
    /** `14:32:05` */
    Hour24Seconds: 'hour24Seconds',
} as const;

export type TimeFormat = typeof TimeFormats[keyof typeof TimeFormats];

export const DateFormats = {
    /** `Thu 22 Oct` */
    WeekdayDayMonth: 'weekdayDayMonth',
    /** `22 Oct` */
    DayMonth: 'dayMonth',
    /** `22/10` */
    DayMonthNumeric: 'dayMonthNumeric',
    /** `2026-10-22` */
    IsoDate: 'isoDate',
} as const;

export type DateFormat = typeof DateFormats[keyof typeof DateFormats];

export type BuiltinFormat = TimeFormat | DateFormat;

/** Which formats each item accepts, and in which order the editor offers them. */
const FORMATS: Record<BuiltinId, readonly BuiltinFormat[]> = {
    [BuiltinIds.Time]: [TimeFormats.Hour24, TimeFormats.Hour12, TimeFormats.Hour24Seconds],
    [BuiltinIds.Date]: [
        DateFormats.WeekdayDayMonth,
        DateFormats.DayMonth,
        DateFormats.DayMonthNumeric,
        DateFormats.IsoDate,
    ],
};

export const formatsFor = (entityId: BuiltinId): readonly BuiltinFormat[] => FORMATS[entityId];

/** What a freshly added item gets, and the first entry of each list above. */
export const defaultFormatFor = (entityId: BuiltinId): BuiltinFormat => FORMATS[entityId][0];

/**
 * Written out rather than taken from `toLocaleString`, which would make the
 * panel depend on the host's locale and on which ICU the Deno build carries.
 * Recent ICU puts a narrow no-break space before `PM`, and `wled.ts` strips
 * every non-ASCII character — so `2:32 PM` would reach the device as `2:32PM`
 * on one machine and `2:32 PM` on another.
 */
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

const padded = (value: number): string => String(value).padStart(2, '0');

/**
 * Totality is checked by the switch: every format in both sets above has a case
 * here, and the id is not consulted — a format belonging to the other item is
 * refused by the validator, not resolved here.
 */
export const renderBuiltin = (format: BuiltinFormat, at: Date): string => {
    const hours = at.getHours();
    const minutes = padded(at.getMinutes());

    switch (format) {
        case 'hour24':
            return `${padded(hours)}:${minutes}`;
        case 'hour12': {
            const suffix = hours < 12 ? 'am' : 'pm';
            const twelve = hours % 12 === 0 ? 12 : hours % 12;
            return `${twelve}:${minutes}${suffix}`;
        }
        case 'hour24Seconds':
            return `${padded(hours)}:${minutes}:${padded(at.getSeconds())}`;
        case 'weekdayDayMonth':
            return `${WEEKDAY_NAMES[at.getDay()]} ${at.getDate()} ${MONTH_NAMES[at.getMonth()]}`;
        case 'dayMonth':
            return `${at.getDate()} ${MONTH_NAMES[at.getMonth()]}`;
        case 'dayMonthNumeric':
            return `${padded(at.getDate())}/${padded(at.getMonth() + 1)}`;
        case 'isoDate':
            return `${at.getFullYear()}-${padded(at.getMonth() + 1)}-${padded(at.getDate())}`;
    }
};

/** One format, as the editor offers it: the example *is* the label. */
export type BuiltinFormatChoice = {
    format: BuiltinFormat,
    /** What this format renders to right now, e.g. `14:32`. */
    example: string,
};

export type BuiltinDescription = {
    entityId: BuiltinId,
    /** For the entity library, where it sits beside Home Assistant's own. */
    label: string,
    formats: BuiltinFormatChoice[],
};

const LABELS: Record<BuiltinId, string> = {
    [BuiltinIds.Time]: 'Time (built in)',
    [BuiltinIds.Date]: 'Date (built in)',
};

/**
 * Served to the editor over `/api/builtins` rather than repeated in the
 * browser code, so the formats and their examples cannot drift from the ones
 * above — which is what happened to `template.ts`'s placeholder help.
 */
export const describeBuiltins = (at: Date): BuiltinDescription[] =>
    Object.values(BuiltinIds).map(entityId => {
        const choices = formatsFor(entityId).map(format => {
            const example = renderBuiltin(format, at);
            return { format, example };
        });
        return { entityId, label: LABELS[entityId], formats: choices };
    });
