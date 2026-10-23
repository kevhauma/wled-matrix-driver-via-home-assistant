import { putJson, requestJson } from '/api.js';
import { renderEntities } from '/entities.js';
import { markMatchedRule, renderFlow } from '/flowEditor.js';
import { renderDisplay } from '/displayEditor.js';

/**
 * The shell: loads the configuration, holds the draft the three tabs edit, and
 * saves it back in one piece.
 *
 * Saving is explicit on purpose. The running service applies whatever it is
 * given immediately, so a half-written rule would otherwise become the panel's
 * behaviour while you were still typing it.
 */

const STATE_POLL_MILLISECONDS = 1000;

const element = id => document.getElementById(id);

const dom = {
    panel: element('panel'),
    status: element('status'),
    save: element('save'),
    dirty: element('dirty'),
    connection: element('connection'),
    showing: element('showing'),
};

const state = {
    tab: 'entities',
    /** The draft being edited. */
    config: null,
    /** The last saved form, as JSON, which is the whole of the dirty check. */
    savedJson: '',
    /**
     * The built-in items and their formats, from `/api/builtins`. Loaded once
     * at boot because three tabs need to know synchronously whether an id is
     * one of them: it changes what can be asked about it.
     */
    builtins: [],
    selectedEntityId: null,
    live: null,
};

export const setStatus = (message, kind = '') => {
    dom.status.textContent = message;
    dom.status.className = kind === '' ? 'status' : `status ${kind}`;
};

const isDirty = () => JSON.stringify(state.config) !== state.savedJson;

const applyDirty = () => {
    const dirty = isDirty();
    dom.dirty.hidden = !dirty;
    dom.save.disabled = !dirty;
};

/** Every edit goes through here, so nothing can change the draft unnoticed. */
const changed = () => {
    applyDirty();
    render();
};

/**
 * An edit whose consequences the caller is drawing itself. The re-render in
 * `changed` replaces the whole tab, which takes the caret with it — fine for a
 * slider, fatal for a textarea you are typing JSON into.
 */
const edited = () => {
    applyDirty();
};

const context = () => ({
    config: state.config,
    live: state.live,
    builtins: state.builtins,
    isBuiltin: entityId => state.builtins.some(item => item.entityId === entityId),
    selectedEntityId: state.selectedEntityId,
    changed,
    edited,
    setStatus,
    selectEntity: entityId => {
        state.selectedEntityId = entityId;
        render();
    },
    showTab: name => {
        setTab(name);
    },
});

const RENDERERS = {
    entities: renderEntities,
    flow: renderFlow,
    display: renderDisplay,
};

const render = () => {
    if (state.config === null) {
        return;
    }
    dom.panel.replaceChildren();
    const draw = RENDERERS[state.tab];
    draw(dom.panel, context());
};

const setTab = name => {
    state.tab = name;
    for (const button of document.querySelectorAll('.tabs button')) {
        const selected = button.dataset.tab === name;
        button.setAttribute('aria-selected', String(selected));
    }
    render();
};

const describeDecision = live => {
    if (!live || !live.decision) {
        return '—';
    }
    if (live.decision.show === 'nothing') {
        return `off — ${live.decision.reason}`;
    }
    return live.decision.entityId;
};

const CONNECTION_CLASSES = {
    live: 'badge live-on',
    connecting: 'badge',
    reconnecting: 'badge live-off',
    disconnected: 'badge live-off',
    stopped: 'badge live-off',
};

const applyLive = live => {
    state.live = live;
    const connection = live.connection ?? 'unknown';
    dom.connection.textContent = connection;
    dom.connection.className = CONNECTION_CLASSES[connection] ?? 'badge';
    dom.showing.textContent = describeDecision(live);

    /**
     * The flow tab marks the rule that is currently matching. It moves that
     * mark itself rather than being re-rendered: a rebuild once a second would
     * take the caret out of a label being typed and shut an open picker.
     */
    if (state.tab === 'flow') {
        markMatchedRule(live.matchedRuleId);
    }
};

const pollState = async () => {
    try {
        const live = await requestJson('/api/state');
        applyLive(live);
    } catch {
        dom.connection.textContent = 'no service';
        dom.connection.className = 'badge live-off';
    }
};

const save = async () => {
    dom.save.disabled = true;
    try {
        const saved = await putJson('/api/config', state.config);
        state.config = saved;
        state.savedJson = JSON.stringify(saved);
        setStatus('Saved, and the panel is using it now.', 'success');
    } catch (error) {
        setStatus(error.message, 'error');
    }
    applyDirty();
    render();
};

const load = async () => {
    try {
        const config = await requestJson('/api/config');
        const builtins = await requestJson('/api/builtins');
        state.builtins = builtins.items;
        state.config = config;
        state.savedJson = JSON.stringify(config);
        const first = config.entities[0];
        state.selectedEntityId = first === undefined ? null : first.entityId;
        applyDirty();
        setTab(state.tab);
    } catch (error) {
        setStatus(error.message, 'error');
    }
};

dom.save.addEventListener('click', () => void save());

for (const button of document.querySelectorAll('.tabs button')) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
}

addEventListener('beforeunload', event => {
    if (!isDirty()) {
        return;
    }
    event.preventDefault();
    // Required by some browsers for the prompt to appear at all.
    event.returnValue = '';
});

await load();
void pollState();
setInterval(() => void pollState(), STATE_POLL_MILLISECONDS);
