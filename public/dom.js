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

export const card = (title, children) => make('section', { class: 'card' }, [
    title === null ? null : make('h2', { textContent: title }),
    ...children,
]);

export const field = (labelText, control) =>
    make('label', { class: 'field' }, [labelText, control]);

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
