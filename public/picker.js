import { make } from '/dom.js';

/**
 * One searchable picker, used everywhere this editor chooses an entity: the
 * library on the Entities tab, every entity slot in the flow, and the Display
 * tab's selector.
 *
 * It exists because a `<select>` stops working somewhere around a hundred
 * options and a Home Assistant can have a few thousand — you cannot type at a
 * dropdown, and the one on the Entities tab is reading a *window* of the
 * server's matches rather than the whole list. Having one control for both
 * cases is what keeps the narrow case (a handful of panel entities) and the
 * wide one (everything Home Assistant exposes) behaving the same way.
 *
 * The caller supplies `find`, which is the only difference between them:
 *
 *     find(query) -> { rows: [{ id, label, detail, badge, addedNote }], note }
 *
 * Returning a `note` is how the remote one says what it left out. A row with
 * an `addedNote` is shown but cannot be chosen.
 */

/** Long enough to cover typing a word, short enough not to feel laggy. */
export const SEARCH_DEBOUNCE_MILLISECONDS = 200;

let nextListId = 0;

export const createPicker = ({
    value = '',
    placeholder = 'Search entities',
    /** A search already typed, for a picker rebuilt by a re-render. */
    query = '',
    find,
    onPick,
    /** The library's picker stays open, because adding several is one task. */
    keepOpenAfterPick = false,
    debounceMilliseconds = 0,
}) => {
    nextListId += 1;
    const listId = `picker-list-${nextListId}`;

    const list = make('div', {
        class: 'picker-list',
        id: listId,
        role: 'listbox',
        hidden: true,
        // Keeps the focus on the input, so choosing a row is a click rather
        // than a blur that closes the list before the click lands.
        onMouseDown: event => event.preventDefault(),
    });

    /**
     * A picker that holds a choice shows it in the field and empties the field
     * while it has focus, so the first keystroke is a filter rather than being
     * appended to an id. The chosen value stays readable as the placeholder.
     */
    let restingText = keepOpenAfterPick ? query : value;
    const emptyText = keepOpenAfterPick ? placeholder : value || placeholder;

    const input = make('input', {
        type: 'text',
        value: restingText,
        placeholder: emptyText,
        role: 'combobox',
        autocomplete: 'off',
        spellcheck: false,
        'aria-expanded': 'false',
        'aria-controls': listId,
    });

    const node = make('div', { class: 'picker' }, [input, list]);

    let isOpen = false;
    /** The pickable rows and their nodes, which is what the arrow keys walk. */
    let choices = [];
    let highlighted = -1;
    /** Which search the newest result belongs to, so a slow one cannot win. */
    let searchToken = 0;
    let debounceTimer;

    const close = () => {
        isOpen = false;
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        highlighted = -1;
    };

    const applyHighlight = () => {
        choices.forEach((choice, index) => {
            const on = index === highlighted;
            choice.node.classList.toggle('on', on);
            choice.node.setAttribute('aria-selected', String(on));
            if (on) {
                input.setAttribute('aria-activedescendant', choice.node.id);
                choice.node.scrollIntoView({ block: 'nearest' });
            }
        });
        if (highlighted === -1) {
            input.removeAttribute('aria-activedescendant');
        }
    };

    const choose = id => {
        if (!keepOpenAfterPick) {
            restingText = id;
            input.value = id;
            // Closes by way of the blur handler, which is also what a click
            // outside goes through, so there is one way out rather than two.
            input.blur();
        }
        onPick(id);
    };

    const drawRows = (found, note) => {
        choices = [];

        const nodes = found.map((row, index) => {
            const isPickable = row.addedNote === undefined;
            const position = isPickable ? choices.length : -1;
            const node = make('div', {
                class: isPickable ? 'picker-row' : 'picker-row taken',
                id: `${listId}-${index}`,
                role: 'option',
                'aria-selected': 'false',
                onClick: () => {
                    if (isPickable) {
                        choose(row.id);
                    }
                },
                onMouseEnter: () => {
                    if (isPickable) {
                        highlighted = position;
                        applyHighlight();
                    }
                },
            }, [
                make('span', { class: 'picker-id', textContent: row.label }),
                row.badge === undefined
                    ? null
                    : make('span', { class: 'picker-badge', textContent: row.badge }),
                make('span', { class: 'picker-detail', textContent: row.detail ?? '' }),
                row.addedNote === undefined
                    ? null
                    : make('span', { class: 'picker-taken', textContent: row.addedNote }),
            ]);

            if (isPickable) {
                choices.push({ row, node });
            }
            return node;
        });

        if (nodes.length === 0) {
            nodes.push(make('div', { class: 'picker-empty', textContent: 'Nothing matched.' }));
        }
        if (note !== undefined && note !== '') {
            nodes.push(make('div', { class: 'picker-note', textContent: note }));
        }

        list.replaceChildren(...nodes);
        highlighted = choices.length === 0 ? -1 : 0;
        applyHighlight();
    };

    const search = async query => {
        searchToken += 1;
        const token = searchToken;
        const result = await find(query);
        if (token !== searchToken) {
            return;
        }
        drawRows(result.rows, result.note);
    };

    const open = () => {
        isOpen = true;
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        void search(input.value);
    };

    input.addEventListener('focus', () => {
        // A field showing a *choice* empties so the first keystroke filters;
        // one showing a *search* keeps it, because that is where you left off.
        if (!keepOpenAfterPick) {
            input.value = '';
        }
        if (!isOpen) {
            open();
        }
    });

    input.addEventListener('blur', () => {
        // Nothing was chosen, so the field goes back to saying what is.
        input.value = restingText;
        close();
    });

    input.addEventListener('input', () => {
        if (!isOpen) {
            open();
            return;
        }
        const query = input.value;
        clearTimeout(debounceTimer);
        if (debounceMilliseconds === 0) {
            void search(query);
            return;
        }
        debounceTimer = setTimeout(() => void search(query), debounceMilliseconds);
    });

    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            input.value = restingText;
            close();
            return;
        }

        if (event.key === 'Enter') {
            event.preventDefault();
            const choice = choices[highlighted];
            if (choice !== undefined) {
                choose(choice.row.id);
            }
            return;
        }

        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        if (step === 0) {
            return;
        }
        event.preventDefault();
        if (!isOpen) {
            open();
            return;
        }
        if (choices.length === 0) {
            return;
        }
        highlighted = (highlighted + step + choices.length) % choices.length;
        applyHighlight();
    });

    return {
        node,
        /** Re-runs the current search, e.g. after a row became unpickable. */
        refresh: () => {
            if (isOpen) {
                void search(input.value);
            }
        },
        focus: () => input.focus(),
    };
};

/**
 * The picker over a list already in the browser: the panel's own entities,
 * which is what a flow rule or the Display tab is choosing between. No
 * debounce and no request — it is filtering an array of a dozen things.
 */
export const createLocalPicker = ({ ids, value, onPick, placeholder }) => {
    const find = query => {
        const needle = query.trim().toLowerCase();
        const matching = ids.filter(id => id.toLowerCase().includes(needle));
        const rows = matching.map(id => ({ id, label: id }));
        return Promise.resolve({ rows });
    };

    const picker = createPicker({ value, placeholder, find, onPick });
    return picker.node;
};
