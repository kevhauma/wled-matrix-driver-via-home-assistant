import { CompressedStateEvent } from '../homeAssistant/types.ts';

/**
 * A server that speaks enough of the Home Assistant WebSocket handshake to run
 * this service against: `auth_required`, `auth_ok`, `subscribe_entities` with a
 * snapshot, and `pong`. Shared by `deno task demo` and the socket test, so the
 * thing the tests drive is the thing the demo shows.
 */

export type FakeHomeAssistantOptions = {
    snapshot: CompressedStateEvent,
    /** Any other token is rejected, which exercises the `auth_invalid` path. */
    expectedToken: string,
};

export type FakeHomeAssistant = {
    baseUrl: string,
    /** Resolves once a client has subscribed and been sent the snapshot. */
    subscribed: Promise<void>,
    /** Pushes a compressed state event down the live subscription. */
    push: (event: CompressedStateEvent) => void,
    /** Drops the connection but keeps listening, as a restarted HA would. */
    dropConnection: () => void,
    /** Replaces the snapshot the next subscription will open with. */
    setSnapshot: (snapshot: CompressedStateEvent) => void,
    close: () => Promise<void>,
};

/**
 * Home Assistant stamps every diff it sends: `lc` when the state string moved
 * (and `lu` then equals it), `lu` alone when only attributes moved. Applying
 * that here rather than in each fixture keeps a hand-written push from quietly
 * misrepresenting the protocol — a diff with no timestamps would leave the
 * entity looking like it had not changed for as long as it had been running,
 * which is exactly what the media feed sorts on.
 */
const stampDiffs = (event: CompressedStateEvent): CompressedStateEvent => {
    if (!event.c) {
        return event;
    }

    const seconds = Date.now() / 1000;
    const stamped: NonNullable<CompressedStateEvent['c']> = {};

    for (const [entityId, diff] of Object.entries(event.c)) {
        const additions = diff['+'];
        if (!additions || additions.lc !== undefined || additions.lu !== undefined) {
            stamped[entityId] = diff;
            continue;
        }
        const isStateChange = additions.s !== undefined;
        const timestamp = isStateChange ? { lc: seconds } : { lu: seconds };
        stamped[entityId] = { ...diff, '+': { ...additions, ...timestamp } };
    }

    return { ...event, c: stamped };
};

export const startFakeHomeAssistant = (
    { snapshot, expectedToken }: FakeHomeAssistantOptions,
): FakeHomeAssistant => {
    let liveSocket: WebSocket | undefined;
    let liveSubscriptionId: number | undefined;
    let currentSnapshot = snapshot;
    let announceSubscribed: () => void = () => {};
    const subscribed = new Promise<void>(resolve => {
        announceSubscribed = resolve;
    });

    const send = (socket: WebSocket, message: Record<string, unknown>): void => {
        const body = JSON.stringify(message);
        socket.send(body);
    };

    const handler = (request: Request): Response => {
        const upgrade = Deno.upgradeWebSocket(request);
        const socket = upgrade.socket;

        socket.onopen = () => {
            send(socket, { type: 'auth_required', ha_version: '2025.10.1' });
        };

        socket.onmessage = event => {
            const body = event.data as string;
            const message = JSON.parse(body) as { type: string, id?: number, access_token?: string };

            if (message.type === 'auth') {
                const isValid = message.access_token === expectedToken;
                const reply = isValid
                    ? { type: 'auth_ok', ha_version: '2025.10.1' }
                    : { type: 'auth_invalid', message: 'Invalid access token or password' };
                send(socket, reply);
                return;
            }

            if (message.type === 'subscribe_entities') {
                liveSocket = socket;
                liveSubscriptionId = message.id;
                send(socket, { id: message.id, type: 'result', success: true, result: null });
                send(socket, { id: message.id, type: 'event', event: currentSnapshot });
                announceSubscribed();
                return;
            }

            if (message.type === 'ping') {
                send(socket, { id: message.id, type: 'pong' });
            }
        };

        return upgrade.response;
    };

    const server = Deno.serve({ port: 0, onListen: () => {} }, handler);
    const address = server.addr as Deno.NetAddr;

    return {
        baseUrl: `http://127.0.0.1:${address.port}`,
        subscribed,

        push: event => {
            if (!liveSocket || liveSubscriptionId === undefined) {
                throw new Error('nothing has subscribed yet');
            }
            const stamped = stampDiffs(event);
            send(liveSocket, { id: liveSubscriptionId, type: 'event', event: stamped });
        },

        dropConnection: () => {
            liveSocket?.close();
            liveSocket = undefined;
            liveSubscriptionId = undefined;
        },

        setSnapshot: next => {
            currentSnapshot = next;
        },

        close: async () => {
            liveSocket?.close();
            await server.shutdown();
        },
    };
};
