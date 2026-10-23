import { createEntityStore, EntityLookup } from './entityStore.ts';
import { IncomingMessage } from './types.ts';

/**
 * One `subscribe_entities` subscription over the Home Assistant WebSocket API,
 * kept alive across restarts of either end.
 *
 * Why this rather than polling REST: the subscription opens with a full snapshot
 * of the entities asked for and then sends only what changed, so a reconnect
 * needs no catch-up logic and a restart of this service is never left staring at
 * an empty state. The cost is the handshake below — auth, message ids, an
 * application-level ping, and a retry loop.
 */

export const ConnectionStates = {
    Connecting: 'connecting',
    Authenticating: 'authenticating',
    Subscribing: 'subscribing',
    /** Snapshot received; updates are flowing. */
    Live: 'live',
    /** Reports why the connection ended, before the retry is scheduled. */
    Disconnected: 'disconnected',
    Reconnecting: 'reconnecting',
    Stopped: 'stopped',
} as const;

export type ConnectionState = typeof ConnectionStates[keyof typeof ConnectionStates];

export type HomeAssistantSocketOptions = {
    baseUrl: string,
    token: string,
    /**
     * Read afresh on every `subscribe_entities`, so changing which entities the
     * panel uses is a `stop()` then `start()` rather than a new socket. A
     * function rather than an array because an array handed over here would
     * read as a constant while quietly being whatever the caller last mutated.
     */
    entityIds: () => readonly string[],
    onConnectionState: (state: ConnectionState, detail?: string) => void,
    onUpdate: (update: EntityUpdate) => void,
    onError: (error: unknown) => void,
};

export type EntityUpdate = {
    lookup: EntityLookup,
    /** The entity ids this event carried, so unaffected feeds can be skipped. */
    touched: string[],
    /** True for the one event that opens a subscription. */
    isSnapshot: boolean,
};

export type HomeAssistantSocket = {
    lookup: EntityLookup,
    start: () => void,
    stop: () => Promise<void>,
    /**
     * Forgets every entity, so a restart with a different set cannot keep
     * answering for one that has been taken off the panel.
     */
    clear: () => void,
};

const PING_INTERVAL_MILLISECONDS = 30_000;
const PONG_TIMEOUT_MILLISECONDS = 10_000;
const FIRST_RETRY_MILLISECONDS = 1_000;
/**
 * How long `stop()` waits for the close handshake. On a host that is not
 * reachable at all — which on macOS is what the Local Network grant looks like
 * — a connecting socket can sit there without ever closing.
 */
const CLOSE_TIMEOUT_MILLISECONDS = 2_000;
const MAX_RETRY_MILLISECONDS = 30_000;

const toSocketUrl = (baseUrl: string): string => {
    const trimmed = baseUrl.replace(/\/+$/, '');
    const isSecure = trimmed.startsWith('https://');
    const scheme = isSecure ? 'wss://' : 'ws://';
    const host = trimmed.replace(/^https?:\/\//, '');
    return `${scheme}${host}/api/websocket`;
};

/**
 * A connection that closed without Home Assistant ever speaking did not reach
 * it. On macOS that is usually Local Network Privacy rather than anything about
 * Home Assistant: the `deno` binary needs Local Network permission, and until
 * it has one every connection to the local subnet fails identically to the host
 * being switched off. See the README's "Things that bite".
 */
const describeClose = (
    closeEvent: CloseEvent,
    heardFromServer: boolean,
    socketUrl: string,
): string => {
    if (heardFromServer) {
        const reason = closeEvent.reason || 'no reason given';
        return `closed by the server: code ${closeEvent.code}, ${reason}`;
    }
    return `never reached ${socketUrl} (code ${closeEvent.code})`
        + ' — check the host is up, and on macOS that Deno has Local Network permission';
};

export const createHomeAssistantSocket = (
    { baseUrl, token, entityIds, onConnectionState, onUpdate, onError }: HomeAssistantSocketOptions,
): HomeAssistantSocket => {
    const store = createEntityStore();
    const socketUrl = toSocketUrl(baseUrl);

    let socket: WebSocket | undefined;
    let stopped = false;
    /** Message ids restart at 1 on every connection; they are per-socket. */
    let nextMessageId = 1;
    let subscriptionId: number | undefined;
    let hasSnapshot = false;
    /**
     * Whether anything at all arrived on this connection. Home Assistant speaks
     * first with `auth_required`, so a connection that closes having said
     * nothing never reached Home Assistant — which is a different fault from a
     * rejected token or a dropped subscription, and needs saying so.
     */
    let heardFromServer = false;
    let retryMilliseconds = FIRST_RETRY_MILLISECONDS;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let pongTimer: number | undefined;

    const send = (message: Record<string, unknown>): void => {
        const body = JSON.stringify(message);
        socket?.send(body);
    };

    const takeMessageId = (): number => nextMessageId++;

    const clearPongTimer = (): void => {
        if (pongTimer !== undefined) {
            clearTimeout(pongTimer);
            pongTimer = undefined;
        }
    };

    const clearTimers = (): void => {
        clearPongTimer();
        if (pingTimer !== undefined) {
            clearInterval(pingTimer);
            pingTimer = undefined;
        }
        if (retryTimer !== undefined) {
            clearTimeout(retryTimer);
            retryTimer = undefined;
        }
    };

    /**
     * A connection that has gone quiet is the failure TCP will not report: the
     * socket stays open and nothing ever arrives again. An unanswered ping is
     * the only way to notice, so a missing pong closes the socket to force the
     * retry path.
     */
    const sendPing = (): void => {
        const id = takeMessageId();
        send({ id, type: 'ping' });
        pongTimer = setTimeout(() => {
            onConnectionState(ConnectionStates.Reconnecting, 'ping went unanswered');
            socket?.close();
        }, PONG_TIMEOUT_MILLISECONDS);
    };

    const handleMessage = (message: IncomingMessage): void => {
        if (message.type === 'auth_required') {
            onConnectionState(ConnectionStates.Authenticating, message.ha_version);
            send({ type: 'auth', access_token: token });
            return;
        }

        if (message.type === 'auth_invalid') {
            // Retrying a rejected token only loops, so this one failure is fatal.
            stopped = true;
            const reason = message.message ?? 'token rejected';
            const error = new Error(`Home Assistant rejected HA_TOKEN: ${reason}`);
            onError(error);
            socket?.close();
            return;
        }

        if (message.type === 'auth_ok') {
            const wanted = entityIds();
            pingTimer = setInterval(sendPing, PING_INTERVAL_MILLISECONDS);

            /**
             * A panel of nothing but built-in items wants no subscription at
             * all, and an empty `entity_ids` is not the way to ask for one:
             * Home Assistant reads a missing or empty filter as *every*
             * entity, which would be a flood of state this service has no use
             * for. The empty snapshot is still sent, because it is what tells
             * the bridge it may start deciding.
             */
            if (wanted.length === 0) {
                hasSnapshot = true;
                retryMilliseconds = FIRST_RETRY_MILLISECONDS;
                onConnectionState(ConnectionStates.Live, 'no Home Assistant entities on the panel');
                onUpdate({ lookup: store.lookup, touched: [], isSnapshot: true });
                return;
            }

            const id = takeMessageId();
            subscriptionId = id;
            onConnectionState(ConnectionStates.Subscribing, `${wanted.length} entities`);
            send({ id, type: 'subscribe_entities', entity_ids: [...wanted] });
            return;
        }

        if (message.type === 'pong') {
            clearPongTimer();
            return;
        }

        if (message.id !== subscriptionId) {
            return;
        }

        if (message.type === 'result') {
            if (!message.success) {
                const reason = message.error?.message ?? 'unknown error';
                const error = new Error(`subscribe_entities was refused: ${reason}`);
                onError(error);
            }
            return;
        }

        if (message.type === 'event' && message.event) {
            const touched = store.apply(message.event);
            const isSnapshot = !hasSnapshot;
            if (isSnapshot) {
                hasSnapshot = true;
                retryMilliseconds = FIRST_RETRY_MILLISECONDS;
                const found = touched.length;
                onConnectionState(ConnectionStates.Live, `snapshot of ${found} entities`);
            }
            onUpdate({ lookup: store.lookup, touched, isSnapshot });
        }
    };

    const scheduleReconnect = (): void => {
        const seconds = Math.round(retryMilliseconds / 1000);
        onConnectionState(ConnectionStates.Reconnecting, `retrying in ${seconds}s`);
        retryTimer = setTimeout(connect, retryMilliseconds);
        retryMilliseconds = Math.min(MAX_RETRY_MILLISECONDS, retryMilliseconds * 2);
    };

    const connect = (): void => {
        if (stopped) {
            return;
        }

        // The next subscription opens with its own snapshot, so anything kept
        // from the dropped connection would only be a chance to serve stale state.
        store.clear();
        hasSnapshot = false;
        heardFromServer = false;
        subscriptionId = undefined;
        nextMessageId = 1;
        onConnectionState(ConnectionStates.Connecting, socketUrl);

        const nextSocket = new WebSocket(socketUrl);
        socket = nextSocket;

        nextSocket.onmessage = rawEvent => {
            heardFromServer = true;
            const body = rawEvent.data as string;
            let message: IncomingMessage;
            try {
                message = JSON.parse(body) as IncomingMessage;
            } catch (error) {
                onError(error);
                return;
            }
            handleMessage(message);
        };

        nextSocket.onclose = closeEvent => {
            clearTimers();
            socket = undefined;
            if (stopped) {
                onConnectionState(ConnectionStates.Stopped);
                return;
            }
            const cause = describeClose(closeEvent, heardFromServer, socketUrl);
            onConnectionState(ConnectionStates.Disconnected, cause);
            scheduleReconnect();
        };

        // Deno's error event carries no detail of its own; `onclose` always
        // follows it with the code, and that is where the cause is reported.
        nextSocket.onerror = () => {};
    };

    return {
        lookup: store.lookup,

        start: () => {
            stopped = false;
            connect();
        },

        clear: () => {
            store.clear();
            hasSnapshot = false;
        },

        stop: async () => {
            stopped = true;
            clearTimers();
            const closing = socket;
            socket = undefined;
            if (!closing) {
                onConnectionState(ConnectionStates.Stopped);
                return;
            }
            /**
             * Awaiting the close handshake keeps Deno from reporting the socket
             * as a leaked resource when the process exits straight afterwards —
             * but a socket still connecting to an unreachable host may never
             * close, and this is awaited from an HTTP handler, so it is bounded.
             */
            const closed = new Promise<void>(resolve => {
                closing.onclose = () => resolve();
            });
            let closeTimer: number | undefined;
            const timedOut = new Promise<void>(resolve => {
                closeTimer = setTimeout(resolve, CLOSE_TIMEOUT_MILLISECONDS);
            });
            closing.close();
            await Promise.race([closed, timedOut]);
            // Cleared whichever won, or the timer outlives the socket.
            clearTimeout(closeTimer);
            onConnectionState(ConnectionStates.Stopped);
        },
    };
};
