import { card, make, option } from '/dom.js';
import { createLocalPicker } from '/picker.js';

/**
 * The flow chart, as a chain you read top to bottom.
 *
 * There is no canvas and nothing to wire up: the branch structure *is* the
 * order of the blocks, which is why the keyword on each one (IF / ELSE IF /
 * OTHERWISE) is derived from its position rather than chosen.
 */

const TESTS = {
    isPlaying: 'is playing',
    isNotPlaying: 'is not playing',
    isAvailable: 'has a reading',
    isUnavailable: 'has no reading',
    above: 'is above',
    below: 'is below',
    equals: 'state equals',
};

const TESTS_NEEDING_VALUE = ['above', 'below', 'equals'];

const ACTIONS = {
    blank: 'turn the panel off',
    show: 'show',
    loop: 'take turns between',
};

/**
 * Derived from position, never chosen: the chain's shape is its order. Only the
 * last conditionless rule is the OTHERWISE, because an earlier one can still be
 * fallen through — a rotation with no readings left declines to match.
 */
const keywordFor = (rule, index, total) => {
    const isLast = index === total - 1;
    if (rule.conditions.length === 0) {
        if (index === 0) {
            return 'ALWAYS';
        }
        return isLast ? 'OTHERWISE' : 'ELSE';
    }
    return index === 0 ? 'IF' : 'ELSE IF';
};

const newId = () => `rule-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The same searchable control the Entities tab uses, over the panel's own
 * entities rather than Home Assistant's. A `<select>` would do for four of
 * them and stops being usable well before the number you can add.
 */
const entityPicker = (config, selected, onPick) => {
    const ids = config.entities.map(entity => entity.entityId);
    return createLocalPicker({ ids, value: selected ?? '', onPick, placeholder: 'pick an entity' });
};

const conditionRow = (rule, condition, index, context) => {
    const { config } = context;
    const needsValue = TESTS_NEEDING_VALUE.includes(condition.test);

    const valueInput = make('input', {
        type: condition.test === 'equals' ? 'text' : 'number',
        value: condition.value ?? '',
        placeholder: condition.test === 'equals' ? 'playing' : '0',
        onInput: event => {
            const raw = event.target.value;
            condition.value = condition.test === 'equals' ? raw : Number(raw);
            context.edited();
        },
    });

    return make('div', { class: 'condition' }, [
        entityPicker(config, condition.entityId, value => {
            condition.entityId = value;
            context.changed();
        }),
        make('select', {
            onChange: event => {
                condition.test = event.target.value;
                const stillNeeds = TESTS_NEEDING_VALUE.includes(condition.test);
                if (!stillNeeds) {
                    delete condition.value;
                } else if (condition.value === undefined) {
                    condition.value = condition.test === 'equals' ? '' : 0;
                }
                context.changed();
            },
        }, Object.entries(TESTS).map(([value, text]) =>
            option(value, text, value === condition.test)
        )),
        needsValue ? valueInput : make('span', {}),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: '×',
            title: 'Remove this condition',
            onClick: () => {
                rule.conditions.splice(index, 1);
                context.changed();
            },
        }),
    ]);
};

const loopEditor = (rule, context) => {
    const { config } = context;
    const action = rule.action;
    const available = config.entities
        .map(entity => entity.entityId)
        .filter(entityId => !action.entityIds.includes(entityId));

    const members = action.entityIds.map((entityId, index) => make('div', { class: 'loop-member' }, [
        make('span', { class: 'mono', textContent: `${index + 1}. ${entityId}` }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↑',
            disabled: index === 0,
            title: 'Earlier in the rotation',
            onClick: () => {
                const [moved] = action.entityIds.splice(index, 1);
                action.entityIds.splice(index - 1, 0, moved);
                context.changed();
            },
        }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↓',
            disabled: index === action.entityIds.length - 1,
            title: 'Later in the rotation',
            onClick: () => {
                const [moved] = action.entityIds.splice(index, 1);
                action.entityIds.splice(index + 1, 0, moved);
                context.changed();
            },
        }),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: '×',
            disabled: action.entityIds.length === 1,
            title: action.entityIds.length === 1
                ? 'A rotation needs at least one entity'
                : 'Take out of the rotation',
            onClick: () => {
                action.entityIds.splice(index, 1);
                context.changed();
            },
        }),
    ]));

    const adder = available.length === 0 ? null : make('div', { class: 'loop-member' }, [
        createLocalPicker({
            ids: available,
            value: '',
            placeholder: 'add an entity…',
            onPick: entityId => {
                action.entityIds.push(entityId);
                context.changed();
            },
        }),
    ]);

    const dwell = make('label', { class: 'field' }, [
        'seconds each',
        make('input', {
            type: 'number',
            min: '1',
            max: '3600',
            value: action.dwellSeconds,
            onInput: event => {
                action.dwellSeconds = Number(event.target.value);
                context.edited();
            },
        }),
    ]);

    return make('div', {}, [
        make('div', { class: 'loop-members' }, [...members, adder]),
        make('div', { class: 'row', style: 'margin-top:10px;max-width:160px' }, [dwell]),
        make('p', {
            class: 'caveat',
            textContent: 'Interrupted and then resumed, a rotation comes back to the entity it '
                + 'was on and gives it a full turn.',
        }),
    ]);
};

const actionEditor = (rule, context) => {
    const { config } = context;
    const action = rule.action;

    const picker = make('select', {
        onChange: event => {
            const kind = event.target.value;
            const firstId = config.entities[0]?.entityId;
            if (kind === 'blank') {
                rule.action = { do: 'blank' };
            } else if (kind === 'show') {
                rule.action = { do: 'show', entityId: action.entityId ?? firstId };
            } else {
                const existing = action.do === 'show' ? [action.entityId] : undefined;
                const members = existing ?? (firstId === undefined ? [] : [firstId]);
                rule.action = { do: 'loop', entityIds: members, dwellSeconds: 5 };
            }
            context.changed();
        },
    }, Object.entries(ACTIONS).map(([value, text]) => option(value, text, value === action.do)));

    const extra = action.do === 'show'
        ? entityPicker(config, action.entityId, value => {
            action.entityId = value;
            context.changed();
        })
        : null;

    return make('div', {}, [
        make('div', { class: 'then' }, [
            make('span', { class: 'keyword', textContent: 'THEN' }),
            make('div', { style: 'min-width:170px' }, [picker]),
            extra === null ? null : make('div', { style: 'min-width:220px;flex:1' }, [extra]),
        ]),
        action.do === 'loop' ? loopEditor(rule, context) : null,
    ]);
};

/**
 * Which rule block is which, so the live poll can move the "matching now" mark
 * without rebuilding the tab. It used to rebuild, once a second, which took
 * the caret out of whatever was being typed into — and would shut a picker
 * before you could choose anything from it.
 */
const ruleBlocks = new Map();

export const markMatchedRule = matchedRuleId => {
    for (const [ruleId, block] of ruleBlocks) {
        const isMatched = ruleId === matchedRuleId;
        block.node.classList.toggle('matched', isMatched);
        block.flag.hidden = !isMatched;
    }
};

const ruleCard = (rule, index, context) => {
    const { config, live } = context;
    const matchedId = live?.matchedRuleId;
    const isMatched = matchedId === rule.id;

    const flag = make('span', {
        class: 'matched-flag',
        textContent: '● matching now',
        hidden: !isMatched,
    });

    const label = make('input', {
        type: 'text',
        value: rule.label ?? '',
        placeholder: 'what this rule is for',
        // `edited` rather than `changed`, as for every field typed into on
        // this tab: a re-render replaces the input and takes the caret with it
        // after one letter. Nothing else on the block depends on these values.
        onInput: event => {
            rule.label = event.target.value;
            context.edited();
        },
    });

    const move = offset => {
        const [moved] = config.flow.splice(index, 1);
        config.flow.splice(index + offset, 0, moved);
        context.changed();
    };

    const head = make('div', { class: 'rule-head' }, [
        make('span', { class: 'keyword', textContent: keywordFor(rule, index, config.flow.length) }),
        make('div', { style: 'flex:1;min-width:140px' }, [label]),
        flag,
        make('span', { class: 'spacer' }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↑',
            disabled: index === 0,
            title: 'Check this rule earlier',
            onClick: () => move(-1),
        }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↓',
            disabled: index === config.flow.length - 1,
            title: 'Check this rule later',
            onClick: () => move(1),
        }),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: 'delete',
            onClick: () => {
                config.flow.splice(index, 1);
                context.changed();
            },
        }),
    ]);

    const conditions = rule.conditions.map((condition, position) =>
        conditionRow(rule, condition, position, context)
    );

    const matchPicker = rule.conditions.length < 2 ? null : make('div', { class: 'row' }, [
        make('span', { class: 'caveat', textContent: 'match' }),
        make('select', {
            style: 'width:auto',
            onChange: event => {
                rule.match = event.target.value;
                context.changed();
            },
        }, [
            option('all', 'all of these', rule.match === 'all'),
            option('any', 'any of these', rule.match === 'any'),
        ]),
    ]);

    const addCondition = make('button', {
        class: 'small',
        type: 'button',
        textContent: '+ condition',
        disabled: config.entities.length === 0,
        onClick: () => {
            const firstId = config.entities[0].entityId;
            rule.conditions.push({ entityId: firstId, test: 'isPlaying' });
            context.changed();
        },
    });

    /**
     * A loop is the one action that can decline, so saying "nothing below is
     * reached" would be wrong for it — that is exactly the case the trailing
     * rule exists to catch.
     */
    const fallsThrough = rule.action.do === 'loop';
    const noConditions = make('p', {
        class: 'caveat',
        textContent: fallsThrough
            ? 'No conditions, so this runs whenever at least one of its entities has a '
                + 'reading. If none does, the rules below it are tried.'
            : 'No conditions, so this rule always matches — nothing below it is reached.',
    });

    const node = make('div', { class: isMatched ? 'rule matched' : 'rule' }, [
        head,
        ...conditions,
        rule.conditions.length === 0 ? noConditions : null,
        matchPicker,
        make('div', { class: 'row', style: 'margin-top:8px' }, [addCondition]),
        actionEditor(rule, context),
    ]);

    ruleBlocks.set(rule.id, { node, flag });
    return node;
};

export const renderFlow = (root, context) => {
    const { config } = context;
    root.className = '';
    ruleBlocks.clear();

    const blocks = [];
    config.flow.forEach((rule, index) => {
        if (index > 0) {
            blocks.push(make('div', { class: 'connector' }));
        }
        blocks.push(ruleCard(rule, index, context));
    });

    if (config.flow.length === 0) {
        blocks.push(make('p', {
            class: 'empty',
            textContent: 'No rules, so the panel stays off. Add one below.',
        }));
    }

    const addRule = make('button', {
        type: 'button',
        textContent: '+ add a rule',
        onClick: () => {
            config.flow.push({
                id: newId(),
                label: '',
                match: 'all',
                conditions: [],
                action: { do: 'blank' },
            });
            context.changed();
        },
    });

    const note = make('p', {
        class: 'caveat',
        textContent: 'Read top to bottom: the first rule whose conditions match decides, and the '
            + 'rest are not consulted. A rotation with no readings left is skipped, so it is '
            + 'worth keeping a rule with no conditions at the bottom.',
    });

    root.append(card('Flow', [
        note,
        make('div', { class: 'chain' }, blocks),
        make('div', { class: 'row', style: 'margin-top:16px' }, [addRule]),
    ]));
};
