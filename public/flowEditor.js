import { card, icon, iconButton, make, option } from '/dom.js';
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
    timeBetween: 'the time is between',
};

/** What a window starts as, chosen to be the obvious one: the night. */
const DEFAULT_WINDOW = { from: '22:00', to: '07:00' };

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

const FLOW_HELP = [
    'Read top to bottom: the first rule whose conditions match decides what the panel '
        + 'shows, and the rules below it are not consulted. The one deciding right now is '
        + 'outlined.',
    'A rule with no conditions always matches — except a rotation, which is skipped while '
        + 'none of its members has a reading. Keep a rule with no conditions at the bottom to '
        + 'catch that.',
    '“take turns between” shows each member for the seconds given. Interrupted and then '
        + 'resumed, it comes back to the member it was on and gives it a full turn. The same '
        + 'entity can be a member twice — a media player’s title, then its artist.',
    'Hover a rule or a member for its tools. “show when…” gives a member conditions of its '
        + 'own: it takes its turn only while they match. “own view…” draws an entity '
        + 'differently in that one place; its badge opens it again, and “reset” goes back to '
        + 'the entity’s own display.',
    'A time window is read on this machine’s clock, in the timezone on the Settings tab. '
        + 'One whose end is earlier than its start runs past midnight.',
];

/**
 * The same searchable control the Entities tab uses, over the panel's own
 * entities rather than Home Assistant's. A `<select>` would do for four of
 * them and stops being usable well before the number you can add.
 */
const entityPicker = (config, selected, onPick) => {
    const ids = config.entities.map(entity => entity.entityId);
    return createLocalPicker({ ids, value: selected ?? '', onPick, placeholder: 'pick an entity' });
};

/**
 * Switching between an entity test and the time window swaps which fields the
 * condition carries, so a saved one never holds an entity it does not read or
 * a window it does not use — the validator refuses both.
 */
const setTest = (condition, test, config) => {
    const wasTime = condition.test === 'timeBetween';
    const isTime = test === 'timeBetween';
    condition.test = test;

    if (isTime) {
        delete condition.entityId;
        delete condition.value;
        condition.from = condition.from ?? DEFAULT_WINDOW.from;
        condition.to = condition.to ?? DEFAULT_WINDOW.to;
        return;
    }

    if (wasTime) {
        delete condition.from;
        delete condition.to;
        condition.entityId = config.entities[0]?.entityId ?? '';
    }

    const needsValue = TESTS_NEEDING_VALUE.includes(test);
    if (!needsValue) {
        delete condition.value;
    } else if (condition.value === undefined) {
        condition.value = test === 'equals' ? '' : 0;
    }
};

const removeButton = (rule, index, context) => iconButton('close', 'Remove this condition', {
    class: 'danger',
    onClick: () => {
        rule.conditions.splice(index, 1);
        context.changed();
    },
});

const testPicker = (condition, context) => make('select', {
    onChange: event => {
        setTest(condition, event.target.value, context.config);
        context.changed();
    },
}, Object.entries(TESTS).map(([value, text]) => option(value, text, value === condition.test)));

const timeInput = (condition, key, context) => make('input', {
    type: 'time',
    value: condition[key],
    // An empty field is a half-typed time, which the validator would refuse
    // on save; keeping the last whole one is less surprising.
    onInput: event => {
        if (event.target.value === '') {
            return;
        }
        condition[key] = event.target.value;
        context.edited();
    },
});

const timeRow = (rule, condition, index, context) => make('div', { class: 'condition time' }, [
    make('span', { class: 'quiet', textContent: 'clock' }),
    testPicker(condition, context),
    make('div', { class: 'window' }, [
        timeInput(condition, 'from', context),
        make('span', { class: 'quiet', textContent: 'and' }),
        timeInput(condition, 'to', context),
    ]),
    removeButton(rule, index, context),
]);

const conditionRow = (rule, condition, index, context) => {
    if (condition.test === 'timeBetween') {
        return timeRow(rule, condition, index, context);
    }

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
        testPicker(condition, context),
        needsValue ? valueInput : make('span', {}),
        removeButton(rule, index, context),
    ]);
};

const newMemberId = () => `member-${Math.random().toString(36).slice(2, 8)}`;

/** A few words on a display the flow sets, so a member says what it draws. */
const summarise = display => {
    if (display.style === 'text') {
        return display.text;
    }
    if (display.style === 'byState') {
        return 'by state';
    }
    return display.style === 'bar' ? 'a bar' : 'custom JSON';
};

/**
 * The control for drawing an entity differently here than everywhere else.
 * Starting one copies the entity's own display, so the first thing you see on
 * the Display tab is what it already looked like, not a blank to fill in.
 *
 * Split in two: a view this place already has is a state worth seeing at all
 * times, so its badge — which is also how you open it — stays out; the
 * buttons that change it appear with the rest of the row's tools.
 */
const viewControls = (holder, target, context) => {
    const { config } = context;
    const edit = () => context.editFlowDisplay(target, holder.entityId);

    if (holder.display === undefined) {
        return {
            badge: null,
            tools: [make('button', {
                class: 'small',
                type: 'button',
                textContent: 'own view…',
                title: 'Draw it differently here than everywhere else',
                onClick: () => {
                    const entity = config.entities.find(candidate => candidate.entityId === holder.entityId);
                    if (entity === undefined) {
                        return;
                    }
                    holder.display = structuredClone(entity.display);
                    edit();
                },
            })],
        };
    }

    return {
        badge: make('button', {
            class: 'view-badge',
            type: 'button',
            title: `Drawn its own way here: ${summarise(holder.display)}. Click to edit.`,
            onClick: edit,
        }, [make('span', { textContent: summarise(holder.display) }), icon('edit')]),
        tools: [make('button', {
            class: 'small danger',
            type: 'button',
            textContent: 'reset',
            title: 'Use the entity’s own display here again',
            onClick: () => {
                delete holder.display;
                context.changed();
            },
        })],
    };
};

const matchPickerFor = (owner, context) => owner.conditions.length < 2 ? null : make('div', { class: 'row' }, [
    make('span', { class: 'quiet', textContent: 'match' }),
    make('select', {
        style: 'width:auto',
        onChange: event => {
            owner.match = event.target.value;
            context.changed();
        },
    }, [
        option('all', 'all of these', owner.match === 'all'),
        option('any', 'any of these', owner.match === 'any'),
    ]),
]);

const addConditionButtons = (owner, context) => [
    make('button', {
        class: 'small ghost',
        type: 'button',
        textContent: '+ condition',
        disabled: context.config.entities.length === 0,
        onClick: () => {
            const firstId = context.config.entities[0].entityId;
            owner.conditions.push({ entityId: firstId, test: 'isPlaying' });
            context.changed();
        },
    }),
    make('button', {
        class: 'small ghost',
        type: 'button',
        textContent: '+ time window',
        onClick: () => {
            owner.conditions.push({ test: 'timeBetween', ...DEFAULT_WINDOW });
            context.changed();
        },
    }),
];

/**
 * A member's own conditions: it takes its turn only while they match, and is
 * otherwise left out exactly as a sensor with no reading is. Removing the last
 * condition removes `when` itself, because an empty one is refused on save —
 * absent already means "always".
 */
const memberWhenEditor = (member, context) => {
    if (member.when === undefined) {
        return null;
    }
    const scoped = {
        ...context,
        changed: () => {
            if (member.when.conditions.length === 0) {
                delete member.when;
            }
            context.changed();
        },
    };
    const when = member.when;

    return make('div', { class: 'member-when' }, [
        make('div', { class: 'row', style: 'margin-bottom:8px' }, [
            make('span', { class: 'keyword', textContent: 'SHOW WHEN' }),
        ]),
        ...when.conditions.map((condition, position) => conditionRow(when, condition, position, scoped)),
        matchPickerFor(when, scoped),
        make('div', { class: 'row adders' }, addConditionButtons(when, scoped)),
    ]);
};

const loopEditor = (rule, context) => {
    const { config } = context;
    const action = rule.action;
    // Every entity, including ones already in the rotation: a member is a
    // place in it, so the same media player can be its title and then its
    // artist.
    const ids = config.entities.map(entity => entity.entityId);

    const memberRow = (member, index) => {
        const view = viewControls(member, { ruleId: rule.id, memberId: member.id }, context);
        const isOnly = action.members.length === 1;

        const showWhen = member.when !== undefined ? null : make('button', {
            class: 'small',
            type: 'button',
            textContent: 'show when…',
            title: 'Only take a turn while conditions of its own match',
            onClick: () => {
                // Starts on the member's own entity having a reading, which is
                // what it already needed, so adding it changes nothing yet.
                member.when = {
                    match: 'all',
                    conditions: [{ entityId: member.entityId, test: 'isAvailable' }],
                };
                context.changed();
            },
        });

        const move = offset => {
            const [moved] = action.members.splice(index, 1);
            action.members.splice(index + offset, 0, moved);
            context.changed();
        };

        return make('div', { class: 'loop-member' }, [
            make('span', { class: 'position', textContent: String(index + 1) }),
            make('span', { class: 'mono member-id', textContent: member.entityId }),
            view.badge,
            make('span', { class: 'spacer' }),
            make('div', { class: 'tools' }, [
                showWhen,
                ...view.tools,
                iconButton('up', 'Earlier in the rotation', {
                    disabled: index === 0,
                    onClick: () => move(-1),
                }),
                iconButton('down', 'Later in the rotation', {
                    disabled: index === action.members.length - 1,
                    onClick: () => move(1),
                }),
                iconButton('close', isOnly ? 'A rotation needs at least one entity' : 'Take out of the rotation', {
                    class: 'danger',
                    disabled: isOnly,
                    onClick: () => {
                        action.members.splice(index, 1);
                        context.changed();
                    },
                }),
            ]),
        ]);
    };

    const members = action.members.map((member, index) =>
        make('div', {}, [memberRow(member, index), memberWhenEditor(member, context)])
    );

    const adder = ids.length === 0 ? null : make('div', { class: 'loop-member adder' }, [
        createLocalPicker({
            ids,
            value: '',
            placeholder: 'add an entity…',
            onPick: entityId => {
                action.members.push({ id: newMemberId(), entityId });
                context.changed();
            },
        }),
    ]);

    return make('div', { class: 'loop-members' }, [...members, adder]);
};

/** On the THEN line, where it reads as the end of the sentence. */
const dwellField = (action, context) => make('label', { class: 'inline-field' }, [
    'for',
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
    'seconds each',
]);

/**
 * Switching between `show` and `loop` carries the entity and any display set
 * here across, in either direction, so changing your mind costs nothing.
 */
const toAction = (kind, action, config) => {
    const firstId = config.entities[0]?.entityId;
    if (kind === 'blank') {
        return { do: 'blank' };
    }

    const current = action.do === 'show' ? action : action.do === 'loop' ? action.members[0] : undefined;
    const entityId = current?.entityId ?? firstId;
    const display = current?.display;
    const kept = display === undefined ? {} : { display };

    if (kind === 'show') {
        return { do: 'show', entityId, ...kept };
    }
    const members = entityId === undefined ? [] : [{ id: newMemberId(), entityId, ...kept }];
    return { do: 'loop', members, dwellSeconds: 5 };
};

const actionEditor = (rule, context) => {
    const { config } = context;
    const action = rule.action;

    const picker = make('select', {
        onChange: event => {
            rule.action = toAction(event.target.value, action, config);
            context.changed();
        },
    }, Object.entries(ACTIONS).map(([value, text]) => option(value, text, value === action.do)));

    const extra = action.do === 'show'
        ? entityPicker(config, action.entityId, value => {
            action.entityId = value;
            context.changed();
        })
        : null;

    const view = action.do === 'show' ? viewControls(action, { ruleId: rule.id }, context) : null;

    return make('div', {}, [
        make('div', { class: 'then' }, [
            make('span', { class: 'keyword', textContent: 'THEN' }),
            make('div', { class: 'action-picker' }, [picker]),
            extra === null ? null : make('div', { class: 'then-target' }, [extra]),
            action.do === 'loop' ? dwellField(action, context) : null,
            view?.badge,
            view === null ? null : make('div', { class: 'tools' }, view.tools),
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
        textContent: 'on the panel now',
        hidden: !isMatched,
    });

    const label = make('input', {
        type: 'text',
        value: rule.label ?? '',
        class: 'rule-label',
        placeholder: 'Name this rule',
        'aria-label': 'Rule name',
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
        make('div', { class: 'rule-name' }, [label]),
        flag,
        make('div', { class: 'tools' }, [
            iconButton('up', 'Check this rule earlier', {
                disabled: index === 0,
                onClick: () => move(-1),
            }),
            iconButton('down', 'Check this rule later', {
                disabled: index === config.flow.length - 1,
                onClick: () => move(1),
            }),
            iconButton('trash', 'Delete this rule', {
                class: 'danger',
                onClick: () => {
                    config.flow.splice(index, 1);
                    context.setStatus(`Deleted “${rule.label || 'a rule'}”. Save to apply.`);
                    context.changed();
                },
            }),
        ]),
    ]);

    const conditions = rule.conditions.map((condition, position) =>
        conditionRow(rule, condition, position, context)
    );

    const node = make('div', { class: isMatched ? 'rule matched' : 'rule' }, [
        head,
        ...conditions,
        matchPickerFor(rule, context),
        make('div', { class: 'row adders' }, addConditionButtons(rule, context)),
        actionEditor(rule, context),
    ]);

    ruleBlocks.set(rule.id, { node, flag });
    return node;
};

export const renderFlow = (root, context) => {
    const { config } = context;
    root.className = 'narrow';
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

    root.append(card('Flow', [
        make('div', { class: 'chain' }, blocks),
        make('div', { class: 'row', style: 'margin-top:16px' }, [addRule]),
    ], FLOW_HELP));
};
