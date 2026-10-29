import { make } from '/dom.js';

/**
 * A pixel painter for an `iconText` display's picture: the whole 32x8 panel,
 * with the columns its text is drawn over shaded, because the picture may run
 * on under the text.
 *
 * Lifted from wled-matrix-painter's `app.js` — the canvas, the brush, flood
 * fill, the line that fills a fast drag's gaps and undo — and turned from a
 * page of its own into something the Display tab can build as often as it
 * re-renders. It edits the display's `pixels` array in place.
 */

const COLUMNS = 32;
const ROWS = 8;
const OFF = '000000';
const MAXIMUM_UNDO_STEPS = 50;

const SWATCHES = [
    'FF0000', 'FF7F00', 'FFBF00', 'FFFF00',
    '00FF00', '00FFBF', '00FFFF', '007FFF',
    '0000FF', '7F00FF', 'FF00FF', 'FF7FBF',
    'FFFFFF', 'BFBFBF', '7F4020', '000000',
];

const TOOLS = [
    ['paint', 'Paint', 'b'],
    ['erase', 'Erase', 'e'],
    ['fill', 'Fill', 'f'],
    ['pick', 'Pick a colour', 'i'],
];

/**
 * Kept outside the painter, which every re-render of the tab rebuilds: the
 * brush you had and the strokes you can undo would otherwise go with it.
 */
const brush = { tool: 'paint', color: 'FFC800' };
const undoStacks = new Map();

export const createIconPainter = ({ key, pixels, textStart, onChange }) => {
    const canvas = make('canvas', { class: 'painter-grid' });
    const context = canvas.getContext('2d');
    const undoStack = undoStacks.get(key) ?? [];
    undoStacks.set(key, undoStack);
    let shadedFrom = textStart;

    const draw = () => {
        const cell = 16;
        const ratio = globalThis.devicePixelRatio || 1;
        canvas.width = COLUMNS * cell * ratio;
        canvas.height = ROWS * cell * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        context.fillStyle = '#0b0d10';
        context.fillRect(0, 0, COLUMNS * cell, ROWS * cell);

        for (let y = 0; y < ROWS; y++) {
            for (let x = 0; x < COLUMNS; x++) {
                const color = pixels[y * COLUMNS + x];
                context.fillStyle = `#${color}`;
                context.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
                if (color === OFF) {
                    context.strokeStyle = '#20242b';
                    context.lineWidth = 1;
                    context.strokeRect(x * cell + 1.5, y * cell + 1.5, cell - 3, cell - 3);
                }
            }
        }

        context.fillStyle = 'rgba(95, 176, 255, 0.08)';
        context.fillRect(shadedFrom * cell, 0, (COLUMNS - shadedFrom) * cell, ROWS * cell);
        context.strokeStyle = 'rgba(95, 176, 255, 0.7)';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(shadedFrom * cell, 0);
        context.lineTo(shadedFrom * cell, ROWS * cell);
        context.stroke();
    };

    const pushUndo = () => {
        undoStack.push([...pixels]);
        if (undoStack.length > MAXIMUM_UNDO_STEPS) {
            undoStack.shift();
        }
    };

    const replacePixels = next => {
        pixels.splice(0, pixels.length, ...next);
    };

    const pointFromEvent = event => {
        const bounds = canvas.getBoundingClientRect();
        const cell = bounds.width / COLUMNS;
        const x = Math.floor((event.clientX - bounds.left) / cell);
        const y = Math.floor((event.clientY - bounds.top) / cell);
        return x >= 0 && y >= 0 && x < COLUMNS && y < ROWS ? { x, y } : undefined;
    };

    const applyBrush = (x, y) => {
        pixels[y * COLUMNS + x] = brush.tool === 'erase' ? OFF : brush.color;
    };

    const floodFill = (x, y) => {
        const target = pixels[y * COLUMNS + x];
        const replacement = brush.tool === 'erase' ? OFF : brush.color;
        if (target === replacement) {
            return;
        }

        const queue = [[x, y]];
        while (queue.length > 0) {
            const [currentX, currentY] = queue.pop();
            if (currentX < 0 || currentY < 0 || currentX >= COLUMNS || currentY >= ROWS) {
                continue;
            }
            const position = currentY * COLUMNS + currentX;
            if (pixels[position] !== target) {
                continue;
            }
            pixels[position] = replacement;
            queue.push([currentX + 1, currentY], [currentX - 1, currentY], [currentX, currentY + 1], [currentX, currentY - 1]);
        }
    };

    /** Fills the gaps a fast drag leaves between pointer events. */
    const strokeBetween = (from, to) => {
        let x = from.x;
        let y = from.y;
        const deltaX = Math.abs(to.x - x);
        const deltaY = -Math.abs(to.y - y);
        const stepX = x < to.x ? 1 : -1;
        const stepY = y < to.y ? 1 : -1;
        let error = deltaX + deltaY;

        while (true) {
            applyBrush(x, y);
            if (x === to.x && y === to.y) {
                return;
            }
            const doubledError = 2 * error;
            if (doubledError >= deltaY) {
                error += deltaY;
                x += stepX;
            }
            if (doubledError <= deltaX) {
                error += deltaX;
                y += stepY;
            }
        }
    };

    const finishStroke = () => {
        draw();
        onChange();
    };

    let painting = false;
    let lastPoint;

    const toolButtons = new Map();
    const colourInput = make('input', {
        type: 'color',
        title: 'Brush colour',
        value: `#${brush.color.toLowerCase()}`,
        onInput: event => {
            brush.color = event.target.value.slice(1).toUpperCase();
            if (brush.tool === 'erase' || brush.tool === 'pick') {
                selectTool('paint');
            }
        },
    });

    const selectTool = tool => {
        brush.tool = tool;
        for (const [name, button] of toolButtons) {
            button.classList.toggle('active', name === tool);
        }
    };

    const setColour = color => {
        brush.color = color;
        colourInput.value = `#${color.toLowerCase()}`;
    };

    const undo = () => {
        const previous = undoStack.pop();
        if (previous === undefined) {
            return;
        }
        replacePixels(previous);
        finishStroke();
    };

    canvas.addEventListener('pointerdown', event => {
        const point = pointFromEvent(event);
        if (!point) {
            return;
        }
        // Capture keeps a drag alive past the canvas edge, but painting must
        // still work if the browser refuses it.
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch {
            // Ignored on purpose.
        }

        if (brush.tool === 'pick') {
            const picked = pixels[point.y * COLUMNS + point.x];
            setColour(picked);
            selectTool('paint');
            return;
        }

        pushUndo();

        if (brush.tool === 'fill') {
            floodFill(point.x, point.y);
            finishStroke();
            return;
        }

        painting = true;
        lastPoint = point;
        applyBrush(point.x, point.y);
        draw();
    });

    canvas.addEventListener('pointermove', event => {
        const point = pointFromEvent(event);
        if (!painting || !point) {
            return;
        }
        strokeBetween(lastPoint ?? point, point);
        lastPoint = point;
        draw();
    });

    const endStroke = () => {
        if (!painting) {
            return;
        }
        painting = false;
        lastPoint = undefined;
        finishStroke();
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    const tools = TOOLS.map(([tool, label, shortcut]) => {
        const button = make('button', {
            type: 'button',
            class: 'small',
            textContent: label,
            title: `${label} (${shortcut})`,
            onClick: () => selectTool(tool),
        });
        toolButtons.set(tool, button);
        return button;
    });

    const swatches = SWATCHES.map(color => make('button', {
        type: 'button',
        class: 'swatch',
        title: `#${color}`,
        style: `background:#${color}`,
        onClick: () => {
            setColour(color);
            selectTool('paint');
        },
    }));

    const node = make('div', {
        class: 'painter',
        // Focusable, so the shortcuts are the painter's and not the page's.
        tabIndex: 0,
        onKeyDown: event => {
            if (event.target.matches('input, select, textarea')) {
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
                event.preventDefault();
                undo();
                return;
            }
            const shortcut = TOOLS.find(([, , letter]) => letter === event.key);
            if (shortcut !== undefined) {
                selectTool(shortcut[0]);
            }
        },
    }, [
        canvas,
        make('div', { class: 'row painter-tools' }, [
            ...tools,
            colourInput,
            make('button', { type: 'button', class: 'small', textContent: 'Undo', title: 'Undo (Ctrl/Cmd+Z)', onClick: undo }),
            make('button', {
                type: 'button',
                class: 'small danger',
                textContent: 'Clear',
                onClick: () => {
                    pushUndo();
                    const blank = new Array(COLUMNS * ROWS).fill(OFF);
                    replacePixels(blank);
                    finishStroke();
                },
            }),
        ]),
        make('div', { class: 'swatches' }, swatches),
    ]);

    selectTool(brush.tool);
    draw();

    return {
        node,
        setTextStart: column => {
            shadedFrom = column;
            draw();
        },
    };
};
