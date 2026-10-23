/**
 * A 32x8 mock-up of the panel.
 *
 * Honest about what it can be. The service draws with WLED's own effects, not
 * with pixels, so the device's glyphs cannot be reproduced here. What *is*
 * modelled is the part that bites: how many characters fit at once, and
 * therefore whether a string sits still or scrolls. Letters are drawn one to a
 * fixed cell, the same width WLED's font 0 uses, so the character count and the
 * visible window are right even though the letterforms are not.
 */

const COLUMNS = 32;
const ROWS = 8;
const SCALE = 12;
/** Font 0 is 4px wide, which is why eight glyphs fill the panel. */
const LETTER_COLUMNS = 4;

const toCss = ([red, green, blue]) => `rgb(${red} ${green} ${blue})`;

export const createPanelPreview = () => {
    const canvas = document.createElement('canvas');
    canvas.className = 'panel';
    canvas.width = COLUMNS * SCALE;
    canvas.height = ROWS * SCALE;

    const context = canvas.getContext('2d');
    let frame = 0;
    let animation = 0;
    let current = null;

    const drawGrid = () => {
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = 'rgba(255,255,255,0.045)';
        context.lineWidth = 1;
        for (let column = 1; column < COLUMNS; column += 1) {
            context.beginPath();
            context.moveTo(column * SCALE, 0);
            context.lineTo(column * SCALE, canvas.height);
            context.stroke();
        }
        for (let row = 1; row < ROWS; row += 1) {
            context.beginPath();
            context.moveTo(0, row * SCALE);
            context.lineTo(canvas.width, row * SCALE);
            context.stroke();
        }
    };

    const drawBar = ({ percent, color, trackColor }) => {
        const filled = Math.round((percent / 100) * COLUMNS);
        context.fillStyle = toCss(trackColor);
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = toCss(color);
        context.fillRect(0, 0, filled * SCALE, canvas.height);
    };

    const drawText = ({ text, color, visible, speed }) => {
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);

        const cell = LETTER_COLUMNS * SCALE;
        context.fillStyle = toCss(color);
        context.textBaseline = 'middle';
        context.textAlign = 'center';
        context.font = `600 ${Math.round(SCALE * 5.4)}px ui-monospace, Menlo, monospace`;

        const fits = text.length <= visible;
        const middle = canvas.height / 2;

        if (fits) {
            // WLED centres anything that fits the segment; only longer strings move.
            const width = text.length * cell;
            const left = (canvas.width - width) / 2;
            for (let index = 0; index < text.length; index += 1) {
                const x = left + index * cell + cell / 2;
                context.fillText(text[index], x, middle);
            }
            return;
        }

        const span = (text.length + visible) * cell;
        const pixelsPerFrame = 0.3 + (speed / 255) * 1.9;
        /**
         * Started one cell in rather than at zero, so the first letter is
         * already entering when the preview opens. At zero the panel sits
         * blank for a second and reads as broken.
         */
        const offset = (cell + frame * pixelsPerFrame) % span;
        for (let index = 0; index < text.length; index += 1) {
            const x = canvas.width + index * cell + cell / 2 - offset;
            if (x < -cell || x > canvas.width + cell) {
                continue;
            }
            context.fillText(text[index], x, middle);
        }
    };

    const paint = () => {
        if (current === null) {
            drawGrid();
            return;
        }
        if (current.kind === 'off') {
            drawGrid();
            return;
        }
        if (current.kind === 'bar') {
            drawBar(current);
            return;
        }
        drawText(current);
    };

    const loop = () => {
        frame += 1;
        paint();
        animation = requestAnimationFrame(loop);
    };

    return {
        canvas,

        show: next => {
            current = next;
            frame = 0;
            const needsAnimation = next !== null
                && next.kind === 'text'
                && next.text.length > next.visible;
            cancelAnimationFrame(animation);
            if (needsAnimation) {
                animation = requestAnimationFrame(loop);
            } else {
                paint();
            }
        },

        stop: () => {
            cancelAnimationFrame(animation);
        },
    };
};
