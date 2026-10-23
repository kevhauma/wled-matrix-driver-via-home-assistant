/**
 * Brings a `panel.config.json` written by an older version up to the current
 * shape, before `parsePanelConfig` sees it.
 *
 * Only the file goes through here. The editor always sends what it was given
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

const STEPS: Record<number, (config: Json) => Json> = {
    1: toVersion2,
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
