import { Bridge } from './bridge.ts';
import { describeBuiltins, toWallClock } from './builtins.ts';
import { Config } from './config.ts';
import { savePanelConfig } from './configStore.ts';
import { upgradePanelConfig } from './configUpgrade.ts';
import { fetchEntityStates, RestEntityState } from './homeAssistant/states.ts';
import {
    builtinItems,
    LibraryItem,
    selectLibrary,
    toFilters,
    toLibraryItem,
    toLimit,
} from './library.ts';
import { WledDisplay } from './entities.ts';
import { displaysInFlow } from './flow.ts';
import { PanelConfig, parsePanelConfig } from './panelConfig.ts';
import { toPreview } from './preview.ts';
import { MOCK_ENTITY_IDS } from './source.ts';

/**
 * The editor's back end: static files out of `public/`, and a handful of JSON
 * endpoints under `/api/`.
 *
 * Bound to loopback deliberately. `PUT /api/config` is unauthenticated, and
 * this runs on a network that by construction has a WLED device and a Home
 * Assistant instance on it.
 */

const PUBLIC_DIRECTORY = new URL('./public/', import.meta.url);

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
};

class RequestError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

const jsonResponse = (body: unknown, status = 200): Response => {
    const text = JSON.stringify(body);
    return new Response(text, { status, headers: { 'content-type': 'application/json' } });
};

const serveStatic = async (pathname: string): Promise<Response> => {
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const fileUrl = new URL(relativePath, PUBLIC_DIRECTORY);

    // Anything that resolved outside public/ was a traversal attempt. `new URL`
    // has already collapsed any `..`, so comparing the resolved prefix is enough.
    if (!fileUrl.href.startsWith(PUBLIC_DIRECTORY.href)) {
        return new Response('Not found', { status: 404 });
    }

    try {
        const file = await Deno.readFile(fileUrl);
        const extension = relativePath.slice(relativePath.lastIndexOf('.'));
        const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
        return new Response(file, { headers: { 'content-type': contentType } });
    } catch {
        return new Response('Not found', { status: 404 });
    }
};

const readBody = async (request: Request): Promise<unknown> => {
    try {
        const body = await request.json();
        return body;
    } catch {
        throw new RequestError(400, 'The request body was not valid JSON.');
    }
};

export type ServerOptions = {
    bridge: Bridge,
    config: Config,
    panel: () => PanelConfig,
    onSaved: (panel: PanelConfig) => void,
    onLog: (label: string, detail: string) => void,
};

/**
 * With no token there is nothing to list, and the point of this project is
 * that it runs with nothing configured — so the picker offers the mock
 * source's own entities instead of an empty list.
 */
const mockLibrary = (): LibraryItem[] =>
    MOCK_ENTITY_IDS.map(entityId => ({
        entityId,
        state: 'mock',
        friendlyName: 'mock entity',
        deviceClass: '',
        unit: '',
        source: 'homeAssistant' as const,
    }));

/**
 * Which display in the flow the editor is previewing: a `show` rule's, or one
 * loop member's. Named by id rather than sent as a display, so the one
 * previewed is the one the validator has just checked as part of the draft.
 */
const findFlowDisplay = (panel: PanelConfig, target: unknown): WledDisplay | undefined => {
    if (typeof target !== 'object' || target === null) {
        return undefined;
    }
    const { ruleId, memberId } = target as Record<string, unknown>;
    const rule = panel.flow.find(candidate => candidate.id === ruleId);
    if (rule === undefined) {
        throw new RequestError(400, `There is no rule '${String(ruleId)}' in the draft.`);
    }
    const action = rule.action;
    if (action.do === 'show') {
        return action.display;
    }
    if (action.do === 'loop') {
        const member = action.members.find(candidate => candidate.id === memberId);
        return member?.display;
    }
    return undefined;
};

/**
 * The picker searches as you type, and on an installation with a few thousand
 * entities each of those searches would otherwise be a fresh `/api/states` —
 * megabytes of JSON, fetched again for every word. Cached for long enough to
 * cover a burst of typing and short enough that the state column is not
 * visibly wrong.
 */
const LIBRARY_CACHE_MILLISECONDS = 10_000;

export const startServer = (
    { bridge, config, panel, onSaved, onLog }: ServerOptions,
): Deno.HttpServer => {
    const saveConfig = async (request: Request): Promise<Response> => {
        const body = await readBody(request);

        let validated: PanelConfig;
        try {
            validated = parsePanelConfig(body);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RequestError(400, detail);
        }

        const saved = await savePanelConfig(validated);
        onSaved(saved);
        bridge.reload(saved);
        return jsonResponse(saved);
    };

    let cached: { at: number, states: RestEntityState[] } | undefined;

    const entityStates = async (): Promise<RestEntityState[]> => {
        const { baseUrl, token } = config.homeAssistant;
        const fresh = cached !== undefined
            && Date.now() - cached.at < LIBRARY_CACHE_MILLISECONDS;
        if (cached !== undefined && fresh) {
            return cached.states;
        }

        try {
            const states = await fetchEntityStates(baseUrl, token);
            cached = { at: Date.now(), states };
            return states;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RequestError(502, detail);
        }
    };

    const listLibrary = async (url: URL): Promise<Response> => {
        const filters = toFilters(url.searchParams.get('q') ?? '');
        const limit = toLimit(url.searchParams.get('limit'));
        const builtins = builtinItems(toWallClock(new Date(), panel().output.timeZone));

        const { token } = config.homeAssistant;
        if (!token) {
            const items = [...builtins, ...mockLibrary()];
            const page = selectLibrary({ items, filters, limit });
            return jsonResponse({ source: 'mock', ...page });
        }

        const states = await entityStates();
        const items = [...builtins, ...states.map(toLibraryItem)];
        const page = selectLibrary({ items, filters, limit });
        return jsonResponse({ source: 'homeAssistant', ...page });
    };

    const describePreview = async (request: Request): Promise<Response> => {
        const body = await readBody(request);
        const record = body as Record<string, unknown>;

        const entityId = typeof record.entityId === 'string' ? record.entityId : '';
        if (entityId === '') {
            throw new RequestError(400, 'entityId is required.');
        }
        const sampleValue = typeof record.sampleValue === 'string' ? record.sampleValue : '';
        const unit = typeof record.unit === 'string' ? record.unit : '';
        const sampleArtist = typeof record.sampleArtist === 'string' ? record.sampleArtist : '';

        /**
         * Previewing against the draft the editor is holding, not the saved
         * config, is the whole point — you need to see an edit before saving it.
         */
        /**
         * A 400, not a thrown error: the editor previews keystroke by
         * keystroke, so a draft the validator refuses is the normal case, and
         * it does not belong in the service's log as a failure.
         */
        const current = panel();
        let draft: PanelConfig;
        try {
            draft = parsePanelConfig({
                ...current,
                entities: record.entities ?? current.entities,
                flow: record.flow ?? current.flow,
                textSettings: record.textSettings ?? current.textSettings,
            });
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RequestError(400, detail);
        }
        const display = findFlowDisplay(draft, record.target);

        try {
            const preview = toPreview({
                entities: draft.entities,
                flowDisplays: displaysInFlow(draft.flow),
                entityId,
                display,
                sampleValue,
                unit,
                sampleArtist,
                brightness: draft.output.brightness,
                textSettings: draft.textSettings,
                timeZone: draft.output.timeZone,
                liveReadings: new Map(Object.entries(bridge.snapshot().readings)),
            });
            return jsonResponse(preview);
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new RequestError(400, detail);
        }
    };

    const handleApi = async (request: Request, url: URL): Promise<Response> => {
        if (url.pathname === '/api/config' && request.method === 'GET') {
            const current = panel();
            return jsonResponse(current);
        }

        if (url.pathname === '/api/config' && request.method === 'PUT') {
            const response = await saveConfig(request);
            return response;
        }

        /**
         * An imported file, upgraded and checked but not saved: it becomes the
         * editor's draft, and Save is what applies it. Upgraded here because
         * `PUT /api/config` takes only the current version, and a file
         * exported before an upgrade is still one worth importing.
         */
        if (url.pathname === '/api/config/import' && request.method === 'POST') {
            const body = await readBody(request);
            try {
                const { config: upgraded } = upgradePanelConfig(body);
                const imported = parsePanelConfig(upgraded);
                return jsonResponse(imported);
            } catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                throw new RequestError(400, detail);
            }
        }

        if (url.pathname === '/api/state' && request.method === 'GET') {
            const state = bridge.snapshot();
            return jsonResponse(state);
        }

        if (url.pathname === '/api/library' && request.method === 'GET') {
            const response = await listLibrary(url);
            return response;
        }

        /**
         * The built-in items and their formats, with an example of each as it
         * reads right now. Served rather than repeated in the browser code, so
         * the editor's list of formats cannot drift from `builtins.ts`.
         */
        if (url.pathname === '/api/builtins' && request.method === 'GET') {
            const described = describeBuiltins(toWallClock(new Date(), panel().output.timeZone));
            return jsonResponse({ items: described });
        }

        if (url.pathname === '/api/preview' && request.method === 'POST') {
            const response = await describePreview(request);
            return response;
        }

        throw new RequestError(404, `No such endpoint: ${request.method} ${url.pathname}`);
    };

    const handle = async (request: Request): Promise<Response> => {
        const url = new URL(request.url);

        if (!url.pathname.startsWith('/api/')) {
            const response = await serveStatic(url.pathname);
            return response;
        }

        try {
            const response = await handleApi(request, url);
            return response;
        } catch (error) {
            if (error instanceof RequestError) {
                return jsonResponse({ error: error.message }, error.status);
            }
            const message = error instanceof Error ? error.message : String(error);
            onLog('error', message);
            return jsonResponse({ error: message }, 500);
        }
    };

    return Deno.serve({ port: config.port, hostname: '0.0.0.0', onListen: () => {} }, handle);
};
