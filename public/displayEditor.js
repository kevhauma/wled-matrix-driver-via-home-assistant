import { card, field, fromHex, make, option, toHex } from '/dom.js';
import { postJson, requestJson } from '/api.js';
import { createLocalPicker } from '/picker.js';
import { createPanelPreview } from '/panelPreview.js';

/**
 * How one entity is drawn, with a mock-up of the panel beside it.
 *
 * The preview's numbers all come from the server, which runs the same code that
 * builds the real payload — so the string, its length and the JSON shown here
 * cannot drift from what the device is sent.
 */

const SAMPLES = {
    percent: '64',
    temperature: '18.4',
    text: 'Superstitious Fantasy',
};

const WARNING_TEXT = {
    strippedNonAscii: 'characters removed — the device fonts are ASCII only',
    shortened: 'too long, so a shorter form was used',
    scrolls: 'longer than the panel, so it scrolls',
    segmentNameTooLong: 'a segment name is over 32 characters, so the device will cut it',
};

/**
 * The same names as `template.ts`'s `Placeholders`, which this cannot import —
 * the editor is plain browser JavaScript. Changing one means changing both.
 */
const PLACEHOLDER_HELP = [
    ['{{value}}', 'the reading as the panel draws it: 18C, 64%, a media title'],
    ['{{percent}}', '0-100 — the number a Percent segment wants in ix'],
    ['{{degrees}}', 'the temperature, rounded'],
    ['{{unit}}', 'the entity’s unit, e.g. C'],
    ['{{title}}', 'a media player’s title on its own'],
    ['{{artist}}', 'a media player’s artist on its own'],
    ['{{sensor.x}}', 'another of the panel’s entities, as the panel draws it'],
    ['{{sensor.x:degrees}}', 'any of the above, read from that entity instead'],
];

const placeholderHelp = () => make('div', { class: 'tokens' }, PLACEHOLDER_HELP.map(
    ([token, meaning]) => make('div', { class: 'token' }, [
        make('code', { textContent: token }),
        make('span', { textContent: meaning }),
    ]),
));

const WHITE = [255, 255, 255];

const preview = createPanelPreview();
const samples = new Map();

/**
 * The JSON as typed, per view, so that a keystroke that has not finished
 * being valid JSON yet is not thrown away. The draft is what the textarea
 * shows; `display.payload` only moves on when it parses.
 */
const drafts = new Map();

/**
 * A field whose label carries the control's current value, e.g. `speed — 70`.
 * The label is updated in place, because re-rendering on every `input` event
 * replaces the slider under the pointer and ends the drag.
 */
const sliderField = (name, value, onValue) => {
    const caption = document.createTextNode(`${name} — ${value}`);
    const slider = make('input', {
        type: 'range',
        min: '0',
        max: '255',
        value,
        onInput: event => {
            const next = Number(event.target.value);
            caption.textContent = `${name} — ${next}`;
            onValue(next);
        },
    });
    return make('label', { class: 'field' }, [caption, slider]);
};

const outputCard = (context, refresh) => {
    const { config } = context;

    const brightness = sliderField('brightness', config.output.brightness, value => {
        config.output.brightness = value;
        context.edited();
        refresh();
    });

    const ip = make('input', {
        type: 'text',
        value: config.output.wledIp,
        placeholder: '192.168.1.69 — empty prints instead of posting',
        onChange: event => {
            config.output.wledIp = event.target.value.trim();
            context.changed();
        },
    });

    return card('Output', [
        make('div', { class: 'fields' }, [
            brightness,
            field('WLED address', ip),
        ]),
        make('p', {
            class: 'caveat',
            textContent: 'WLED_IP and WLED_BRIGHTNESS in .env only seeded this file the first '
                + 'time it was written. These values win now.',
        }),
    ]);
};

/** What a choice by state falls back to, which is what a change of style keeps. */
const plainOf = display => display.style === 'byState' ? display.otherwise : display;

/** A custom display's segments live in its body, so this has to dig one out. */
const segmentIdOf = display => {
    if (display.style !== 'custom') {
        return display.segmentId;
    }
    const first = display.payload.seg?.[0];
    return first?.id ?? 0;
};

/**
 * What switching to `custom` starts from: the body the `text` style would have
 * sent for this entity, its template included. An empty object would be a worse start — you would have
 * to know the effect id, which sliders matter and that `ix` and `c2` have to be
 * pinned before anything appeared on the panel at all.
 */
const customSeed = (display, segmentId, color) => ({
    on: true,
    seg: [{
        id: segmentId,
        fx: 122,
        n: display.style === 'text' ? display.text : '{{value}}',
        sx: display.style === 'text' ? display.speed : 80,
        ix: 128,
        c2: 0,
        col: [color, [0, 0, 0], color],
    }],
});

/**
 * Keeping the segment and the colour across a style change: being made to pick
 * a colour again because you changed how the value is drawn reads as the
 * editor having forgotten it.
 */
const toStyle = (style, current) => {
    if (style === 'byState') {
        return { style: 'byState', cases: [], otherwise: structuredClone(plainOf(current)) };
    }

    const display = plainOf(current);
    const segmentId = segmentIdOf(display);
    const color = display.color ?? WHITE;

    if (style === 'bar') {
        return { style: 'bar', segmentId, color, trackColor: [0, 20, 40] };
    }
    if (style === 'text') {
        return { style: 'text', segmentId, color, speed: 70, text: '{{value}}' };
    }
    const payload = customSeed(display, segmentId, color);
    return { style: 'custom', payload };
};

const customFields = (view, context, refresh) => {
    const display = view.holder.display;
    const stored = drafts.get(view.key);
    const text = stored ?? JSON.stringify(display.payload, null, 2);

    const failure = make('p', { class: 'warning', hidden: true });

    // A draft put back after a tab switch may be mid-edit, so the complaint it
    // was already showing has to be worked out again rather than remembered.
    if (stored !== undefined) {
        try {
            JSON.parse(stored);
        } catch (error) {
            failure.hidden = false;
            failure.textContent = error.message;
        }
    }

    const editor = make('textarea', {
        class: 'json',
        rows: 18,
        spellcheck: false,
        value: text,
        onInput: event => {
            const next = event.target.value;
            drafts.set(view.key, next);

            let parsed;
            try {
                parsed = JSON.parse(next);
            } catch (error) {
                failure.hidden = false;
                failure.textContent = error.message;
                return;
            }

            failure.hidden = true;
            display.payload = parsed;
            /**
             * `edited` rather than `changed`: a re-render would replace this
             * textarea mid-keystroke. The preview is refreshed by hand instead,
             * and it is the server's validator that reports a body which is
             * valid JSON but not a valid display.
             */
            context.edited();
            refresh();
        },
    });

    return make('div', { class: 'custom' }, [
        editor,
        failure,
        make('p', {
            class: 'caveat',
            textContent: 'A whole /json/state body. Segments other entities use are switched '
                + 'off for you; on and bri are filled in only if you leave them out. Every '
                + 'seg entry needs a literal id — the service has to know which segments this '
                + 'display owns before it has a value to put in them.',
        }),
        placeholderHelp(),
        make('p', {
            class: 'caveat',
            textContent: 'A string that is nothing but one placeholder takes that value’s own '
                + 'type, so "ix": "{{percent}}" arrives as a number. Anywhere else it is '
                + 'interpolated, so "bat {{percent}}%" stays text.',
        }),
    ]);
};

/**
 * Which of a built-in item's fixed formats it renders in. The choices and the
 * example beside each one come from `/api/builtins`, so they cannot drift from
 * `builtins.ts` the way the placeholder help above has to be kept in step by
 * hand.
 */
const formatField = (entity, context) => {
    const builtin = context.builtins.find(item => item.entityId === entity.entityId);
    if (builtin === undefined) {
        return null;
    }

    const choices = builtin.formats.map(choice =>
        option(choice.format, choice.example, choice.format === entity.format)
    );

    const select = make('select', {
        onChange: event => {
            entity.format = event.target.value;
            context.changed();
        },
    }, choices);

    /**
     * The examples arrived with the page, so by now they are a clock that has
     * stopped — and a stale one sitting beside the live preview reads as a
     * bug. Re-read them rather than working the formats out here, which is the
     * duplication `/api/builtins` exists to avoid.
     */
    void requestJson('/api/builtins').then(body => {
        const current = body.items.find(item => item.entityId === entity.entityId);
        if (current === undefined) {
            return;
        }
        for (const choice of current.formats) {
            const match = [...select.options].find(candidate => candidate.value === choice.format);
            if (match !== undefined) {
                match.textContent = choice.example;
            }
        }
    }).catch(() => {
        // The preview beside this reports a service that cannot be reached.
    });

    return field('format', select);
};

/**
 * A view's own JSON draft and every one of its cases', which are keyed under
 * it. Dropped together, because a case's draft is keyed by its position.
 */
const forgetDrafts = key => {
    for (const draftKey of [...drafts.keys()]) {
        if (draftKey === key || draftKey.startsWith(`${key}#`)) {
            drafts.delete(draftKey);
        }
    }
};

const caseButtons = (view, cases, index, context) => {
    const move = offset => {
        const [moved] = cases.splice(index, 1);
        cases.splice(index + offset, 0, moved);
        forgetDrafts(view.key);
        context.changed();
    };
    return [
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↑',
            disabled: index === 0,
            title: 'Check this case earlier',
            onClick: () => move(-1),
        }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '↓',
            disabled: index === cases.length - 1,
            title: 'Check this case later',
            onClick: () => move(1),
        }),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: 'delete',
            onClick: () => {
                cases.splice(index, 1);
                forgetDrafts(view.key);
                context.changed();
            },
        }),
    ];
};

/**
 * A display chosen by state: a list of cases, each a plain display of its own
 * edited by the same fields as any other, and an `otherwise`. Each case is
 * handed to `displayFields` as a view of its own, which is why every holder
 * keeps its display under `display` — a case does too.
 */
const byStateFields = (view, context, refresh, headerFields) => {
    const display = view.holder.display;
    const nestedView = (key, holder) => ({ ...view, key: `${view.key}#${key}`, holder, nested: true });

    const caseBlocks = display.cases.map((stateCase, index) => {
        const states = make('input', {
            type: 'text',
            class: 'mono',
            value: stateCase.states.join(', '),
            placeholder: 'sunny, clear-night',
            onInput: event => {
                const parts = event.target.value.split(',').map(part => part.trim());
                stateCase.states = parts.filter(part => part !== '');
                context.edited();
                refresh();
            },
        });

        return make('div', { class: 'state-case' }, [
            make('div', { class: 'rule-head' }, [
                make('span', { class: 'keyword', textContent: index === 0 ? 'WHEN' : 'ELSE WHEN' }),
                make('div', { style: 'flex:1;min-width:160px' }, [states]),
                ...caseButtons(view, display.cases, index, context),
            ]),
            displayFields(nestedView(index, stateCase), context, refresh),
        ]);
    });

    const otherwiseHolder = {
        get display() {
            return display.otherwise;
        },
        set display(next) {
            display.otherwise = next;
        },
    };

    const addCase = make('button', {
        class: 'small',
        type: 'button',
        textContent: '+ case',
        onClick: () => {
            // Starts as a copy of `otherwise`, so a new case changes nothing
            // until it is edited, rather than drawing a default nobody chose.
            display.cases.push({ states: [], display: structuredClone(display.otherwise) });
            context.changed();
        },
    });

    return make('div', {}, [
        make('div', { class: 'fields' }, headerFields.filter(Boolean)),
        make('p', {
            class: 'caveat',
            textContent: 'Read top to bottom: the first case listing the entity’s state is drawn, '
                + 'compared exactly — “sunny”, “clear-night”, “playing”. A picture for a state is '
                + 'a custom WLED JSON case drawing pixels with the segment’s "i" field; the '
                + 'device’s fonts are ASCII only.',
        }),
        ...caseBlocks,
        make('div', { class: 'row', style: 'margin:4px 0 12px' }, [addCase]),
        make('div', { class: 'state-case' }, [
            make('div', { class: 'rule-head' }, [
                make('span', { class: 'keyword', textContent: 'OTHERWISE' }),
            ]),
            displayFields(nestedView('otherwise', otherwiseHolder), context, refresh),
        ]),
    ]);
};

const displayFields = (view, context, refresh) => {
    const { entity, holder } = view;
    const display = holder.display;

    /**
     * Every field below that is typed into or dragged ends here rather than in
     * `changed`: a re-render replaces the control mid-edit, which takes the
     * caret after one letter and ends a slider or colour drag. Only the
     * preview depends on these values, so it is all that is redrawn.
     */
    const edited = () => {
        context.edited();
        refresh();
    };

    /**
     * A built-in item is a clock, so `bar` is not offered — a bar wants a
     * number and would draw permanently empty. `panelConfig.ts` refuses it
     * outright, which is what covers a hand-edited file.
     */
    const isBuiltin = context.isBuiltin(entity.entityId);
    const styles = [
        option('text', 'scrolling text', display.style === 'text'),
        isBuiltin ? null : option('bar', 'bar', display.style === 'bar'),
        option('custom', 'custom WLED JSON', display.style === 'custom'),
        // A case cannot itself choose by state; the validator refuses it too.
        view.nested ? null : option('byState', 'depends on its state', display.style === 'byState'),
    ].filter(Boolean);

    const stylePicker = make('select', {
        onChange: event => {
            const style = event.target.value;
            if (style === display.style) {
                return;
            }
            // The draft belongs to the body being replaced, so keeping it would
            // put the old JSON back the next time `custom` was chosen.
            forgetDrafts(view.key);
            holder.display = toStyle(style, display);
            context.changed();
        },
    }, styles);

    // The format belongs to the entity, so it is set on the entity's own
    // display and applies wherever the flow shows it.
    const isFlowDisplay = view.target !== null;
    const format = !isBuiltin || isFlowDisplay || view.nested ? null : formatField(entity, context);

    if (display.style === 'byState') {
        return byStateFields(view, context, refresh, [format, field('drawn as', stylePicker)]);
    }

    if (display.style === 'custom') {
        return make('div', {}, [
            make('div', { class: 'fields' }, [
                format,
                field('drawn as', stylePicker),
            ].filter(Boolean)),
            make('div', { style: 'height:14px' }),
            customFields(view, context, refresh),
        ]);
    }

    const segment = make('input', {
        type: 'number',
        min: '0',
        max: '31',
        value: display.segmentId,
        onInput: event => {
            display.segmentId = Number(event.target.value);
            edited();
        },
    });

    const colour = make('input', {
        type: 'color',
        value: toHex(display.color),
        onInput: event => {
            display.color = fromHex(event.target.value);
            edited();
        },
    });

    const fields = [
        format,
        field('drawn as', stylePicker),
        field('segment', segment),
        field('colour', colour),
    ].filter(Boolean);

    if (display.style === 'bar') {
        fields.push(field('track colour', make('input', {
            type: 'color',
            value: toHex(display.trackColor),
            onInput: event => {
                display.trackColor = fromHex(event.target.value);
                edited();
            },
        })));
    } else {
        fields.push(sliderField('scroll speed', display.speed, value => {
            display.speed = value;
            edited();
        }));
        fields.push(field('text', make('input', {
            type: 'text',
            class: 'mono',
            value: display.text,
            placeholder: '{{value}}',
            onInput: event => {
                display.text = event.target.value;
                edited();
            },
        })));
    }

    const fieldGrid = make('div', { class: 'fields' }, fields);
    if (display.style !== 'text') {
        return fieldGrid;
    }

    const note = make('p', {
        class: 'caveat',
        textContent: 'Anything around a placeholder is drawn as written, so "PV {{value}}W" is '
            + 'a prefix and a suffix. A media title too long for the panel is tried again '
            + 'without its artist before anything is cut.',
    });
    return make('div', {}, [fieldGrid, note, placeholderHelp()]);
};

/**
 * A custom display has as many segment names as it wrote, so there is no one
 * line to report. Each is listed with what it came out as, whether it fits the
 * panel, and what `{{value}}` itself filled to.
 */
const describeCustom = result => {
    const lines = [`{{value}} fills to "${result.text}" — ${result.length} characters`];

    for (const segment of result.customSegments) {
        if (segment.name === undefined) {
            lines.push(`segment ${segment.id}: no name, so it draws no text`);
            continue;
        }
        const movement = segment.scrolls ? 'scrolls' : 'sits still';
        lines.push(
            `segment ${segment.id}: "${segment.name}" — ${segment.length} of 32, ${movement}`,
        );
    }

    return lines.map(line => make('div', { textContent: line }));
};

/** Which case a sample picked, said in the words the Display tab uses. */
const describeChoice = (result, sample) => {
    if (result.caseIndex === undefined) {
        return '';
    }
    if (result.caseIndex === -1) {
        return `No case lists “${sample.value}”, so “otherwise” is drawn.`;
    }
    return `“${sample.value}” picks case ${result.caseIndex + 1}.`;
};

const refreshPreview = async (view, sample, nodes, context) => {
    const { entity } = view;
    const unit = entity.kind === 'temperature' ? 'C' : entity.kind === 'percent' ? '%' : '';
    try {
        const result = await postJson('/api/preview', {
            entityId: entity.entityId,
            target: view.target,
            flow: context.config.flow,
            sampleValue: sample.value,
            sampleArtist: sample.artist,
            unit,
            entities: context.config.entities,
        });

        nodes.problem.hidden = true;
        nodes.payload.textContent = JSON.stringify(result.payload, null, 2);

        /**
         * Drawn from what the server says is drawn, not from what is being
         * edited: for a display chosen by state that is whichever case the
         * sample picked, and only the server's code decides that.
         */
        const display = result.display;
        nodes.choice.textContent = describeChoice(result, sample);
        nodes.choice.hidden = result.caseIndex === undefined;
        nodes.caveat.textContent = CAVEATS[display.style];
        preview.canvas.hidden = display.style === 'custom';

        nodes.warnings.replaceChildren(...result.warnings.map(name =>
            make('span', { class: 'warning', textContent: WARNING_TEXT[name] ?? name })
        ));

        if (display.style === 'custom') {
            nodes.readout.replaceChildren(...describeCustom(result));
            // Nothing honest to draw: the mock-up knows one scrolling string or
            // one bar across the whole panel, and a custom body is neither.
            preview.show(null);
            return;
        }

        nodes.readout.textContent = `segment name "${result.text}" — ${result.length} of 32 `
            + `characters, ${result.visible} visible at once`;

        if (display.style === 'bar') {
            preview.show({
                kind: 'bar',
                percent: result.percent ?? 0,
                color: display.color,
                trackColor: display.trackColor,
            });
            return;
        }

        preview.show({
            kind: 'text',
            text: result.text,
            visible: result.visible,
            color: display.color,
            speed: display.speed,
        });
    } catch (error) {
        /**
         * Reported beside the preview rather than in the status bar. A custom
         * body is edited keystroke by keystroke and the message is the shared
         * validator's — so it appears and clears constantly, which is not what
         * a bar that also says "Saved" is for.
         */
        nodes.problem.hidden = false;
        nodes.problem.textContent = error.message;
        preview.show(null);
    }
};

const CAVEATS = {
    bar: 'The bar is drawn as a proportion of 32 columns, left to right, which is what the '
        + 'device does: a bar segment goes out as a transposed Bar expansion of the Percent '
        + 'effect. What this cannot know is how tall the segment is, so a bar on part of the '
        + 'panel is drawn taller here than on the device.',
    text: 'Letterforms are approximate: the device uses its own font, and this cannot draw it. '
        + 'The character count, the visible window and whether it scrolls are accurate.',
    custom: 'No mock-up for a custom body: this can draw one scrolling string or one bar across '
        + 'the panel, and nothing here knows what effects you have asked for or how you have '
        + 'divided the segments. What is below is exactly what the device is sent.',
};

/**
 * Returns its own node and a way to refresh it, because the JSON editor
 * updates the preview without a re-render — the two have to be able to reach
 * each other without the tab being rebuilt.
 */
const previewCard = (view, context) => {
    const { entity } = view;
    const isByState = view.holder.display.style === 'byState';
    const stored = samples.get(entity.entityId);
    const sample = stored ?? { value: SAMPLES[entity.kind] ?? '', artist: '' };

    const nodes = {
        caveat: make('p', { class: 'caveat' }),
        choice: make('p', { class: 'choice', hidden: true }),
        readout: make('div', { class: 'caveat' }),
        warnings: make('div', { class: 'warnings' }),
        problem: make('p', { class: 'warning', hidden: true }),
        payload: make('pre', { class: 'payload' }),
    };

    const refresh = () => {
        void refreshPreview(view, sample, nodes, context);
    };

    const sampleInput = make('input', {
        type: 'text',
        value: sample.value,
        onInput: event => {
            sample.value = event.target.value;
            samples.set(entity.entityId, sample);
            refresh();
        },
    });

    /**
     * Only a media player has one, and it is the only way `{{artist}}` and the
     * two-forms-of-a-title behaviour can be seen without the hardware.
     */
    const isMediaPlayer = entity.entityId.startsWith('media_player.');
    const artistInput = !isMediaPlayer ? null : make('input', {
        type: 'text',
        value: sample.artist,
        placeholder: 'e.g. "Windwaker"',
        onInput: event => {
            sample.artist = event.target.value;
            samples.set(entity.entityId, sample);
            refresh();
        },
    });

    /**
     * A built-in item has nothing to fake: the preview is reading the same
     * clock the service will send, so there is no sample to type and what is
     * below is the real string as of this render.
     */
    const isBuiltin = context.isBuiltin(entity.entityId);
    const clockNote = !isBuiltin ? null : make('p', {
        class: 'caveat',
        textContent: 'The value is this machine’s clock, so there is nothing to sample — what '
            + 'is below is what would go out right now. The service redraws it as the minute '
            + 'turns.',
    });

    refresh();

    const node = card('Preview', [
        make('div', { class: 'preview' }, [
            preview.canvas,
            nodes.caveat,
            clockNote,
            isBuiltin ? null : field(isByState ? 'sample value — the state to choose by' : 'sample value', sampleInput),
            nodes.choice,
            isBuiltin || artistInput === null ? null : field('sample artist', artistInput),
            nodes.readout,
            nodes.warnings,
            nodes.problem,
            make('h2', { textContent: 'What gets sent', style: 'margin-top:8px' }),
            nodes.payload,
        ]),
    ]);

    return { node, refresh };
};

/**
 * What the tab is editing. Every holder of a display keeps it under the same
 * `display` key — an entity, a `show` rule, a loop member — so the fields
 * below write `view.holder.display` and never need to know which one it is.
 *
 * Falls back to the entity's own display when the flow target has gone or no
 * longer sets one, which is what removing it from the flow tab leaves behind.
 */
const findView = context => {
    const { config, selectedEntityId, selectedFlowTarget } = context;
    const entity = config.entities.find(candidate => candidate.entityId === selectedEntityId)
        ?? config.entities[0];

    if (selectedFlowTarget !== null) {
        const { ruleId, memberId } = selectedFlowTarget;
        const rule = config.flow.find(candidate => candidate.id === ruleId);
        const action = rule?.action;
        const holder = action?.do === 'show'
            ? action
            : action?.do === 'loop'
            ? action.members.find(member => member.id === memberId)
            : undefined;
        const owner = config.entities.find(candidate => candidate.entityId === holder?.entityId);
        if (holder?.display !== undefined && owner !== undefined) {
            const key = `${ruleId}/${memberId ?? ''}`;
            return { key, entity: owner, holder, rule, target: selectedFlowTarget };
        }
    }

    return { key: entity.entityId, entity, holder: entity, rule: undefined, target: null };
};

/** Where a display set in the flow lives, said the way the flow tab says it. */
const describeTarget = view => {
    const label = view.rule.label || view.rule.id;
    const action = view.rule.action;
    if (action.do === 'loop') {
        const position = action.members.findIndex(member => member.id === view.target.memberId);
        return `the rule “${label}”, rotation member ${position + 1}`;
    }
    return `the rule “${label}”`;
};

const flowDisplayHeader = (view, context) => make('div', {}, [
    make('p', {
        class: 'caveat',
        textContent: `How ${view.entity.entityId} is drawn in ${describeTarget(view)} only. `
            + 'Everywhere else it uses its own display.',
    }),
    make('div', { class: 'row' }, [
        make('button', {
            class: 'small',
            type: 'button',
            textContent: '← back to the flow',
            onClick: () => context.showTab('flow'),
        }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: `edit ${view.entity.entityId}’s own display`,
            onClick: () => context.selectEntity(view.entity.entityId),
        }),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: 'use its own display here',
            onClick: () => {
                delete view.holder.display;
                forgetDrafts(view.key);
                context.showTab('flow');
                context.changed();
            },
        }),
    ]),
]);

export const renderDisplay = (root, context) => {
    const { config } = context;
    root.className = 'split';

    if (config.entities.length === 0) {
        root.className = '';
        root.append(card('Display', [
            make('p', {
                class: 'empty',
                textContent: 'No entities yet — add one on the Entities tab first.',
            }),
        ]), outputCard(context, () => {}));
        return;
    }

    const view = findView(context);
    const { node, refresh } = previewCard(view, context);

    const ids = config.entities.map(candidate => candidate.entityId);
    const heading = view.target !== null
        ? flowDisplayHeader(view, context)
        : field('entity', createLocalPicker({
            ids,
            value: view.entity.entityId,
            placeholder: 'pick an entity',
            onPick: entityId => context.selectEntity(entityId),
        }));

    const left = card(view.target !== null ? 'Display in the flow' : 'Display', [
        heading,
        make('div', { style: 'height:14px' }),
        displayFields(view, context, refresh),
    ]);

    root.append(
        make('div', { style: 'display:grid;gap:20px' }, [left, outputCard(context, refresh)]),
        node,
    );
};
