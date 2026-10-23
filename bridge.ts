import { defaultFormatFor, isBuiltinId } from './builtins.ts';
import { Config } from './config.ts';
import { displaysInFlow, LoopState } from './flow.ts';
import { EntityLookup } from './homeAssistant/entityStore.ts';
import { ConnectionState, ConnectionStates, createHomeAssistantSocket } from './homeAssistant/socket.ts';
import { PanelConfig } from './panelConfig.ts';
import { readBuiltin, Reading, readEntity } from './readings.ts';
import { createMockSource, Source, SourceOptions } from './source.ts';
import { createWledTarget, toWledPayload, WledPayload, WledTarget } from './wled.ts';
import { Decision, decidePanel } from './whatToShow.ts';

/**
 * The daemon: a source of entity states, a parse per entity, one decision, one
 * POST. Held behind an object so the HTTP server can read what it is doing and
 * hand it a new configuration without either of them owning the other.
 */

const TICK_MILLISECONDS = 1_000;

export type BridgeOptions = {
    config: Config,
    panel: PanelConfig,
    onLog: (label: string, detail: string) => void,
};

/** Everything the UI needs to show what the panel is doing right now. */
export type BridgeSnapshot = {
    connection: ConnectionState,
    decision: Decision | undefined,
    readings: Record<string, Reading>,
    lastPayload: WledPayload | undefined,
    /** Which loop rule is on which member, keyed by rule id. */
    loops: Record<string, LoopState>,
    /** The rule that decided, so the flow editor can highlight it. */
    matchedRuleId: string | undefined,
};

export type Bridge = {
    start: () => void,
    stop: () => Promise<void>,
    snapshot: () => BridgeSnapshot,
    /** Applies a saved configuration to the running service. */
    reload: (panel: PanelConfig) => void,
};

/**
 * A display set in the flow is named, so that the same entity shown two ways
 * in one rotation logs as two different things rather than as a repeat.
 */
const describe = (decision: Decision): string => {
    if (decision.show === 'nothing') {
        return `off — ${decision.reason}`;
    }
    return decision.display === undefined ? decision.entityId : `${decision.entityId} (own view)`;
};

/**
 * The Home Assistant ids only. Built-in items come from the clock here, so
 * subscribing to them would ask Home Assistant for entities that do not exist
 * — which it accepts silently — and adding a clock would cost a resubscribe
 * for nothing.
 */
const subscribedIds = (panel: PanelConfig): string[] =>
    panel.entities
        .filter(entity => !isBuiltinId(entity.entityId))
        .map(entity => entity.entityId);

const entityIdSet = (panel: PanelConfig): Set<string> => new Set(subscribedIds(panel));

export const createBridge = (options: BridgeOptions): Bridge => {
    const { config, onLog } = options;

    let panel = options.panel;
    let lookup: EntityLookup = () => undefined;
    let lastDescription: string | undefined;
    let connection: ConnectionState = ConnectionStates.Stopped;
    let lastDecision: Decision | undefined;
    let lastReadings: Map<string, Reading> = new Map();
    let lastPayload: WledPayload | undefined;
    let loops: ReadonlyMap<string, LoopState> = new Map();
    let matchedRuleId: string | undefined;
    let tick: number | undefined;
    /**
     * Until the first snapshot lands, `lookup` knows nothing — so deciding
     * would read every entity as unavailable and blank the panel. That matters
     * most right after a resubscribe, when the panel is already showing
     * something perfectly good.
     */
    let hasSnapshot = false;

    const logError = (error: unknown): void => {
        const detail = error instanceof Error ? error.message : String(error);
        onLog('error', detail);
    };

    /**
     * Rebuilt whenever the configuration changes, which also discards the
     * "same body as last time" check inside it. That is wanted: after a
     * display edit the decision may be unchanged while the payload is not, and
     * a deduplicated send would look like the edit had done nothing.
     */
    const createTarget = (): WledTarget => {
        const ip = panel.output.wledIp;
        return createWledTarget({
            ip,
            onSend: (body, posted) => {
                const where = posted ? `POST ${ip}` : 'dry run';
                onLog(where, body);
            },
        });
    };

    let target = createTarget();

    const readAll = (): { readings: Map<string, Reading>, states: Map<string, string> } => {
        const readings = new Map<string, Reading>();
        const states = new Map<string, string>();
        const now = new Date();

        for (const entity of panel.entities) {
            if (isBuiltinId(entity.entityId)) {
                /**
                 * The format is required by the validator, so the fallback is
                 * only reachable from a `PanelConfig` built in code. The raw
                 * state is the rendered string, which is what an `equals`
                 * condition on a clock compares against.
                 */
                const format = entity.format ?? defaultFormatFor(entity.entityId);
                const reading = readBuiltin(format, now);
                readings.set(entity.entityId, reading);
                states.set(entity.entityId, reading.kind === 'text' ? reading.candidates[0] : '');
                continue;
            }

            const state = lookup(entity.entityId);
            const reading = readEntity(state, entity.kind);
            readings.set(entity.entityId, reading);
            states.set(entity.entityId, state?.state ?? '');
        }
        return { readings, states };
    };

    /**
     * The tick and the source updates both end here, and both decide what to
     * send by comparing against what was sent last. Running them one at a time
     * is what makes that comparison true.
     */
    let queue = Promise.resolve();

    const refresh = async (): Promise<void> => {
        if (!hasSnapshot) {
            return;
        }

        const { readings, states } = readAll();
        const outcome = decidePanel({
            flow: panel.flow,
            readings,
            states,
            atMilliseconds: Date.now(),
            loops,
        });
        const decision = outcome.decision;

        /**
         * Committed before the send, not after: a throw from `toWledPayload`
         * or a WLED that cannot be reached would otherwise rewind the
         * rotation, and the queue's `catch` would hide it — leaving the panel
         * stuck on one entity for as long as the device is away.
         */
        loops = outcome.loops;
        matchedRuleId = outcome.matchedRuleId;
        lastReadings = readings;
        lastDecision = decision;

        const description = describe(decision);
        if (description !== lastDescription) {
            lastDescription = description;
            onLog('show', description);
        }

        const payload = toWledPayload({
            decision,
            entities: panel.entities,
            flowDisplays: displaysInFlow(panel.flow),
            readings,
            states,
            brightness: panel.output.brightness,
        });
        lastPayload = payload;
        await target.send(payload);
    };

    const enqueueRefresh = (): void => {
        queue = queue.then(refresh).catch(logError);
    };

    const sourceOptions: SourceOptions = {
        entityIds: () => subscribedIds(panel),
        onConnectionState: (state, detail) => {
            connection = state;
            onLog(state, detail ?? '');
        },
        onUpdate: update => {
            lookup = update.lookup;
            if (update.isSnapshot) {
                hasSnapshot = true;
            }
            enqueueRefresh();
        },
        onError: logError,
    };

    const source: Source = config.homeAssistant.token
        ? createHomeAssistantSocket({
            ...sourceOptions,
            baseUrl: config.homeAssistant.baseUrl,
            token: config.homeAssistant.token,
        })
        : createMockSource({
            ...sourceOptions,
            stepSeconds: config.mockStepSeconds,
            onNote: note => onLog('mock', note),
        });

    return {
        start: () => {
            source.start();
            // Rotation is time-based, so it needs a clock of its own rather
            // than waiting for an entity to change.
            tick = setInterval(enqueueRefresh, TICK_MILLISECONDS);
        },

        stop: async () => {
            if (tick !== undefined) {
                clearInterval(tick);
                tick = undefined;
            }
            await source.stop();
        },

        snapshot: () => ({
            connection,
            decision: lastDecision,
            readings: Object.fromEntries(lastReadings),
            lastPayload,
            loops: Object.fromEntries(loops),
            matchedRuleId,
        }),

        reload: next => {
            const before = entityIdSet(panel);
            panel = next;
            target = createTarget();
            // `loops` is left alone on purpose, so editing a colour does not
            // send the rotation back to its first entity.
            onLog('config', `${panel.entities.length} entities, ${panel.flow.length} flow rules`);

            const after = entityIdSet(panel);
            const sameEntities = before.size === after.size
                && [...after].every(entityId => before.has(entityId));
            if (sameEntities) {
                enqueueRefresh();
                return;
            }

            /**
             * The subscription carries a fixed list of entity ids, so a
             * different set means resubscribing. The reconnect is cheap because
             * a fresh `subscribe_entities` opens with a full snapshot — so
             * reconnecting *is* the catch-up — but it is deliberately not
             * awaited here: `stop()` can take seconds against an unreachable
             * host, and this is called from an HTTP handler.
             */
            hasSnapshot = false;
            queue = queue.then(async () => {
                await source.stop();
                source.clear();
                source.start();
            }).catch(logError);
        },
    };
};
