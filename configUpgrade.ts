/**
 * Brings a `panel.config.json` written by an older version up to the current
 * shape, before `parsePanelConfig` sees it.
 *
 * Only a file goes through here: the one on disk, or one imported on the
 * Settings tab. The editor always sends what it was given
 * by `GET /api/config`, which is already current, so `PUT /api/config` is
 * validated as it arrives. Nothing is written back: the upgraded form reaches
 * the disk with the next save, so a file is never rewritten just by starting.
 *
 * Each step takes one version to the next and touches nothing else, and
 * anything it does not recognise is left for the validator to name.
 */

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Version 2 replaced a text display's optional `prefix` with a `text`
 * template, which says the same thing and also holds a suffix.
 */
const toVersion2 = (config: Json): Json => {
    const entities = Array.isArray(config.entities) ? config.entities : [];
    const upgraded = entities.map(entity => {
        if (!isRecord(entity) || !isRecord(entity.display) || entity.display.style !== 'text') {
            return entity;
        }
        const { prefix, ...display } = entity.display;
        const before = typeof prefix === 'string' ? prefix : '';
        return { ...entity, display: { ...display, text: `${before}{{value}}` } };
    });
    return { ...config, version: 2, entities: upgraded };
};

/**
 * Version 3 made a loop's members objects with ids of their own, so that one
 * entity can be a member twice with a different display each time. The old
 * entity id becomes the member id, numbered only where an old file somehow
 * repeated one.
 */
const toVersion3 = (config: Json): Json => {
    const flow = Array.isArray(config.flow) ? config.flow : [];
    const upgraded = flow.map(rule => {
        if (!isRecord(rule) || !isRecord(rule.action) || rule.action.do !== 'loop') {
            return rule;
        }
        const { entityIds, ...action } = rule.action;
        const ids = Array.isArray(entityIds) ? entityIds : [];
        const seen = new Map<unknown, number>();
        const members = ids.map(entityId => {
            const count = seen.get(entityId) ?? 0;
            seen.set(entityId, count + 1);
            const id = count === 0 ? String(entityId) : `${entityId}-${count + 1}`;
            return { id, entityId };
        });
        return { ...rule, action: { ...action, members } };
    });
    return { ...config, version: 3, flow: upgraded };
};

/**
 * Version 4 gave the output a timezone. Empty is the host's own, which is
 * what every older file was already getting.
 */
const toVersion4 = (config: Json): Json => {
    const output = isRecord(config.output) ? config.output : {};
    return { ...config, version: 4, output: { ...output, timeZone: '' } };
};

/**
 * Version 5 let a case of a display chosen by state compare a number as well
 * as list states, so every case says which it does. Every older case listed
 * states. Displays sit on entities, `show` rules and loop members.
 */
const tagCases = (display: unknown): unknown => {
    if (!isRecord(display) || display.style !== 'byState' || !Array.isArray(display.cases)) {
        return display;
    }
    const cases = display.cases.map(item => isRecord(item) ? { test: 'is', ...item } : item);
    return { ...display, cases };
};

const withTaggedDisplay = (holder: unknown): unknown =>
    isRecord(holder) && holder.display !== undefined ? { ...holder, display: tagCases(holder.display) } : holder;

const toVersion5 = (config: Json): Json => {
    const entities = Array.isArray(config.entities) ? config.entities.map(withTaggedDisplay) : config.entities;
    const flow = Array.isArray(config.flow) ? config.flow.map(rule => {
        if (!isRecord(rule) || !isRecord(rule.action)) {
            return rule;
        }
        const action = { ...withTaggedDisplay(rule.action) as Json };
        if (Array.isArray(action.members)) {
            action.members = action.members.map(withTaggedDisplay);
        }
        return { ...rule, action };
    }) : config.flow;
    return { ...config, version: 5, entities, flow };
};

/**
 * Version 6 gave the configuration one set of text settings that every text
 * view inherits, and named the sliders the effect has that nothing was setting
 * by choice. A view now stores only its own overrides.
 *
 * The global takes what an older file drew: the colour and speed a text
 * display was seeded with, and the font and Y offset `wled.ts` pinned for
 * every plain text segment. The four it adds — trail, rotation, gradient,
 * direction — take WLED's own defaults for the effect, which is the only step
 * here that changes what the device is told: a plain text segment used to
 * inherit `SEGMENT_RESET`'s `c1: 128`, a trail that smears a scrolling
 * reading, and now gets the 0 the `iconText` style always hardcoded.
 */
const GLOBAL_TEXT_SETTINGS = {
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

/** What each style carried flat before the settings were shared. */
const OLD_SETTINGS: Record<string, readonly string[]> = {
    text: ['color', 'speed'],
    iconText: ['color', 'speed', 'font', 'yOffset'],
};

/** Enough for the shapes these settings take: numbers, strings and a colour triple. */
const sameSetting = (one: unknown, other: unknown): boolean =>
    JSON.stringify(one ?? null) === JSON.stringify(other ?? null);

/**
 * A text view's flat settings become a nested `settings` holding only the ones
 * that differ from the new global, so every view still resolves to the look it
 * had while the ones that merely repeated the old defaults now follow the
 * global — which is the point of the version.
 */
const nestSettings = (display: unknown): unknown => {
    if (!isRecord(display)) {
        return display;
    }
    if (display.style === 'byState') {
        const cases = Array.isArray(display.cases) ? display.cases.map(withNestedSettings) : display.cases;
        const otherwise = nestSettings(display.otherwise);
        return { ...display, cases, otherwise };
    }

    const style = typeof display.style === 'string' ? display.style : '';
    const names = OLD_SETTINGS[style];
    if (names === undefined) {
        return display;
    }

    const settings: Json = {};
    const rest = { ...display };
    for (const name of names) {
        const value = display[name];
        if (value !== undefined && !sameSetting(value, GLOBAL_TEXT_SETTINGS[name as keyof typeof GLOBAL_TEXT_SETTINGS])) {
            settings[name] = value;
        }
        delete rest[name];
    }
    return { ...rest, settings };
};

const withNestedSettings = (holder: unknown): unknown =>
    isRecord(holder) && holder.display !== undefined
        ? { ...holder, display: nestSettings(holder.display) }
        : holder;

const toVersion6 = (config: Json): Json => {
    const entities = Array.isArray(config.entities)
        ? config.entities.map(withNestedSettings)
        : config.entities;
    const flow = Array.isArray(config.flow)
        ? config.flow.map(rule => {
            if (!isRecord(rule) || !isRecord(rule.action)) {
                return rule;
            }
            const action = { ...withNestedSettings(rule.action) as Json };
            if (Array.isArray(action.members)) {
                action.members = action.members.map(withNestedSettings);
            }
            return { ...rule, action };
        })
        : config.flow;
    return { ...config, version: 6, textSettings: GLOBAL_TEXT_SETTINGS, entities, flow };
};

const STEPS: Record<number, (config: Json) => Json> = {
    1: toVersion2,
    2: toVersion3,
    3: toVersion4,
    4: toVersion5,
    5: toVersion6,
};

export type Upgraded = {
    config: unknown,
    /** The version the file was written in, when it was not the current one. */
    upgradedFrom: number | undefined,
};

export const upgradePanelConfig = (value: unknown): Upgraded => {
    if (!isRecord(value) || typeof value.version !== 'number') {
        return { config: value, upgradedFrom: undefined };
    }

    const original = value.version;
    let config = value;
    let step = STEPS[original];
    while (step !== undefined) {
        config = step(config);
        step = STEPS[config.version as number];
    }

    const upgradedFrom = config.version === original ? undefined : original;
    return { config, upgradedFrom };
};
