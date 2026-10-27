/** The smallest thing that makes building elements readable without a framework. */

export const make = (tag, properties = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(properties)) {
        if (key === 'class') {
            node.className = value;
        } else if (key === 'dataset') {
            Object.assign(node.dataset, value);
        } else if (key.startsWith('on')) {
            node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key in node) {
            node[key] = value;
        } else {
            node.setAttribute(key, value);
        }
    }
    for (const child of children) {
        if (child === null || child === undefined || child === false) {
            continue;
        }
        const appended = typeof child === 'string' ? document.createTextNode(child) : child;
        node.append(appended);
    }
    return node;
};

/**
 * Drawn rather than typed: a `↑` or `×` is whatever the font makes of it, and
 * sits on a different baseline in every one.
 */
const ICON_PATHS = {
    up: 'M4 10l4-4 4 4',
    down: 'M4 6l4 4 4-4',
    close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
    help: 'M6.2 6.2a1.9 1.9 0 1 1 2.6 1.75c-.5.22-.8.6-.8 1.15v.4M8 11.6v.1',
    edit: 'M10.5 3.5l2 2L6 12H4v-2z',
};

export const icon = name => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    if (name === 'help') {
        const ring = document.createElementNS(svg.namespaceURI, 'circle');
        ring.setAttribute('cx', '8');
        ring.setAttribute('cy', '8');
        ring.setAttribute('r', '6.25');
        svg.append(ring);
    }
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', ICON_PATHS[name]);
    svg.append(path);
    return svg;
};

/** A square button that is only an icon, so it has to say what it does. */
export const iconButton = (name, label, properties = {}) => make('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    ...properties,
    class: `icon-button ${properties.class ?? ''}`.trim(),
}, [icon(name)]);

/**
 * Which explanations are open, by card title. Kept outside the cards because
 * almost every edit re-renders the tab, and help that snapped shut each time
 * you changed something would be no help.
 */
const openHelp = new Set();

let nextHelpId = 0;

/**
 * Every explanation lives behind the `?` on its card, so the editor shows
 * controls and readings and nothing else until you ask.
 */
const helpFor = (title, help) => {
    nextHelpId += 1;
    const id = `help-${nextHelpId}`;
    const isOpen = openHelp.has(title);
    const panel = make('div', { class: 'help', id, hidden: !isOpen }, help.map(part =>
        typeof part === 'string' ? make('p', { textContent: part }) : part
    ));
    const toggle = make('button', {
        type: 'button',
        class: 'help-toggle',
        title: isOpen ? 'Hide the explanation' : 'What is this?',
        'aria-label': `About ${title}`,
        'aria-expanded': String(isOpen),
        'aria-controls': id,
        onClick: () => {
            const opening = panel.hidden;
            panel.hidden = !opening;
            toggle.setAttribute('aria-expanded', String(opening));
            toggle.title = opening ? 'Hide the explanation' : 'What is this?';
            if (opening) {
                openHelp.add(title);
            } else {
                openHelp.delete(title);
            }
        },
    }, [icon('help')]);
    return { toggle, panel };
};

export const card = (title, children, help) => {
    if (title === null) {
        return make('section', { class: 'card' }, children);
    }
    const explained = help === undefined ? null : helpFor(title, help);
    return make('section', { class: 'card' }, [
        make('div', { class: 'card-head' }, [
            make('h2', { textContent: title }),
            explained?.toggle,
        ]),
        explained?.panel,
        ...children,
    ]);
};

export const field = (labelText, control) =>
    make('label', { class: 'field' }, [labelText, control]);

/**
 * A slider whose label carries its current value. The number is updated in
 * place, because re-rendering on every `input` event replaces the slider under
 * the pointer and ends the drag.
 */
export const sliderField = (name, value, onValue) => {
    const reading = make('span', { class: 'field-value', textContent: String(value) });
    const slider = make('input', {
        type: 'range',
        min: '0',
        max: '255',
        value,
        onInput: event => {
            const next = Number(event.target.value);
            reading.textContent = String(next);
            onValue(next);
        },
    });
    return make('label', { class: 'field' }, [
        make('span', { class: 'field-label' }, [name, reading]),
        slider,
    ]);
};

export const option = (value, text, selected) =>
    make('option', { value, textContent: text, selected });

/** `[255, 160, 0]` and `#ffa000` are the same colour in two notations. */
export const toHex = ([red, green, blue]) => {
    const parts = [red, green, blue].map(channel => {
        const clamped = Math.max(0, Math.min(255, Math.round(channel)));
        return clamped.toString(16).padStart(2, '0');
    });
    return `#${parts.join('')}`;
};

export const fromHex = hex => {
    const text = hex.replace('#', '');
    const red = parseInt(text.slice(0, 2), 16);
    const green = parseInt(text.slice(2, 4), 16);
    const blue = parseInt(text.slice(4, 6), 16);
    return [red, green, blue];
};
