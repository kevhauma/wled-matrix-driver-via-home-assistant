/**
 * The items the panel can show that are not Home Assistant entities: a clock
 * and a date, rendered here from the host's own clock in the panel's timezone.
 * The same formats also render a Home Assistant timestamp — a `datetime`
 * entity — which adds one of its own, the time remaining until it.
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

/**
 * Only a timestamp entity has this one: a built-in item *is* now, so there is
 * never any time remaining until it.
 */
export const RemainingFormats = {
    /** `42m` under an hour, `1.6h` from one — never the two together. */
    TimeRemaining: 'timeRemaining',
} as const;

export type RemainingFormat = typeof RemainingFormats[keyof typeof RemainingFormats];

export type DateTimeFormat = BuiltinFormat | RemainingFormat;

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
 * What a `datetime` entity accepts, in the editor's order: the time it names,
 * the day it names, or how long until then. The first is what a freshly added
 * one gets.
 */
export const DATE_TIME_FORMATS: readonly DateTimeFormat[] = [
    ...FORMATS[BuiltinIds.Time],
    ...FORMATS[BuiltinIds.Date],
    RemainingFormats.TimeRemaining,
];

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

/**
 * An instant as it reads on a wall in one place: the fields the formats below
 * and a flow's time window are written in. Numbered as `Date` numbers them.
 */
export type WallClock = {
    year: number,
    /** 0 is January. */
    month: number,
    day: number,
    /** 0 is Sunday. */
    weekday: number,
    hours: number,
    minutes: number,
    seconds: number,
};

/**
 * One per zone, because building a formatter is the expensive part and the
 * bridge asks every tick. Only zones that built are kept, so a typo cannot
 * grow this.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * `en-US` and numeric fields only, so nothing here is locale text — the
 * names come from the tables above. `h23` rather than `hour12: false`, which
 * some ICU builds answer with `24` for the hour after midnight.
 */
const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
    const known = FORMATTERS.get(timeZone);
    if (known !== undefined) {
        return known;
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
    });
    FORMATTERS.set(timeZone, formatter);
    return formatter;
};

/** An IANA name like `Europe/Brussels`, as this Deno's ICU knows them. */
export const isTimeZone = (value: string): boolean => {
    try {
        formatterFor(value);
        return true;
    } catch {
        return false;
    }
};

/**
 * An empty zone means the host's own, which is what the panel did before it
 * had a setting — and still the right answer on a box whose zone is correct.
 */
export const toWallClock = (at: Date, timeZone: string): WallClock => {
    if (timeZone === '') {
        return {
            year: at.getFullYear(),
            month: at.getMonth(),
            day: at.getDate(),
            weekday: at.getDay(),
            hours: at.getHours(),
            minutes: at.getMinutes(),
            seconds: at.getSeconds(),
        };
    }

    const parts = formatterFor(timeZone).formatToParts(at);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
        const part = parts.find(candidate => candidate.type === type);
        return Number(part?.value);
    };
    const year = read('year');
    const month = read('month') - 1;
    const day = read('day');
    // From the date rather than a `weekday` part, which would be locale text.
    const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
    return {
        year,
        month,
        day,
        weekday,
        hours: read('hour'),
        minutes: read('minute'),
        seconds: read('second'),
    };
};

const padded = (value: number): string => String(value).padStart(2, '0');

/**
 * Totality is checked by the switch: every format in both sets above has a case
 * here, and the id is not consulted — a format belonging to the other item is
 * refused by the validator, not resolved here.
 */
export const renderBuiltin = (format: BuiltinFormat, at: WallClock): string => {
    const hours = at.hours;
    const minutes = padded(at.minutes);

    switch (format) {
        case 'hour24':
            return `${padded(hours)}:${minutes}`;
        case 'hour12': {
            const suffix = hours < 12 ? 'am' : 'pm';
            const twelve = hours % 12 === 0 ? 12 : hours % 12;
            return `${twelve}:${minutes}${suffix}`;
        }
        case 'hour24Seconds':
            return `${padded(hours)}:${minutes}:${padded(at.seconds)}`;
        case 'weekdayDayMonth':
            return `${WEEKDAY_NAMES[at.weekday]} ${at.day} ${MONTH_NAMES[at.month]}`;
        case 'dayMonth':
            return `${at.day} ${MONTH_NAMES[at.month]}`;
        case 'dayMonthNumeric':
            return `${padded(at.day)}/${padded(at.month + 1)}`;
        case 'isoDate':
            return `${at.year}-${padded(at.month + 1)}-${padded(at.day)}`;
    }
};

const MILLISECONDS_PER_MINUTE = 60_000;

/**
 * Whole minutes rounded up, so the last minute reads `1m` rather than `0m`.
 * From an hour on it is hours to one decimal, rounded from those same whole
 * minutes, so `60m` cannot follow `1.0h` on the way down.
 *
 * Undefined once the moment has come: there is nothing left to count, and
 * the reading drops out rather than sitting on `0m`.
 */
export const renderTimeRemaining = (milliseconds: number): string | undefined => {
    if (milliseconds <= 0) {
        return undefined;
    }
    const minutes = Math.ceil(milliseconds / MILLISECONDS_PER_MINUTE);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = (minutes / 60).toFixed(1);
    return `${hours}h`;
};

/**
 * `target` read in one of the formats: as a wall clock in `timeZone`, or as
 * the time from `now` until it. Undefined only for a time remaining that has
 * run out.
 */
export const renderDateTime = (
    format: DateTimeFormat,
    target: Date,
    now: Date,
    timeZone: string,
): string | undefined => {
    if (format === RemainingFormats.TimeRemaining) {
        const remaining = target.getTime() - now.getTime();
        return renderTimeRemaining(remaining);
    }
    const wallClock = toWallClock(target, timeZone);
    return renderBuiltin(format, wallClock);
};

/** One format, as the editor offers it: the example *is* the label. */
export type FormatChoice = {
    format: DateTimeFormat,
    /** What this format renders to right now, e.g. `14:32`. */
    example: string,
};

export type BuiltinDescription = {
    entityId: BuiltinId,
    /** For the entity library, where it sits beside Home Assistant's own. */
    label: string,
    formats: FormatChoice[],
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
export const describeBuiltins = (at: WallClock): BuiltinDescription[] =>
    Object.values(BuiltinIds).map(entityId => {
        const choices = formatsFor(entityId).map(format => {
            const example = renderBuiltin(format, at);
            return { format, example };
        });
        return { entityId, label: LABELS[entityId], formats: choices };
    });

/** Two fixed durations, one either side of the hour, so the label shows both forms. */
const REMAINING_EXAMPLES = [42 * MILLISECONDS_PER_MINUTE, 95 * MILLISECONDS_PER_MINUTE];

/**
 * A `datetime` entity's formats, for `/api/builtins` beside the items'. The
 * clock and date examples are now, since any instant shows the format; the
 * time remaining has no "now" to show, so it shows two fixed durations.
 */
export const describeDateTimeFormats = (now: Date, timeZone: string): FormatChoice[] =>
    DATE_TIME_FORMATS.map(format => {
        if (format === RemainingFormats.TimeRemaining) {
            const examples = REMAINING_EXAMPLES.map(renderTimeRemaining).join(' / ');
            return { format, example: `${examples} left` };
        }
        const example = renderDateTime(format, now, now, timeZone) ?? '';
        return { format, example };
    });
