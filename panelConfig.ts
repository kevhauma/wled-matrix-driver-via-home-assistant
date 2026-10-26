import { BuiltinId, formatsFor, isBuiltinId, isTimeZone } from './builtins.ts';
import { Config } from './config.ts';
import {
    EntityIds,
    PANEL_ENTITIES,
    PanelEntity,
    PlainDisplay,
    RGBColor,
    StateCase,
    WledDisplay,
} from './entities.ts';
import { Action, Condition, FlowRule, LoopMember, MemberWhen } from './flow.ts';
import { findPlaceholders, isPlaceholder, PLACEHOLDER_NAMES } from './template.ts';

/**
 * The document the editor saves and the service reads: which entities exist,
 * how each is drawn, and the flow that picks between them.
 *
 * `WLED_IP` and `WLED_BRIGHTNESS` live here rather than in the environment
 * because they are things you adjust while looking at the panel. The env vars
 * seed this file the first time it is written; after that the file wins.
 */

export type PanelOutputConfig = {
    /** Empty means print the payload rather than posting it. */
    wledIp: string,
    brightness: number,
    /**
     * An IANA name like `Europe/Brussels`: what the built-in clock and a
     * flow's time window read in. Empty means the host's own zone, which a
     * container or a fresh Pi usually has as UTC.
     */
    timeZone: string,
};

export type PanelConfig = {
    version: 5,
    output: PanelOutputConfig,
    entities: PanelEntity[],
    flow: FlowRule[],
};

/** `configUpgrade.ts` brings an older file up to this before it is parsed. */
export const CONFIG_VERSION = 5;

/**
 * Reproduces exactly what `whatToShow` used to do in code: the television
 * blanks the panel, then music, then the sensors take turns.
 *
 * The trailing rule is not decoration. A loop whose members have all dropped
 * off deliberately does not match, so without a conditionless rule at the end
 * the flow could run out — and `reason` is taken from these labels, which is
 * what keeps the log lines identical to the hardcoded version's.
 */
export const defaultFlow = (rotateSeconds: number): FlowRule[] => [
    {
        id: 'television',
        label: 'the television is playing',
        match: 'all',
        conditions: [{ entityId: EntityIds.Television, test: 'isPlaying' }],
        action: { do: 'blank' },
    },
    {
        id: 'music',
        label: 'music is playing',
        match: 'all',
        conditions: [{ entityId: EntityIds.Speaker, test: 'isPlaying' }],
        action: { do: 'show', entityId: EntityIds.Speaker },
    },
    {
        id: 'sensors',
        label: 'the sensors take turns',
        match: 'all',
        conditions: [],
        action: {
            do: 'loop',
            members: [
                { id: 'temperature', entityId: EntityIds.Temperature },
                { id: 'battery', entityId: EntityIds.Battery },
            ],
            dwellSeconds: rotateSeconds,
        },
    },
    {
        id: 'idle',
        label: 'nothing is playing and no sensor has a reading',
        match: 'all',
        conditions: [],
        action: { do: 'blank' },
    },
];

/** What a fresh install gets: today's registry and today's behaviour. */
export const defaultPanelConfig = (config: Config): PanelConfig => {
    const flow = defaultFlow(config.rotateSeconds);
    return {
        version: CONFIG_VERSION,
        output: { wledIp: config.wled.ip, brightness: config.wled.brightness, timeZone: '' },
        entities: [...PANEL_ENTITIES],
        flow,
    };
};

/**
 * Validation, used both when reading the file at boot and when accepting a
 * save over HTTP, so that a hand-edited file and the editor cannot disagree
 * about what is allowed. Every message names the offending path and value,
 * because the usual way to meet this code is a typo in the file.
 */

const describeValue = (value: unknown): string => {
    if (typeof value === 'string') {
        return `'${value}'`;
    }
    if (value === undefined) {
        return 'nothing';
    }
    return JSON.stringify(value) ?? String(value);
};

/** Returned rather than thrown, so each caller's `throw` ends the branch and
 * TypeScript narrows the value it was checking. */
const fail = (path: string, wanted: string, value: unknown): Error => {
    const described = describeValue(value);
    return new Error(`${path} must be ${wanted}, got ${described}.`);
};

const asRecord = (value: unknown, path: string): Record<string, unknown> => {
    const isRecord = typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!isRecord) {
        throw fail(path, 'an object', value);
    }
    return value as Record<string, unknown>;
};

const asArray = (value: unknown, path: string): unknown[] => {
    if (!Array.isArray(value)) {
        throw fail(path, 'an array', value);
    }
    return value;
};

const asString = (value: unknown, path: string): string => {
    if (typeof value !== 'string') {
        throw fail(path, 'a string', value);
    }
    return value;
};

const asNonEmptyString = (value: unknown, path: string): string => {
    const text = asString(value, path);
    if (text.trim() === '') {
        throw fail(path, 'a non-empty string', value);
    }
    return text;
};

const asNumberInRange = (value: unknown, path: string, low: number, high: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw fail(path, 'a number', value);
    }
    if (value < low || value > high) {
        throw fail(path, `between ${low} and ${high}`, value);
    }
    return value;
};

const asOneOf = <T extends string>(value: unknown, path: string, allowed: readonly T[]): T => {
    const text = asString(value, path);
    const found = allowed.find(candidate => candidate === text);
    if (found === undefined) {
        const list = allowed.join(', ');
        throw fail(path, `one of ${list}`, value);
    }
    return found;
};

const asTimeZone = (value: unknown, path: string): string => {
    const text = asString(value, path);
    if (text === '' || isTimeZone(text)) {
        return text;
    }
    throw fail(path, 'an IANA timezone like Europe/Brussels, or empty for the host’s own', value);
};

const asColor = (value: unknown, path: string): RGBColor => {
    const parts = asArray(value, path);
    if (parts.length !== 3) {
        throw fail(path, 'three numbers', value);
    }
    const channels = parts.map((part, index) => {
        const channel = asNumberInRange(part, `${path}[${index}]`, 0, 255);
        return Math.round(channel);
    });
    return [channels[0], channels[1], channels[2]];
};

/**
 * `wled.ts` interpolates this straight into a URL, so anything that could
 * smuggle a scheme, a path or credentials into it has to be refused here —
 * this value can arrive from an HTTP request.
 */
const HOST_PATTERN = /^[a-zA-Z0-9.-]+(:\d{1,5})?$/;

const asHost = (value: unknown, path: string): string => {
    const text = asString(value, path);
    if (text === '') {
        return '';
    }
    if (!HOST_PATTERN.test(text)) {
        throw fail(path, 'a bare host or host:port', value);
    }
    return text;
};

/**
 * WLED's own JSON buffer is the real ceiling — roughly 10K on an ESP8266, 24K
 * on an ESP32. This sits far below it on purpose. A custom body is one panel's
 * worth of segments, it can arrive from an unauthenticated HTTP request, and a
 * cap this low means a paste of the wrong thing is refused here with a message
 * rather than silently failing on the device.
 */
const MAX_CUSTOM_PAYLOAD_LENGTH = 4096;

/**
 * Every placeholder is one that exists, because an unknown one would reach the
 * panel as a literal `{{percentage}}` and look like a font problem.
 */
const checkPlaceholders = (value: unknown, path: string): void => {
    const uses = findPlaceholders(value, path);
    const unknown = uses.find(use => !isPlaceholder(use.name));
    if (unknown === undefined) {
        return;
    }
    const known = PLACEHOLDER_NAMES.join(', ');
    const written = unknown.entityId === undefined
        ? unknown.name
        : `${unknown.entityId}:${unknown.name}`;
    throw new Error(
        `${unknown.path} references an unknown placeholder '{{${written}}}'. `
            + `Known: ${known}.`,
    );
};

/**
 * A custom display is the one place the configuration holds JSON this project
 * does not understand, so the few things it checks are the ones that keep the
 * rest of the service honest:
 *
 * - `seg` is present and its ids are literal numbers, because `segmentIdsOf`
 *   has to know which segments a display owns before there is a reading to
 *   fill it with — that is what lets the other segments be switched off.
 * - every placeholder is one that exists, because an unknown one would reach
 *   the panel as a literal `{{percentage}}` and look like a font problem.
 */
const parseCustomPayload = (value: unknown, path: string): Record<string, unknown> => {
    const record = asRecord(value, path);

    const text = JSON.stringify(record);
    if (text.length > MAX_CUSTOM_PAYLOAD_LENGTH) {
        throw new Error(
            `${path} must be at most ${MAX_CUSTOM_PAYLOAD_LENGTH} characters of JSON, `
                + `got ${text.length}.`,
        );
    }

    const segments = asArray(record.seg, `${path}.seg`);
    if (segments.length === 0) {
        throw fail(`${path}.seg`, 'at least one segment to draw', record.seg);
    }

    for (let index = 0; index < segments.length; index += 1) {
        const segmentPath = `${path}.seg[${index}]`;
        const fields = asRecord(segments[index], segmentPath);
        const id = asNumberInRange(fields.id, `${segmentPath}.id`, 0, 31);
        if (!Number.isInteger(id)) {
            throw fail(`${segmentPath}.id`, 'a whole number', fields.id);
        }
    }

    checkPlaceholders(record, path);
    return record;
};

/** Where a display keeps its placeholders, if it has any. */
/** A display's plain parts with the path to each: itself, or a `byState` one's cases. */
const plainDisplaysOf = (
    display: WledDisplay,
    path: string,
): { display: PlainDisplay, path: string }[] => {
    if (display.style !== 'byState') {
        return [{ display, path }];
    }
    const cases = display.cases.map((candidate, index) => ({
        display: candidate.display,
        path: `${path}.cases[${index}].display`,
    }));
    return [...cases, { display: display.otherwise, path: `${path}.otherwise` }];
};

const templateOf = (display: PlainDisplay, path: string): { value: unknown, path: string } | undefined => {
    if (display.style === 'text') {
        return { value: display.text, path: `${path}.text` };
    }
    if (display.style === 'custom') {
        return { value: display.payload, path: `${path}.payload` };
    }
    return undefined;
};

/**
 * `{{sensor.outside}}` has to name one of the panel's entities. Only those are
 * read, so any other id could never have a value — it would sit on the panel
 * as an empty gap, exactly as a typo'd id would, which is what this catches.
 */
const checkReferences = (display: WledDisplay, path: string, entityIds: ReadonlySet<string>): void => {
    for (const plain of plainDisplaysOf(display, path)) {
        const template = templateOf(plain.display, plain.path);
        if (template === undefined) {
            continue;
        }
        const uses = findPlaceholders(template.value, template.path);
        const stray = uses.find(use => use.entityId !== undefined && !entityIds.has(use.entityId));
        if (stray !== undefined) {
            throw new Error(
                `${stray.path} references ${stray.entityId}, which is not one of the panel's entities. `
                    + 'Add it on the Entities tab first.',
            );
        }
    }
};

/**
 * A state is compared exactly, so `'sunny '` would never match anything —
 * refused rather than trimmed, because a file that says one thing and does
 * another is the bug this validator exists to prevent.
 */
const asState = (value: unknown, path: string): string => {
    const state = asNonEmptyString(value, path);
    if (state.trim() !== state) {
        throw fail(path, 'a state without leading or trailing spaces', value);
    }
    return state;
};

const STATE_CASE_TESTS = ['is', 'above', 'below'] as const;

/**
 * A case that could never be drawn is refused, because it is a mistake that
 * would otherwise look like it worked: a state listed by an earlier case, or a
 * threshold an earlier one already covers — `above 30` after `above 20`.
 */
const parseCases = (value: unknown, path: string): StateCase[] => {
    const rawCases = asArray(value, path);
    const firstCaseFor = new Map<string, number>();
    const earlierThresholds: { test: 'above' | 'below', value: number, index: number }[] = [];

    return rawCases.map((item, index) => {
        const casePath = `${path}[${index}]`;
        const fields = asRecord(item, casePath);
        const test = asOneOf(fields.test, `${casePath}.test`, STATE_CASE_TESTS);

        if (test !== 'is') {
            const threshold = asNumberInRange(fields.value, `${casePath}.value`, -Infinity, Infinity);
            const covering = earlierThresholds.find(earlier =>
                earlier.test === test
                && (test === 'above' ? earlier.value <= threshold : earlier.value >= threshold)
            );
            if (covering !== undefined) {
                throw new Error(
                    `${casePath} is ${test} ${threshold}, which ${path}[${covering.index}] `
                        + `(${test} ${covering.value}) already draws.`,
                );
            }
            earlierThresholds.push({ test, value: threshold, index });
            const display = parsePlainDisplay(fields.display, `${casePath}.display`);
            return { test, value: threshold, display };
        }

        const rawStates = asArray(fields.states, `${casePath}.states`);
        if (rawStates.length === 0) {
            throw fail(`${casePath}.states`, 'at least one state', fields.states);
        }
        const states = rawStates.map((state, position) => {
            const parsed = asState(state, `${casePath}.states[${position}]`);
            return parsed;
        });

        for (const state of states) {
            const earlier = firstCaseFor.get(state);
            if (earlier !== undefined) {
                throw new Error(
                    `${casePath}.states lists '${state}', which ${path}[${earlier}] already draws.`,
                );
            }
            firstCaseFor.set(state, index);
        }

        const display = parsePlainDisplay(fields.display, `${casePath}.display`);
        return { test, states, display };
    });
};

const parseDisplay = (value: unknown, path: string): WledDisplay => {
    const record = asRecord(value, path);
    if (record.style !== 'byState') {
        const plain = parsePlainDisplay(record, path);
        return plain;
    }

    const cases = parseCases(record.cases, `${path}.cases`);
    const otherwise = parsePlainDisplay(record.otherwise, `${path}.otherwise`);
    return { style: 'byState', cases, otherwise };
};

const parsePlainDisplay = (value: unknown, path: string): PlainDisplay => {
    const record = asRecord(value, path);
    // Named, because the generic complaint would not say why it is refused.
    if (record.style === 'byState') {
        throw fail(`${path}.style`, 'text, bar or custom — a case cannot itself depend on the state', record.style);
    }
    const style = asOneOf(record.style, `${path}.style`, ['text', 'bar', 'custom'] as const);

    // Checked before `segmentId` and `color`, which a custom display does not
    // have: its segments and its colours are inside the body it owns.
    if (style === 'custom') {
        const payload = parseCustomPayload(record.payload, `${path}.payload`);
        return { style, payload };
    }

    const segmentId = asNumberInRange(record.segmentId, `${path}.segmentId`, 0, 31);
    const color = asColor(record.color, `${path}.color`);

    if (style === 'bar') {
        const trackColor = asColor(record.trackColor, `${path}.trackColor`);
        return { style, segmentId, color, trackColor };
    }

    const speed = asNumberInRange(record.speed, `${path}.speed`, 0, 255);
    // Not empty: a blank segment name makes Scrolling Text draw the date.
    const text = asNonEmptyString(record.text, `${path}.text`);
    checkPlaceholders(text, `${path}.text`);
    return { style, segmentId, color, speed, text };
};

const READING_KINDS = ['percent', 'temperature', 'text'] as const;

/**
 * A built-in item is a clock, so two of the three things an entity carries are
 * not open questions: it reads as text, and a `bar` cannot draw it — a bar
 * wants a number, and a text reading would leave an empty one on the panel
 * with nothing to say why.
 *
 * Both are refused here rather than merely avoided in the editor, because this
 * validator is also what a hand-edited file goes through.
 */
const refuseBarOnBuiltin = (entityId: string, display: WledDisplay, path: string): void => {
    if (!isBuiltinId(entityId)) {
        return;
    }
    for (const plain of plainDisplaysOf(display, path)) {
        if (plain.display.style === 'bar') {
            throw fail(`${plain.path}.style`, `'text' or 'custom' for ${entityId}`, 'bar');
        }
    }
};

const parseBuiltin = (
    entityId: BuiltinId,
    record: Record<string, unknown>,
    path: string,
): PanelEntity => {
    const allowed = formatsFor(entityId);
    // Checked before `asOneOf`, whose complaint about a missing value would be
    // that it is not a string — true, and no help at all in naming the choices.
    if (record.format === undefined) {
        const list = allowed.join(', ');
        throw fail(`${path}.format`, `one of ${list} for ${entityId}`, record.format);
    }
    const format = asOneOf(record.format, `${path}.format`, allowed);
    const kind = asOneOf(record.kind, `${path}.kind`, ['text'] as const);
    const display = parseDisplay(record.display, `${path}.display`);
    refuseBarOnBuiltin(entityId, display, `${path}.display`);
    return { entityId, kind, format, display };
};

const parseEntity = (value: unknown, path: string): PanelEntity => {
    const record = asRecord(value, path);
    const entityId = asNonEmptyString(record.entityId, `${path}.entityId`);

    if (isBuiltinId(entityId)) {
        const builtin = parseBuiltin(entityId, record, path);
        return builtin;
    }

    // Refused rather than ignored: a format on a Home Assistant entity would
    // be a save that quietly did nothing, which is how a typo'd id looks.
    if (record.format !== undefined) {
        throw fail(`${path}.format`, 'absent — only the built-in items take one', record.format);
    }

    const kind = asOneOf(record.kind, `${path}.kind`, READING_KINDS);
    const display = parseDisplay(record.display, `${path}.display`);
    return { entityId, kind, display };
};

const CONDITION_TESTS = [
    'isPlaying',
    'isNotPlaying',
    'isAvailable',
    'isUnavailable',
    'above',
    'below',
    'equals',
    'timeBetween',
] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const asTime = (value: unknown, path: string): string => {
    const text = asString(value, path);
    if (!TIME_PATTERN.test(text)) {
        throw fail(path, 'a 24-hour time like 07:30', value);
    }
    return text;
};

const parseTimeCondition = (record: Record<string, unknown>, path: string): Condition => {
    // Refused rather than ignored, for the same reason a stray `format` is:
    // it would read as though the window were tied to that entity.
    if (record.entityId !== undefined) {
        throw fail(`${path}.entityId`, 'absent — a time window reads the clock', record.entityId);
    }
    const from = asTime(record.from, `${path}.from`);
    const to = asTime(record.to, `${path}.to`);
    if (from === to) {
        throw fail(`${path}.to`, `different from 'from' (${from})`, to);
    }
    return { test: 'timeBetween', from, to };
};

const parseCondition = (value: unknown, path: string): Condition => {
    const record = asRecord(value, path);
    const test = asOneOf(record.test, `${path}.test`, CONDITION_TESTS);

    if (test === 'timeBetween') {
        const condition = parseTimeCondition(record, path);
        return condition;
    }

    const entityId = asNonEmptyString(record.entityId, `${path}.entityId`);

    const needsValue = test === 'above' || test === 'below' || test === 'equals';
    if (!needsValue) {
        return { entityId, test };
    }

    const raw = record.value;
    const isUsable = typeof raw === 'number' || typeof raw === 'string';
    if (!isUsable) {
        throw fail(`${path}.value`, `a number or string for the ${test} test`, raw);
    }
    return { entityId, test, value: raw };
};

const parseConditions = (value: unknown, path: string): Condition[] => {
    const rawConditions = asArray(value, path);
    return rawConditions.map((condition, index) => {
        const parsed = parseCondition(condition, `${path}[${index}]`);
        return parsed;
    });
};

/**
 * Empty conditions are refused rather than read as "always": absent already
 * says that, and two spellings of one thing is how a file drifts from what
 * the editor would have written.
 */
const parseMemberWhen = (value: unknown, path: string): MemberWhen => {
    const record = asRecord(value, path);
    const match = asOneOf(record.match, `${path}.match`, ['all', 'any'] as const);
    const conditions = parseConditions(record.conditions, `${path}.conditions`);
    if (conditions.length === 0) {
        throw fail(`${path}.conditions`, 'at least one condition — leave out when to always take a turn', record.conditions);
    }
    return { match, conditions };
};

const parseMember = (value: unknown, path: string): LoopMember => {
    const record = asRecord(value, path);
    const id = asNonEmptyString(record.id, `${path}.id`);
    const entityId = asNonEmptyString(record.entityId, `${path}.entityId`);
    const member: LoopMember = { id, entityId };
    if (record.display !== undefined) {
        member.display = parseDisplay(record.display, `${path}.display`);
    }
    if (record.when !== undefined) {
        member.when = parseMemberWhen(record.when, `${path}.when`);
    }
    return member;
};

/**
 * A display the flow sets for itself is held to what the entity's own would
 * be: no bar for a built-in, and only the panel's entities named in its
 * placeholders. Checked after the whole file is read, because both depend on
 * which entities there are.
 */
const checkFlowDisplays = (flow: readonly FlowRule[], entityIds: ReadonlySet<string>): void => {
    flow.forEach((rule, index) => {
        const path = `config.flow[${index}].action`;
        const action = rule.action;
        const targets = action.do === 'show'
            ? [{ target: action, path }]
            : action.do === 'loop'
            ? action.members.map((member, position) => ({ target: member, path: `${path}.members[${position}]` }))
            : [];

        for (const { target, path: targetPath } of targets) {
            if (target.display === undefined) {
                continue;
            }
            const displayPath = `${targetPath}.display`;
            refuseBarOnBuiltin(target.entityId, target.display, displayPath);
            checkReferences(target.display, displayPath, entityIds);
        }
    });
};

const parseAction = (value: unknown, path: string): Action => {
    const record = asRecord(value, path);
    const kind = asOneOf(record.do, `${path}.do`, ['blank', 'show', 'loop'] as const);

    if (kind === 'blank') {
        return { do: 'blank' };
    }

    if (kind === 'show') {
        const entityId = asNonEmptyString(record.entityId, `${path}.entityId`);
        if (record.display === undefined) {
            return { do: 'show', entityId };
        }
        const display = parseDisplay(record.display, `${path}.display`);
        return { do: 'show', entityId, display };
    }

    const rawMembers = asArray(record.members, `${path}.members`);
    if (rawMembers.length === 0) {
        throw fail(`${path}.members`, 'at least one member', record.members);
    }
    const members = rawMembers.map((member, index) => {
        const parsed = parseMember(member, `${path}.members[${index}]`);
        return parsed;
    });

    const ids = members.map(member => member.id);
    if (new Set(ids).size !== ids.length) {
        // The rotation's position is kept by member id, so two would share one.
        throw new Error(`${path}.members must not contain two members with the same id.`);
    }

    // The service ticks once a second, so a finer dwell could not be honoured.
    const dwellSeconds = asNumberInRange(record.dwellSeconds, `${path}.dwellSeconds`, 1, 3600);
    return { do: 'loop', members, dwellSeconds };
};

const parseRule = (value: unknown, path: string): FlowRule => {
    const record = asRecord(value, path);
    const id = asNonEmptyString(record.id, `${path}.id`);
    const match = asOneOf(record.match, `${path}.match`, ['all', 'any'] as const);
    const conditions = parseConditions(record.conditions, `${path}.conditions`);
    const action = parseAction(record.action, `${path}.action`);

    if (record.label === undefined) {
        return { id, match, conditions, action };
    }
    const label = asString(record.label, `${path}.label`);
    return { id, label, match, conditions, action };
};

export const parsePanelConfig = (value: unknown): PanelConfig => {
    const record = asRecord(value, 'config');

    if (record.version !== CONFIG_VERSION) {
        throw fail('config.version', String(CONFIG_VERSION), record.version);
    }

    const output = asRecord(record.output, 'config.output');
    const wledIp = asHost(output.wledIp, 'config.output.wledIp');
    const brightness = asNumberInRange(output.brightness, 'config.output.brightness', 0, 255);
    const timeZone = asTimeZone(output.timeZone, 'config.output.timeZone');

    const rawEntities = asArray(record.entities, 'config.entities');
    const entities = rawEntities.map((entity, index) => {
        const parsed = parseEntity(entity, `config.entities[${index}]`);
        return parsed;
    });

    const entityIds = new Set(entities.map(entity => entity.entityId));
    entities.forEach((entity, index) => {
        checkReferences(entity.display, `config.entities[${index}].display`, entityIds);
    });

    const rawFlow = asArray(record.flow, 'config.flow');
    const flow = rawFlow.map((item, index) => {
        const parsed = parseRule(item, `config.flow[${index}]`);
        return parsed;
    });

    const ids = flow.map(item => item.id);
    const unique = new Set(ids);
    if (unique.size !== ids.length) {
        // Loop positions are keyed by rule id, so duplicates would share one.
        throw new Error('config.flow must not contain two rules with the same id.');
    }

    checkFlowDisplays(flow, entityIds);

    return { version: CONFIG_VERSION, output: { wledIp, brightness, timeZone }, entities, flow };
};
