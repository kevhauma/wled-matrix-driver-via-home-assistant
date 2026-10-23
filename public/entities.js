import { card, make, option } from '/dom.js';
import { requestJson } from '/api.js';
import { createPicker, SEARCH_DEBOUNCE_MILLISECONDS } from '/picker.js';

/**
 * The entity library: a search box that asks the service what Home Assistant
 * exposes, and the list of what the panel knows about.
 *
 * The search is the server's, not the browser's. A Home Assistant with a few
 * thousand entities is the case this is built for, and `/api/library` answers
 * with a *window* of the matches plus how many it left out — so nothing here
 * ever holds the whole installation.
 *
 * Adding one needs a guess at how to read it, which is what `kind` is. The
 * guess is from the device class and unit, and the Display tab is where it gets
 * corrected. A built-in item needs no guess: it is text, and it arrives with
 * the format it starts on.
 */

const KIND_LABELS = {
    percent: 'percent (0-100)',
    temperature: 'temperature',
    text: 'text',
};

/** Kept across re-renders, so adding one entity does not clear the search. */
let lastQuery = '';

const guessKind = item => {
    if (item.source === 'builtin') {
        return 'text';
    }
    if (item.entityId.startsWith('media_player.')) {
        return 'text';
    }
    if (item.deviceClass === 'temperature') {
        return 'temperature';
    }
    if (item.unit === '%' || item.deviceClass === 'battery') {
        return 'percent';
    }
    return 'text';
};

const defaultDisplay = kind => {
    if (kind === 'percent') {
        return { style: 'bar', segmentId: 0, color: [0, 255, 80], trackColor: [0, 20, 40] };
    }
    return { style: 'text', segmentId: 0, color: [255, 255, 255], speed: 70, text: '{{value}}' };
};

const toPanelEntity = item => {
    const kind = guessKind(item);
    const display = defaultDisplay(kind);
    if (item.source === 'builtin') {
        return { entityId: item.entityId, kind, format: item.format, display };
    }
    return { entityId: item.entityId, kind, display };
};

/** `50 of 2431 matches` is the whole point of the endpoint's counts. */
const describePage = (page, source) => {
    const where = source === 'mock'
        ? 'the mock source (set HA_TOKEN to list real entities)'
        : 'Home Assistant';
    const hidden = page.matched - page.items.length;
    if (hidden <= 0) {
        return `${page.matched} of ${page.total} from ${where}.`;
    }
    return `${page.items.length} of ${page.matched} matches shown — `
        + `narrow the filter to see the other ${hidden}.`;
};

const libraryCard = (context, onAdded) => {
    const { config } = context;
    const note = make('p', { class: 'caveat' });
    /**
     * The rows the picker is showing, by id. The picker hands back the id that
     * was chosen, and adding needs the whole item — its state, its device
     * class, and for a built-in the format it starts on.
     */
    const shown = new Map();

    const find = async query => {
        lastQuery = query;
        const known = new Set(config.entities.map(entity => entity.entityId));
        try {
            const search = query === '' ? '' : `?q=${encodeURIComponent(query)}`;
            const page = await requestJson(`/api/library${search}`);
            note.className = 'caveat';
            note.textContent = describePage(page, page.source);

            shown.clear();
            for (const item of page.items) {
                shown.set(item.entityId, item);
            }

            const rows = page.items.map(item => ({
                id: item.entityId,
                label: item.entityId,
                badge: item.source === 'builtin' ? 'built in' : undefined,
                detail: [`${item.state}${item.unit}`, item.friendlyName].filter(Boolean).join(' · '),
                addedNote: known.has(item.entityId) ? 'on the panel' : undefined,
            }));
            // The server's own count line is shown under the field, so the
            // list's footer only has to say that it is a window.
            const hiddenCount = page.matched - page.items.length;
            const footer = hiddenCount > 0
                ? `${hiddenCount} more ${hiddenCount === 1 ? 'match' : 'matches'} — keep typing`
                : '';
            return { rows, note: footer };
        } catch (error) {
            note.textContent = error.message;
            note.className = 'warning';
            return { rows: [], note: '' };
        }
    };

    const picker = createPicker({
        placeholder: 'Search by id, name or device class',
        query: lastQuery,
        find,
        keepOpenAfterPick: true,
        debounceMilliseconds: SEARCH_DEBOUNCE_MILLISECONDS,
        onPick: entityId => {
            const item = shown.get(entityId);
            if (item === undefined) {
                return;
            }
            const entity = toPanelEntity(item);
            config.entities.push(entity);
            context.setStatus(`Added ${entityId} as ${KIND_LABELS[entity.kind]}. Save to apply.`);
            /**
             * `edited` rather than `changed`: a re-render would replace the
             * search field mid-search and take the focus with it, and adding
             * several entities from one search is the normal way to use this.
             * The two things the add changed are redrawn by hand instead.
             */
            context.edited();
            onAdded();
            picker.refresh();
        },
    });

    // Run once on render so the count line and the "on the panel" markers are
    // there before the field is touched, rather than only once it is opened.
    void find(lastQuery);

    return { node: card('Library', [picker.node, note]) };
};

const usedInFlow = (config, entityId) =>
    config.flow.filter(rule => {
        const inCondition = rule.conditions.some(condition => condition.entityId === entityId);
        const action = rule.action;
        const inShow = action.do === 'show' && action.entityId === entityId;
        const inLoop = action.do === 'loop'
            && action.members.some(member => member.entityId === entityId);
        return inCondition || inShow || inLoop;
    });

/**
 * A built-in item reads as text and nothing else, so it is told rather than
 * asked. `panelConfig.ts` refuses any other kind for one.
 */
const kindCell = (entity, context) => {
    if (context.isBuiltin(entity.entityId)) {
        return make('span', { class: 'caveat', textContent: 'text (built in)' });
    }

    return make('select', {
        onChange: event => {
            entity.kind = event.target.value;
            // A bar needs a number, so switching to text would leave an
            // unreadable display behind. A custom body is hand-written and
            // is never replaced from under you — its placeholders all have
            // a defined value for every kind.
            const wantsBar = entity.kind === 'percent';
            const isBar = entity.display.style === 'bar';
            const isCustom = entity.display.style === 'custom';
            if (!isCustom && wantsBar !== isBar) {
                entity.display = defaultDisplay(entity.kind);
            }
            context.changed();
        },
    }, Object.entries(KIND_LABELS).map(([value, text]) =>
        option(value, text, value === entity.kind)
    ));
};

const panelCard = context => {
    const { config } = context;

    const rows = config.entities.map(entity => {
        const references = usedInFlow(config, entity.entityId);
        const uses = references.length;

        return make('tr', {}, [
            make('td', { class: 'id', textContent: entity.entityId }),
            make('td', {}, [kindCell(entity, context)]),
            make('td', { textContent: entity.display.style }),
            make('td', { textContent: uses === 0 ? 'unused' : `${uses} rule${uses === 1 ? '' : 's'}` }),
            make('td', { class: 'actions' }, [
                make('button', {
                    class: 'small',
                    type: 'button',
                    textContent: 'edit',
                    onClick: () => {
                        context.selectEntity(entity.entityId);
                        context.showTab('display');
                    },
                }),
                make('button', {
                    class: 'small danger',
                    type: 'button',
                    textContent: 'remove',
                    onClick: () => {
                        if (uses > 0) {
                            const ids = references.map(rule => rule.label ?? rule.id).join(', ');
                            const ok = confirm(
                                `${entity.entityId} is used by: ${ids}.\n\n` +
                                'Removing it will also take it out of those rules. Continue?',
                            );
                            if (!ok) {
                                return;
                            }
                        }
                        removeEntity(config, entity.entityId);
                        context.setStatus(`Removed ${entity.entityId}. Save to apply.`);
                        context.changed();
                    },
                }),
            ]),
        ]);
    });

    const body = rows.length === 0
        ? make('p', { class: 'empty', textContent: 'Nothing on the panel yet. Add one from the library.' })
        : make('div', { class: 'table-scroll' }, [make('table', {}, [
            make('thead', {}, [
                make('tr', {}, [
                    make('th', { textContent: 'Entity' }),
                    make('th', { textContent: 'Read as' }),
                    make('th', { textContent: 'Drawn as' }),
                    make('th', { textContent: 'Used by' }),
                    make('th', { textContent: '' }),
                ]),
            ]),
            make('tbody', {}, rows),
        ])]);

    const note = make('p', {
        class: 'caveat',
        textContent: 'Changing which Home Assistant entities exist makes the service resubscribe '
            + 'when you save; the panel keeps showing the old reading until the new snapshot '
            + 'arrives. Adding or removing a built-in item costs no reconnect — it is read from '
            + 'this machine’s clock, not from Home Assistant.',
    });

    return card('On the panel', [body, note]);
};

/** Taken out of the flow too, so saving cannot leave a rule pointing at nothing. */
const removeEntity = (config, entityId) => {
    config.entities = config.entities.filter(entity => entity.entityId !== entityId);

    for (const rule of config.flow) {
        rule.conditions = rule.conditions.filter(condition => condition.entityId !== entityId);
        if (rule.action.do === 'loop') {
            rule.action.members = rule.action.members.filter(member => member.entityId !== entityId);
        }
    }

    // A `show` of a gone entity, and a loop with nothing left, become blanks
    // rather than invalid rules the validator would reject on save.
    config.flow = config.flow.map(rule => {
        const action = rule.action;
        const showsGone = action.do === 'show' && action.entityId === entityId;
        const emptyLoop = action.do === 'loop' && action.members.length === 0;
        if (showsGone || emptyLoop) {
            return { ...rule, action: { do: 'blank' } };
        }
        return rule;
    });
};

export const renderEntities = (root, context) => {
    root.className = 'split split-wide';

    const panelHost = make('div', {});
    const drawPanel = () => panelHost.replaceChildren(panelCard(context));
    drawPanel();

    const library = libraryCard(context, drawPanel);
    root.append(library.node, panelHost);
};
