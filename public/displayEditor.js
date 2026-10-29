import { card, field, fromHex, iconButton, make, option, toHex } from '/dom.js';
import {
    resolveTextSettings,
    TEXT_SETTINGS,
    TEXT_SETTINGS_HELP,
} from '/textSettings.js';
import { postJson, requestJson } from '/api.js';
import { createLocalPicker } from '/picker.js';
import { createIconPainter } from '/iconPainter.js';
import { decodeLedEntries } from '/ledEntries.js';
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
    scrollsVertically: 'a y offset of exactly 0 or 255 makes text that fits scroll up or down',
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

/**
 * Which placeholders are worth offering for this entity: a temperature has no
 * artist, and a media player's title is the one you came for.
 */
const placeholdersFor = entity => {
    const tokens = ['{{value}}'];
    if (entity.kind === 'percent') {
        tokens.push('{{percent}}', '{{unit}}');
    }
    if (entity.kind === 'temperature') {
        tokens.push('{{degrees}}', '{{unit}}');
    }
    if (entity.entityId.startsWith('media_player.')) {
        tokens.push('{{title}}', '{{artist}}');
    }
    return tokens;
};

/**
 * Placeholders you click rather than type, inserted at the caret. Typing one
 * wrong is the most common way to get a literal `{{percentage}}` scrolling
 * across the panel; the full list stays in the card's help.
 */
const placeholderChips = (entity, control) => make('div', { class: 'chips' }, [
    make('span', { class: 'quiet', textContent: 'Insert' }),
    ...placeholdersFor(entity).map(token => make('button', {
        type: 'button',
        class: 'chip',
        textContent: token,
        title: PLACEHOLDER_HELP.find(([name]) => name === token)?.[1] ?? token,
        // Keeps the caret where it was, which is where the token goes.
        onMouseDown: event => event.preventDefault(),
        onClick: () => {
            const start = control.selectionStart ?? control.value.length;
            const end = control.selectionEnd ?? start;
            control.focus();
            control.setRangeText(token, start, end, 'end');
            control.dispatchEvent(new Event('input', { bubbles: true }));
        },
    })),
]);

const WHITE = [255, 255, 255];

const preview = createPanelPreview();
const samples = new Map();

/**
 * The JSON as typed, per view, so that a keystroke that has not finished
 * being valid JSON yet is not thrown away. The draft is what the textarea
 * shows; `display.payload` only moves on when it parses.
 */
const drafts = new Map();

/** What a choice by state falls back to, which is what a change of style keeps. */
const plainOf = display => display.style === 'byState' ? display.otherwise : display;

/** A custom display's segments live in its body, so this has to dig one out. */
const segmentIdOf = display => {
    if (display.style === 'iconText') {
        return 0;
    }
    if (display.style !== 'custom') {
        return display.segmentId;
    }
    const first = display.payload.seg?.[0];
    return first?.id ?? 0;
};

/** `fonts.ts`'s `fontSliderOf`: the lowest `c2` that selects each font. */
const FONT_SLIDERS = [0, 64, 128, 192, 255];

/** `fonts.ts`'s `rotationSliderOf`: the lowest `c3` that selects each rotation. */
const ROTATION_SLIDERS = { upsideDown: 0, clockwise: 8, normal: 16, counterClockwise: 24 };

/**
 * What switching to `custom` starts from: the body the `text` style would have
 * sent for this entity, its template and its resolved settings included. An
 * empty object would be a worse start — you would have to know the effect id,
 * which sliders matter and that every one of them has to be pinned before
 * anything appeared on the panel at all.
 */
const customSeed = (display, segmentId, settings) => ({
    on: true,
    seg: [{
        id: segmentId,
        fx: 122,
        n: display.text ?? '{{value}}',
        sx: settings.speed,
        ix: settings.yOffset,
        c1: settings.trail,
        c2: FONT_SLIDERS[settings.font],
        c3: ROTATION_SLIDERS[settings.rotation],
        o1: settings.gradient,
        o3: settings.reverse,
        col: [settings.color, [0, 0, 0], settings.gradientColor],
    }],
});

const PANEL_COLUMNS = 32;
const PANEL_ROWS = 8;

/** Which font a raw `c2` picks: WLED maps 0-255 onto 0-4, truncating. */
const fontOfSlider = slider => {
    const clamped = Math.max(0, Math.min(255, Number(slider) || 0));
    return Math.trunc(clamped * 4 / 255);
};

/**
 * A custom body written the way every glyph was before this style existed —
 * pixels in one segment's `i`, a segment name in another — read back into an
 * icon and its text, so switching one over keeps the picture. A pixel segment
 * with bounds of its own is indexed across those bounds, not the panel.
 */
const iconTextFromCustom = display => {
    if (display.style !== 'custom') {
        return undefined;
    }
    const segments = Array.isArray(display.payload.seg) ? display.payload.seg : [];
    const picture = segments.find(segment => Array.isArray(segment?.i));
    const named = segments.find(segment => segment !== picture && typeof segment?.n === 'string');
    if (picture === undefined || named === undefined) {
        return undefined;
    }

    const left = picture.start ?? 0;
    const width = (picture.stop ?? PANEL_COLUMNS) - left;
    const top = picture.startY ?? 0;
    const own = decodeLedEntries(picture.i, width * PANEL_ROWS);
    const pixels = new Array(PANEL_COLUMNS * PANEL_ROWS).fill('000000');
    own.forEach((color, index) => {
        const row = top + Math.floor(index / width);
        const column = left + (index % width);
        if (row < PANEL_ROWS && column < PANEL_COLUMNS) {
            pixels[row * PANEL_COLUMNS + column] = color;
        }
    });

    const firstColour = named.col?.[0];
    const textStart = Math.max(1, Math.min(PANEL_COLUMNS - 1, named.start ?? 8));
    /**
     * Everything the body said is kept as this view's own, because a body
     * written by hand said it on purpose. What it left out follows the global.
     */
    const settings = {
        color: Array.isArray(firstColour) ? firstColour.slice(0, 3) : WHITE,
        speed: named.sx ?? 128,
        font: fontOfSlider(named.c2),
        yOffset: named.ix ?? 128,
    };
    return {
        style: 'iconText',
        pixels,
        textStart,
        text: named.n === '' ? '{{value}}' : named.n,
        settings,
    };
};

/** Which of the four styles keeps its own text settings. */
const drawsText = display => display.style === 'text' || display.style === 'iconText';

/**
 * The colour a display is showing right now, wherever it keeps it — which for
 * a text view is the global unless it overrides it, and for a custom one is
 * inside the body it owns, so there is nothing to find.
 */
const colourOf = (display, global) => {
    if (drawsText(display)) {
        const settings = resolveTextSettings(global, display.settings);
        return settings.color;
    }
    return display.color ?? global.color;
};

const sameColour = (one, other) => JSON.stringify(one) === JSON.stringify(other);

/**
 * Keeping the segment and the colour across a style change: being made to pick
 * a colour again because you changed how the value is drawn reads as the
 * editor having forgotten it. Everything else a new text view takes from the
 * global, so it is one override rather than a copy of all nine — and a colour
 * the global already has is left to the global too.
 */
const toStyle = (style, current, global) => {
    if (style === 'byState') {
        return { style: 'byState', cases: [], otherwise: structuredClone(plainOf(current)) };
    }

    const display = plainOf(current);
    const segmentId = segmentIdOf(display);
    const color = colourOf(display, global);
    const keptColour = sameColour(color, global.color) ? {} : { color };

    if (style === 'bar') {
        return { style: 'bar', segmentId, color, trackColor: [0, 20, 40] };
    }
    if (style === 'text') {
        return { style: 'text', segmentId, text: '{{value}}', settings: keptColour };
    }
    if (style === 'iconText') {
        const converted = iconTextFromCustom(display);
        if (converted !== undefined) {
            return converted;
        }
        const text = display.text ?? '{{value}}';
        const pixels = new Array(PANEL_COLUMNS * PANEL_ROWS).fill('000000');
        return { style: 'iconText', pixels, textStart: 9, text, settings: keptColour };
    }

    const own = drawsText(display) ? display.settings : {};
    const settings = resolveTextSettings(global, { ...own, color });
    const payload = customSeed(display, segmentId, settings);
    return { style: 'custom', payload };
};

/**
 * One view's text settings: each follows the global until it is overridden,
 * and the control shows the value in force either way. Taking an override on
 * copies the global's current value, so the panel does not change until you
 * then edit it; letting it go deletes the key, which is what the service reads
 * as "follow the global".
 *
 * The toggle sits outside the `<label>` on purpose — a button inside one
 * activates the label's own control as well as itself.
 */
const overrideFields = (settings, global, context, refresh) =>
    TEXT_SETTINGS.map(setting => {
        const { name, label } = setting;
        const isOwn = settings[name] !== undefined;
        const effective = isOwn ? settings[name] : global[name];

        const control = setting.build(label, effective, value => {
            settings[name] = value;
            context.edited();
            refresh();
        });
        if (!isOwn) {
            for (const input of control.querySelectorAll('input, select')) {
                input.disabled = true;
            }
        }

        const toggle = make('button', {
            class: 'small',
            type: 'button',
            textContent: isOwn ? 'its own' : 'global',
            title: isOwn
                ? 'Go back to the global setting on the Settings tab'
                : 'Override this for this view only',
            onClick: () => {
                if (isOwn) {
                    delete settings[name];
                } else {
                    settings[name] = structuredClone(global[name]);
                }
                context.changed();
            },
        });

        return make('div', { class: isOwn ? 'setting own' : 'setting' }, [control, toggle]);
    });

/** The override block both text styles end with. */
const textSettingsCard = (display, context, refresh) => {
    const global = context.config.textSettings;
    return card('How this view looks', [
        make('div', { class: 'fields' }, overrideFields(display.settings, global, context, refresh)),
    ], [
        'Each setting follows the global on the Settings tab until you press its '
            + 'button to take it over here, so a change to the global reaches this view '
            + 'for everything it has not taken over.',
        'Taking one over copies the global\u2019s current value, so nothing changes on the '
            + 'panel until you then edit it. Pressing the button again hands it back.',
        ...TEXT_SETTINGS_HELP,
    ]);
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
        placeholderChips(view.entity, editor),
        failure,
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

const CASE_TESTS = {
    is: 'is one of',
    above: 'is above',
    below: 'is below',
};

/**
 * Switching a case between listing states and comparing a number swaps which
 * field it carries, so a saved one never holds both — the validator would
 * refuse the leftover.
 */
const setCaseTest = (stateCase, test) => {
    stateCase.test = test;
    if (test === 'is') {
        delete stateCase.value;
        stateCase.states = stateCase.states ?? [];
        return;
    }
    delete stateCase.states;
    stateCase.value = stateCase.value ?? 0;
};

const caseButtons = (view, cases, index, context) => {
    const move = offset => {
        const [moved] = cases.splice(index, 1);
        cases.splice(index + offset, 0, moved);
        forgetDrafts(view.key);
        context.changed();
    };
    return [
        iconButton('up', 'Check this case earlier', {
            disabled: index === 0,
            onClick: () => move(-1),
        }),
        iconButton('down', 'Check this case later', {
            disabled: index === cases.length - 1,
            onClick: () => move(1),
        }),
        iconButton('trash', 'Delete this case', {
            class: 'danger',
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
            value: stateCase.states?.join(', ') ?? '',
            placeholder: 'sunny, clear-night',
            onInput: event => {
                const parts = event.target.value.split(',').map(part => part.trim());
                stateCase.states = parts.filter(part => part !== '');
                context.edited();
                refresh();
            },
        });

        const threshold = make('input', {
            type: 'number',
            step: 'any',
            value: stateCase.value ?? '',
            placeholder: '0',
            onInput: event => {
                // A half-typed number ("-") is kept as it was rather than
                // saved as 0, which would quietly move the threshold.
                if (event.target.value === '') {
                    return;
                }
                stateCase.value = Number(event.target.value);
                context.edited();
                refresh();
            },
        });

        const testPicker = make('select', {
            // Not shrunk by the field beside it, which would cut "is one of".
            style: 'width:auto;flex:none',
            onChange: event => {
                setCaseTest(stateCase, event.target.value);
                context.changed();
            },
        }, Object.entries(CASE_TESTS).map(([value, text]) => option(value, text, value === stateCase.test)));

        return make('div', { class: 'state-case' }, [
            make('div', { class: 'rule-head' }, [
                make('span', { class: 'keyword', textContent: index === 0 ? 'WHEN' : 'ELSE WHEN' }),
                testPicker,
                make('div', { style: 'flex:1;min-width:120px' }, [stateCase.test === 'is' ? states : threshold]),
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
        class: 'small ghost',
        type: 'button',
        textContent: '+ case',
        onClick: () => {
            // Starts as a copy of `otherwise`, so a new case changes nothing
            // until it is edited, rather than drawing a default nobody chose.
            display.cases.push({ test: 'is', states: [], display: structuredClone(display.otherwise) });
            context.changed();
        },
    });

    return make('div', {}, [
        make('div', { class: 'fields', style: 'margin-bottom:14px' }, headerFields.filter(Boolean)),
        ...caseBlocks,
        make('div', { class: 'row adders', style: 'margin:4px 0 12px' }, [addCase]),
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
        option('iconText', 'icon and text', display.style === 'iconText'),
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
            holder.display = toStyle(style, display, context.config.textSettings);
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
            make('div', { class: 'fields', style: 'margin-bottom:14px' }, [
                format,
                field('drawn as', stylePicker),
            ].filter(Boolean)),
            customFields(view, context, refresh),
        ]);
    }


    /**
     * The template gets a row of its own: it is the one field here you type
     * into, and the placeholders that go in it sit right under it.
     */
    const templateRow = () => {
        const template = make('input', {
            type: 'text',
            class: 'mono',
            value: display.text,
            placeholder: '{{value}}',
            onInput: event => {
                display.text = event.target.value;
                edited();
            },
        });
        return make('div', { class: 'template' }, [field('text', template), placeholderChips(entity, template)]);
    };

    if (display.style === 'iconText') {
        const painter = createIconPainter({
            key: view.key,
            pixels: display.pixels,
            textStart: display.textStart,
            onChange: edited,
        });
        const textStart = make('input', {
            type: 'number',
            min: '1',
            max: String(PANEL_COLUMNS - 1),
            value: display.textStart,
            onInput: event => {
                const column = Number(event.target.value);
                // Half-typed or out of range is left as it was, as a threshold is.
                if (!Number.isInteger(column) || column < 1 || column > PANEL_COLUMNS - 1) {
                    return;
                }
                display.textStart = column;
                painter.setTextStart(column);
                edited();
            },
        });
        return make('div', { class: 'display-fields' }, [
            painter.node,
            templateRow(),
            make('div', { class: 'fields' }, [
                format,
                field('drawn as', stylePicker),
                field('text starts at column', textStart),
            ].filter(Boolean)),
            textSettingsCard(display, context, refresh),
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

    const fields = [
        format,
        field('drawn as', stylePicker),
        field('segment', segment),
    ].filter(Boolean);

    if (display.style === 'bar') {
        // A bar's colours are its own: they are not text, so the text
        // settings have nothing to say about them.
        fields.push(field('colour', make('input', {
            type: 'color',
            value: toHex(display.color),
            onInput: event => {
                display.color = fromHex(event.target.value);
                edited();
            },
        })));
        fields.push(field('track colour', make('input', {
            type: 'color',
            value: toHex(display.trackColor),
            onInput: event => {
                display.trackColor = fromHex(event.target.value);
                edited();
            },
        })));
        return make('div', { class: 'fields' }, fields);
    }

    return make('div', { class: 'display-fields' }, [
        templateRow(),
        make('div', { class: 'fields' }, fields),
        textSettingsCard(display, context, refresh),
    ]);
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
        return `No case matches “${sample.value}”, so “otherwise” is drawn.`;
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

        /**
         * The settings as the server resolved them, not as this tab is editing
         * them: for a display chosen by state that is the matched case's, and
         * for any of them it is the global with the view's own already on top.
         */
        if (display.style === 'iconText') {
            const columns = PANEL_COLUMNS - display.textStart;
            const movement = result.textLayout.motion === 'across' ? 'scrolls' : 'fits';
            nodes.readout.textContent = `"${result.text}" — ${result.textLayout.width} of the ${columns} `
                + `columns from ${display.textStart}, so it ${movement}`;
            preview.show({
                kind: 'iconText',
                pixels: display.pixels,
                textStart: display.textStart,
                layout: result.textLayout,
                settings: result.textSettings,
            });
            return;
        }

        if (display.style === 'bar') {
            nodes.readout.textContent = `a bar at ${result.percent ?? 0}%`;
            preview.show({
                kind: 'bar',
                percent: result.percent ?? 0,
                color: display.color,
                trackColor: display.trackColor,
            });
            return;
        }

        const movement = result.textLayout.motion === 'across' ? 'scrolls' : 'fits';
        nodes.readout.textContent = `"${result.text}" — ${result.length} of 32 characters, `
            + `${result.textLayout.width} of 32 columns wide, so it ${movement}`;
        preview.show({
            kind: 'text',
            layout: result.textLayout,
            settings: result.textSettings,
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

const PREVIEW_HELP = [
    'A mock-up of the 32×8 panel, drawn by the same code that builds what the device is '
        + 'sent — so the text, its length, and whether it scrolls are exact.',
    'Letterforms are approximate: the device uses its own font, which a browser cannot '
        + 'draw. A bar is drawn as a proportion of the 32 columns, as the device does.',
    'A custom body has no mock-up: nothing here knows which effects it asks for or how it '
        + 'divides the segments. “What gets sent” is exactly what the device receives.',
    'The sample value stands in for the entity’s state, so you can try a long title, or a '
        + 'state a display chosen by state reacts to. The built-in time and date need none: '
        + 'they read this machine’s clock, and the service redraws them as the minute turns.',
];

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
        choice: make('p', { class: 'choice', hidden: true }),
        readout: make('div', { class: 'hint readout' }),
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

    refresh();

    const samplesRow = isBuiltin ? null : make('div', { class: 'fields' }, [
        field(isByState ? 'sample state' : 'sample value', sampleInput),
        artistInput === null ? null : field('sample artist', artistInput),
    ].filter(Boolean));

    const sent = make('details', { class: 'sent' }, [
        make('summary', { textContent: 'What gets sent' }),
        nodes.payload,
    ]);

    const node = card('Preview', [
        make('div', { class: 'preview' }, [
            preview.canvas,
            nodes.readout,
            nodes.choice,
            nodes.warnings,
            nodes.problem,
            samplesRow,
            sent,
        ]),
    ], PREVIEW_HELP);

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
        return `“${label}”, rotation member ${position + 1}`;
    }
    return `“${label}”`;
};

/**
 * Said rather than explained: which display this is decides what an edit
 * changes, so it stays in view where the help would not.
 */
const flowDisplayHeader = (view, context) => make('div', { class: 'flow-target' }, [
    make('p', { class: 'hint' }, [
        make('span', { class: 'mono', textContent: view.entity.entityId }),
        ` as drawn in ${describeTarget(view)} only.`,
    ]),
    make('div', { class: 'row' }, [
        make('button', {
            class: 'small',
            type: 'button',
            textContent: 'Back to the flow',
            onClick: () => context.showTab('flow'),
        }),
        make('button', {
            class: 'small',
            type: 'button',
            textContent: 'Edit its own display',
            title: `How ${view.entity.entityId} looks everywhere else`,
            onClick: () => context.selectEntity(view.entity.entityId),
        }),
        make('button', {
            class: 'small danger',
            type: 'button',
            textContent: 'Use its own display here',
            onClick: () => {
                delete view.holder.display;
                forgetDrafts(view.key);
                context.showTab('flow');
                context.changed();
            },
        }),
    ]),
]);

/** The explanation follows the style being edited, so it never has to say "if". */
const STYLE_HELP = {
    text: [
        'Scrolling text draws the template. Anything around a placeholder is drawn as '
            + 'written, so "PV {{value}}W" is a prefix and a suffix. A media title too long '
            + 'for the panel is tried again without its artist before anything is cut.',
    ],
    bar: [
        'A bar fills from the left in proportion to the reading, so it needs an entity read '
            + 'as a percentage.',
    ],
    iconText: [
        'A picture on segment 0, across the whole panel, and the template on segment 1 from '
            + 'the column you choose. The text is blended over the picture with Lighten, so the '
            + 'picture may run on under it: wherever the text is unlit, the picture shows.',
        'Paint with the mouse; b, e, f and i pick the tool while the painter has focus, and '
            + 'Ctrl/Cmd+Z undoes a stroke. Switching a custom body that draws pixels and a name '
            + 'to this style reads its picture and text back in.',
    ],
    custom: [
        'A whole WLED /json/state body. Segments other entities use are switched off for '
            + 'you; "on" and "bri" are filled in only if you leave them out. Every "seg" entry '
            + 'needs a literal "id".',
        'A string that is nothing but one placeholder takes that value’s own type, so '
            + '"ix": "{{percent}}" arrives as a number. Anywhere else it is text.',
    ],
    byState: [
        'Read top to bottom: the first case the entity’s raw state matches is drawn, and '
            + '“otherwise” when none does. “is one of” compares exactly — “sunny”, '
            + '“clear-night”, “playing”. “is above” and “is below” read the state as a number; '
            + 'one that is not a number matches neither.',
        'A picture for a state is an “icon and text” case — the device’s fonts are ASCII '
            + 'only, so a picture is pixels.',
    ],
};

const displayHelp = view => {
    const style = view.holder.display.style;
    return [
        view.target === null
            ? 'How this entity looks wherever the flow shows it. A rule or rotation member can '
                + 'draw it differently in its own place, with “own view…” on the Flow tab.'
            : 'How this entity looks in one place in the flow. Everywhere else it uses its own '
                + 'display.',
        ...STYLE_HELP[style],
        style === 'bar' ? null : 'The placeholders:',
        style === 'bar' ? null : placeholderHelp(),
        style === 'custom' || style === 'iconText'
            ? null
            : 'The segment is the WLED segment it draws on; 0 is the whole panel.',
    ].filter(Boolean);
};

export const renderDisplay = (root, context) => {
    const { config } = context;
    root.className = 'split';

    if (config.entities.length === 0) {
        root.className = 'narrow';
        root.append(card('Display', [
            make('p', { class: 'empty' }, [
                'Nothing to style yet. ',
                make('button', {
                    type: 'button',
                    class: 'link',
                    textContent: 'Add an entity',
                    onClick: () => context.showTab('entities'),
                }),
                ' first.',
            ]),
        ]));
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
        make('div', { class: 'divider' }),
        displayFields(view, context, refresh),
    ], displayHelp(view));

    root.append(left, node);
};
