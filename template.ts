/**
 * The `{{...}}` placeholders a custom display's JSON carries, and the one
 * substitution both the running service and the editor's preview go through.
 *
 * Deliberately not a template language: no expressions, no conditionals, no
 * formatting options. Each of those would be a thing that can go wrong on a
 * device you cannot read a stack trace from, and the value a panel shows is
 * one number or one string.
 */

/**
 * The whole vocabulary. `public/displayEditor.js` repeats these names in its
 * help text, because the editor is plain browser JavaScript and cannot import
 * this file — if a name changes here, change it there too.
 */
export const Placeholders = {
    /** The reading as the panel draws it: `18C`, `64%`, a title. */
    Value: 'value',
    /** 0-100, rounded; 0 when the reading carries no percentage. */
    Percent: 'percent',
    /** The temperature, rounded; 0 when the reading carries no temperature. */
    Degrees: 'degrees',
    /** The entity's `unit_of_measurement`, or empty. */
    Unit: 'unit',
    /** A media player's title alone, so it can have a segment of its own. */
    Title: 'title',
    Artist: 'artist',
} as const;

export type Placeholder = typeof Placeholders[keyof typeof Placeholders];

export const PLACEHOLDER_NAMES: readonly Placeholder[] = Object.values(Placeholders);

export type PlaceholderValues = Record<Placeholder, string | number>;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z]+)\s*\}\}/g;

/** The same pattern anchored, which is what decides a substitution's type. */
const WHOLE_STRING_PATTERN = /^\{\{\s*([A-Za-z]+)\s*\}\}$/;

export const isPlaceholder = (name: string): name is Placeholder => {
    const found = PLACEHOLDER_NAMES.find(candidate => candidate === name);
    return found !== undefined;
};

export type PlaceholderUse = { path: string, name: string };

/**
 * Every placeholder in a JSON value, with the path to it, so that a typo can
 * be refused at validation rather than scrolling across the panel as a literal
 * `{{percentage}}`.
 *
 * Only string *values* are looked at. WLED's keys are a fixed set, so a
 * placeholder in a key is a mistake rather than an intention, and filling it
 * could only produce a key the device ignores.
 */
export const findPlaceholders = (value: unknown, path: string): PlaceholderUse[] => {
    if (typeof value === 'string') {
        const matches = [...value.matchAll(PLACEHOLDER_PATTERN)];
        return matches.map(match => ({ path, name: match[1] }));
    }

    if (Array.isArray(value)) {
        return value.flatMap((item, index) => {
            const found = findPlaceholders(item, `${path}[${index}]`);
            return found;
        });
    }

    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value);
        return entries.flatMap(([key, item]) => {
            const found = findPlaceholders(item, `${path}.${key}`);
            return found;
        });
    }

    return [];
};

/**
 * A string that is *nothing but* one placeholder takes that value's own type.
 * That is what lets `"ix": "{{percent}}"` arrive at the device as the number
 * WLED needs — `ix` is read as an integer, and a string there is a silently
 * dead slider. Anywhere else the value is interpolated into the string, so
 * `"bat {{percent}}%"` is still text.
 *
 * An unknown name is left exactly as written. Validation refuses those long
 * before here, but this has to be total: it also runs on a draft the editor is
 * still being typed into.
 */
const fillString = (text: string, values: PlaceholderValues): string | number => {
    const whole = WHOLE_STRING_PATTERN.exec(text);
    if (whole !== null && isPlaceholder(whole[1])) {
        return values[whole[1]];
    }

    return text.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
        if (!isPlaceholder(name)) {
            return match;
        }
        const value = values[name];
        return String(value);
    });
};

export const fillTemplate = (value: unknown, values: PlaceholderValues): unknown => {
    if (typeof value === 'string') {
        const filled = fillString(value, values);
        return filled;
    }

    if (Array.isArray(value)) {
        return value.map(item => {
            const filled = fillTemplate(item, values);
            return filled;
        });
    }

    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value);
        const filled = entries.map(([key, item]) => {
            const next = fillTemplate(item, values);
            return [key, next];
        });
        return Object.fromEntries(filled);
    }

    return value;
};
