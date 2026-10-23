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
    ['{{value}}', 'what the text style would have drawn: 18C, 64%, a media title'],
    ['{{percent}}', '0-100 — the number a Percent segment wants in ix'],
    ['{{degrees}}', 'the temperature, rounded'],
    ['{{unit}}', 'the entity’s unit, e.g. C'],
    ['{{title}}', 'a media player’s title on its own'],
    ['{{artist}}', 'a media player’s artist on its own'],
];

const WHITE = [255, 255, 255];

const preview = createPanelPreview();
const samples = new Map();

/**
 * The JSON as typed, per entity, so that a keystroke that has not finished
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
 * sent for this entity. An empty object would be a worse start — you would have
 * to know the effect id, which sliders matter and that `ix` and `c2` have to be
 * pinned before anything appeared on the panel at all.
 */
const customSeed = (display, segmentId, color) => ({
    on: true,
    seg: [{
        id: segmentId,
        fx: 122,
        n: '{{value}}',
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
const toStyle = (style, display) => {
    const segmentId = segmentIdOf(display);
    const color = display.color ?? WHITE;

    if (style === 'bar') {
        return { style: 'bar', segmentId, color, trackColor: [0, 20, 40] };
    }
    if (style === 'text') {
        return { style: 'text', segmentId, color, speed: 70 };
    }
    const payload = customSeed(display, segmentId, color);
    return { style: 'custom', payload };
};

const customFields = (entity, context, refresh) => {
    const display = entity.display;
    const stored = drafts.get(entity.entityId);
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
            drafts.set(entity.entityId, next);

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

    const help = PLACEHOLDER_HELP.map(([token, meaning]) =>
        make('div', { class: 'token' }, [
            make('code', { textContent: token }),
            make('span', { textContent: meaning }),
        ])
    );

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
        make('div', { class: 'tokens' }, help),
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

const displayFields = (entity, context, refresh) => {
    const display = entity.display;

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
    ].filter(Boolean);

    const stylePicker = make('select', {
        onChange: event => {
            const style = event.target.value;
            if (style === display.style) {
                return;
            }
            // The draft belongs to the body being replaced, so keeping it would
            // put the old JSON back the next time `custom` was chosen.
            drafts.delete(entity.entityId);
            entity.display = toStyle(style, display);
            context.changed();
        },
    }, styles);

    const format = !isBuiltin ? null : formatField(entity, context);

    if (display.style === 'custom') {
        return make('div', {}, [
            make('div', { class: 'fields' }, [
                format,
                field('drawn as', stylePicker),
            ].filter(Boolean)),
            make('div', { style: 'height:14px' }),
            customFields(entity, context, refresh),
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
        fields.push(field('prefix', make('input', {
            type: 'text',
            value: display.prefix ?? '',
            placeholder: 'e.g. "bat "',
            onInput: event => {
                const text = event.target.value;
                if (text === '') {
                    delete display.prefix;
                } else {
                    display.prefix = text;
                }
                edited();
            },
        })));
    }

    return make('div', { class: 'fields' }, fields);
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

const refreshPreview = async (entity, sample, nodes, context) => {
    const unit = entity.kind === 'temperature' ? 'C' : entity.kind === 'percent' ? '%' : '';
    try {
        const result = await postJson('/api/preview', {
            entityId: entity.entityId,
            sampleValue: sample.value,
            sampleArtist: sample.artist,
            unit,
            entities: context.config.entities,
        });

        nodes.problem.hidden = true;
        nodes.payload.textContent = JSON.stringify(result.payload, null, 2);

        nodes.warnings.replaceChildren(...result.warnings.map(name =>
            make('span', { class: 'warning', textContent: WARNING_TEXT[name] ?? name })
        ));

        if (entity.display.style === 'custom') {
            nodes.readout.replaceChildren(...describeCustom(result));
            // Nothing honest to draw: the mock-up knows one scrolling string or
            // one bar across the whole panel, and a custom body is neither.
            preview.show(null);
            return;
        }

        nodes.readout.textContent = `segment name "${result.text}" — ${result.length} of 32 `
            + `characters, ${result.visible} visible at once`;

        if (entity.display.style === 'bar') {
            preview.show({
                kind: 'bar',
                percent: result.percent ?? 0,
                color: entity.display.color,
                trackColor: entity.display.trackColor,
            });
            return;
        }

        preview.show({
            kind: 'text',
            text: result.text,
            visible: result.visible,
            color: entity.display.color,
            speed: entity.display.speed,
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
const previewCard = (entity, context) => {
    const stored = samples.get(entity.entityId);
    const sample = stored ?? { value: SAMPLES[entity.kind] ?? '', artist: '' };

    const nodes = {
        readout: make('div', { class: 'caveat' }),
        warnings: make('div', { class: 'warnings' }),
        problem: make('p', { class: 'warning', hidden: true }),
        payload: make('pre', { class: 'payload' }),
    };

    const refresh = () => {
        void refreshPreview(entity, sample, nodes, context);
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

    const caveat = CAVEATS[entity.display.style];

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
            entity.display.style === 'custom' ? null : preview.canvas,
            make('p', { class: 'caveat', textContent: caveat }),
            clockNote,
            isBuiltin ? null : field('sample value', sampleInput),
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

export const renderDisplay = (root, context) => {
    const { config, selectedEntityId } = context;
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

    const entity = config.entities.find(candidate => candidate.entityId === selectedEntityId)
        ?? config.entities[0];

    const ids = config.entities.map(candidate => candidate.entityId);
    const picker = createLocalPicker({
        ids,
        value: entity.entityId,
        placeholder: 'pick an entity',
        onPick: entityId => context.selectEntity(entityId),
    });

    const { node, refresh } = previewCard(entity, context);

    const left = card('Display', [
        field('entity', picker),
        make('div', { style: 'height:14px' }),
        displayFields(entity, context, refresh),
    ]);

    root.append(
        make('div', { style: 'display:grid;gap:20px' }, [left, outputCard(context, refresh)]),
        node,
    );
};
