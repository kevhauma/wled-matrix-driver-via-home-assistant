/**
 * A 32x8 mock-up of the panel.
 *
 * Honest about what it can be. The service draws text with WLED's own effects,
 * not with pixels, so the device's letters cannot be reproduced here — an
 * icon's pixels can, and are. What *is* modelled is the part that bites: where
 * each letter goes. The server sends every glyph's position, width and height
 * from `fonts.ts`, so what fits, where it sits, which way it scrolls and how
 * fast are right even though the letterforms are not.
 *
 * A rotation reaches the glyph *boxes* — a quarter turn swaps each letter's
 * width and height, which is what changes whether the string fits — but not
 * the letterforms, which stay upright. Trail and gradient are not drawn, and
 * neither is the vertical crawl a Y offset of exactly 0 or 255 causes; the
 * preview warns about that one instead.
 */

const COLUMNS = 32;
const ROWS = 8;
const SCALE = 12;

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

    /**
     * The text where `fonts.ts` says WLED puts it. `textStart` is the first
     * column it may use — 0 for a plain text view, its own for an `iconText`
     * one — and the caller has already set the colour, the clip and the blend
     * mode, which is all that differs between the two.
     */
    const drawLayoutText = ({ layout, settings, textStart }) => {
        const columns = COLUMNS - textStart;
        const scrolls = layout.motion === 'across';
        const pixelsPerFrame = 0.02 + (settings.speed / 255) * 0.12;
        const span = layout.width + columns;
        const travelled = (frame * pixelsPerFrame) % span;
        /**
         * WLED counts its scroll offset down instead of up when Reverse is
         * set, which is the whole of what that checkbox does.
         */
        const offset = settings.reverse ? span - travelled : travelled;
        // WLED centres text that fits; otherwise it enters from one edge.
        const left = scrolls
            ? textStart + columns - offset
            : textStart + Math.trunc((columns - layout.width) / 2);

        context.textBaseline = 'middle';
        context.textAlign = 'center';
        for (const glyph of layout.glyphs) {
            const x = (left + glyph.x + glyph.width / 2) * SCALE;
            // Each glyph is centred by its own height, which under a quarter
            // turn is its own width and so differs from letter to letter.
            const height = Math.min(glyph.height, ROWS);
            const middle = (glyph.top + glyph.height / 2) * SCALE;
            context.font = `600 ${Math.round(SCALE * height * 0.95)}px ui-monospace, Menlo, monospace`;
            context.fillText(glyph.character, x, middle, Math.max(1, glyph.width) * SCALE);
        }
    };

    const drawText = ({ layout, settings }) => {
        context.globalCompositeOperation = 'source-over';
        context.fillStyle = '#000';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = toCss(settings.color);
        drawLayoutText({ layout, settings, textStart: 0 });
    };

    /**
     * The picture as it is, and the text over it the way the device blends
     * it: Lighten, so a black background lets the picture through. Letters
     * sit where `fonts.ts` says WLED puts them, though their shapes are still
     * the browser's.
     */
    const drawIconText = ({ pixels, textStart, layout, settings }) => {
        context.globalCompositeOperation = 'source-over';
        drawGrid();
        for (let row = 0; row < ROWS; row += 1) {
            for (let column = 0; column < COLUMNS; column += 1) {
                const pixel = pixels[row * COLUMNS + column];
                if (pixel === '000000') {
                    continue;
                }
                context.fillStyle = `#${pixel}`;
                context.fillRect(column * SCALE, row * SCALE, SCALE, SCALE);
            }
        }

        context.save();
        context.beginPath();
        context.rect(textStart * SCALE, 0, (COLUMNS - textStart) * SCALE, canvas.height);
        context.clip();
        context.globalCompositeOperation = 'lighten';
        context.fillStyle = toCss(settings.color);
        drawLayoutText({ layout, settings, textStart });
        context.restore();
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
        if (current.kind === 'iconText') {
            drawIconText(current);
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
            const drawsText = next !== null && (next.kind === 'text' || next.kind === 'iconText');
            const needsAnimation = drawsText && next.layout.motion === 'across';
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
