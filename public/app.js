import { putJson, requestJson } from '/api.js';
import { make } from '/dom.js';
import { renderEntities } from '/entities.js';
import { markMatchedRule, renderFlow } from '/flowEditor.js';
import { renderDisplay } from '/displayEditor.js';
import { createPanelPreview } from '/panelPreview.js';
import { renderSettings } from '/settings.js';

/**
 * The shell: loads the configuration, holds the draft the tabs edit, and
 * saves it back in one piece.
 *
 * Saving is explicit on purpose. The running service applies whatever it is
 * given immediately, so a half-written rule would otherwise become the panel's
 * behaviour while you were still typing it.
 */

const STATE_POLL_MILLISECONDS = 1000;

/** Long enough to read a sentence; an error stays until the next message. */
const STATUS_MILLISECONDS = 5000;

const element = id => document.getElementById(id);

const dom = {
    top: element('top'),
    panel: element('panel'),
    status: element('status'),
    save: element('save'),
    dirty: element('dirty'),
    connection: element('connection'),
    showing: element('showing'),
    mirror: element('mirror'),
};

/**
 * A thumbnail of the panel itself, drawn from the body the service last sent
 * — so the header shows what is lit, not a description of it.
 */
const mirror = createPanelPreview();
dom.mirror.append(mirror.canvas);
let mirroredJson = '';

const state = {
    tab: 'entities',
    /** The draft being edited. */
    config: null,
    /** The last saved form, as JSON, which is the whole of the dirty check. */
    savedJson: '',
    /**
     * The built-in items and their formats, from `/api/builtins`. Loaded once
     * at boot because several tabs need to know synchronously whether an id is
     * one of them: it changes what can be asked about it.
     */
    builtins: [],
    selectedEntityId: null,
    /**
     * Set when the Display tab is editing a display the flow sets for itself
     * rather than the entity's own: `{ ruleId, memberId }`, with `memberId`
     * only for a loop member. Choosing an entity clears it.
     */
    selectedFlowTarget: null,
    live: null,
};

/**
 * The sticky header wraps onto a second line on a phone, so anything else
 * that sticks has to be told how tall it is rather than guessing.
 */
const topObserver = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--top-height', `${dom.top.offsetHeight}px`);
});
topObserver.observe(dom.top);

let statusTimer;

/**
 * A toast rather than a line under the tabs, which sat there empty almost all
 * of the time. Errors stay until something else is said; nothing else does.
 */
export const setStatus = (message, kind = '') => {
    clearTimeout(statusTimer);
    dom.status.textContent = message;
    dom.status.className = kind === '' ? 'status' : `status ${kind}`;
    dom.status.hidden = message === '';
    if (message !== '' && kind !== 'error') {
        statusTimer = setTimeout(() => {
            dom.status.hidden = true;
        }, STATUS_MILLISECONDS);
    }
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
    selectedFlowTarget: state.selectedFlowTarget,
    changed,
    edited,
    setStatus,
    selectEntity: entityId => {
        state.selectedEntityId = entityId;
        state.selectedFlowTarget = null;
        render();
    },
    editFlowDisplay: (target, entityId) => {
        state.selectedEntityId = entityId;
        state.selectedFlowTarget = target;
        applyDirty();
        setTab('display');
    },
    showTab: name => {
        setTab(name);
    },
});

const RENDERERS = {
    entities: renderEntities,
    flow: renderFlow,
    display: renderDisplay,
    settings: renderSettings,
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

/** The rule's own words for why, when it has some. */
const ruleLabel = ruleId => {
    const rule = state.config?.flow.find(candidate => candidate.id === ruleId);
    return rule?.label || '';
};

const describeDecision = live => {
    if (!live || !live.decision) {
        return ['—'];
    }
    const why = ruleLabel(live.matchedRuleId);
    const because = why === '' ? null : make('span', { class: 'why', textContent: why });
    if (live.decision.show === 'nothing') {
        return [make('span', { textContent: 'off' }), because ?? make('span', {
            class: 'why',
            textContent: live.decision.reason,
        })];
    }
    const ownView = live.decision.display === undefined ? '' : ' (own view)';
    return [make('span', { class: 'mono', textContent: `${live.decision.entityId}${ownView}` }), because];
};

/**
 * Only the two shapes the mock-up knows — one scrolling name, or one bar —
 * are mirrored. A custom body leaves the thumbnail dark rather than guessing.
 */
const mirrorOf = payload => {
    if (!payload || payload.on === false) {
        return { kind: 'off' };
    }
    const lit = (payload.seg ?? []).filter(segment => segment.on !== false);
    if (lit.length !== 1) {
        return null;
    }
    const [segment] = lit;
    const colors = segment.col ?? [];
    const color = colors[0] ?? [255, 255, 255];
    if (segment.fx === 98) {
        return { kind: 'bar', percent: segment.ix ?? 0, color, trackColor: colors[1] ?? [0, 0, 0] };
    }
    if (segment.fx === 122 && typeof segment.n === 'string') {
        const columns = (segment.stop ?? 32) - (segment.start ?? 0);
        return { kind: 'text', text: segment.n, visible: Math.floor(columns / 4), color, speed: segment.sx ?? 128 };
    }
    return null;
};

const applyMirror = payload => {
    // Redrawn only when the body changes: every redraw restarts a scroll.
    const json = JSON.stringify(payload ?? null);
    if (json === mirroredJson) {
        return;
    }
    mirroredJson = json;
    mirror.show(mirrorOf(payload));
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
    dom.showing.replaceChildren(...describeDecision(live).filter(Boolean));
    applyMirror(live.decision?.show === 'nothing' ? { on: false } : live.lastPayload);

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
        applyMirror({ on: false });
    }
};

const save = async () => {
    if (!isDirty()) {
        return;
    }
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

addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
    }
});

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
