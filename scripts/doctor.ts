/**
 * Says which step of the connection fails, because a reconnect loop on its own
 * does not: reachability, the token over REST, the WebSocket upgrade, auth, and
 * then the subscription.
 *
 * Prints no token and no entity values — only the step, the status and, when a
 * socket closes, the close code and reason that `main.ts` would otherwise
 * swallow.
 */

const rawBaseUrl = Deno.env.get('HA_BASE_URL')?.trim() ?? '';
const token = Deno.env.get('HA_TOKEN')?.trim() ?? '';

if (!rawBaseUrl || !token) {
    console.error('Set HA_BASE_URL and HA_TOKEN (see .env.example).');
    Deno.exit(1);
}

const hasScheme = /^https?:\/\//.test(rawBaseUrl);
const withScheme = hasScheme ? rawBaseUrl : `http://${rawBaseUrl}`;
const baseUrl = withScheme.replace(/\/+$/, '');
const socketUrl = `${baseUrl.replace(/^http/, 'ws')}/api/websocket`;

console.log(`HA_BASE_URL as given : ${rawBaseUrl}`);
if (!hasScheme) {
    console.log('                       (no scheme; assuming http://)');
}
console.log(`REST base            : ${baseUrl}`);
console.log(`WebSocket            : ${socketUrl}`);
console.log(`HA_TOKEN             : ${token.length} characters\n`);

const describeError = (error: unknown): string =>
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);

console.log('1. REST /api/ with the token');
try {
    const response = await fetch(`${baseUrl}/api/`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const body = await response.text();
    const summary = body.slice(0, 100).replace(/\s+/g, ' ');
    console.log(`   -> ${response.status} ${response.statusText} ${summary}`);
    if (response.status === 401) {
        console.log('   -> the token is the problem, not the socket.');
    }
} catch (error) {
    console.log(`   -> failed: ${describeError(error)}`);
    console.log('   -> Home Assistant is not reachable at that address at all.');
}

console.log('\n2. WebSocket handshake');

const socket = new WebSocket(socketUrl);
let messageId = 0;
let subscriptionId: number | undefined;

const send = (message: Record<string, unknown>): void => {
    const body = JSON.stringify(message);
    socket.send(body);
};

const finished = new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
        console.log('   -> timed out after 10s with the socket still open.');
        socket.close();
        resolve();
    }, 10_000);

    socket.onopen = () => {
        console.log('   -> socket open, waiting for auth_required');
    };

    socket.onmessage = event => {
        const body = event.data as string;
        const message = JSON.parse(body) as {
            type: string,
            id?: number,
            ha_version?: string,
            success?: boolean,
            message?: string,
            error?: { message?: string },
        };

        if (message.type === 'auth_required') {
            console.log(`   -> auth_required (Home Assistant ${message.ha_version})`);
            send({ type: 'auth', access_token: token });
            return;
        }

        if (message.type === 'auth_invalid') {
            console.log(`   -> auth_invalid: ${message.message ?? 'no reason given'}`);
            console.log('   -> create a fresh long-lived access token.');
            clearTimeout(timeout);
            socket.close();
            resolve();
            return;
        }

        if (message.type === 'auth_ok') {
            console.log('   -> auth_ok');
            messageId++;
            subscriptionId = messageId;
            send({ id: subscriptionId, type: 'subscribe_entities', entity_ids: [] });
            return;
        }

        if (message.type === 'result' && message.id === subscriptionId) {
            const reason = message.error?.message ?? '';
            console.log(`   -> subscribe_entities result: success=${message.success} ${reason}`);
            return;
        }

        if (message.type === 'event' && message.id === subscriptionId) {
            console.log('   -> snapshot event received. The connection works.');
            clearTimeout(timeout);
            socket.close();
            resolve();
            return;
        }

        console.log(`   -> ${message.type}`);
    };

    socket.onerror = () => {
        // Deno's error event carries no detail; `onclose` has the code.
        console.log('   -> socket error');
    };

    socket.onclose = closeEvent => {
        const reason = closeEvent.reason || '(no reason given)';
        console.log(`   -> closed: code ${closeEvent.code} ${reason}`);
        clearTimeout(timeout);
        resolve();
    };
});

await finished;
