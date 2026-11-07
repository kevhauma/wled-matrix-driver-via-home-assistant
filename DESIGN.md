---
name: wled-ha-bridge editor
description: The panel's own control surface, an RGB pad controller lit from below.
colors:
  ground: "#0e0e10"
  plate-top: "#2b282d"
  plate-bottom: "#1d1c1f"
  chassis: "#17161a"
  screw-ring: "#3a383d"
  recess: "#141416"
  well: "#0b0b0d"
  well-edge: "#2c2c31"
  rubber-top: "#333338"
  rubber-bottom: "#26262a"
  groove: "#000000"
  text: "#ececf0"
  muted: "#a1a1aa"
  faint: "#85858e"
  pad-entities: "#3ad7ff"
  pad-flow: "#ff4fd8"
  pad-display: "#ffd23a"
  pad-settings: "#59ff7a"
  pad-save: "#ff4a3a"
  good: "#59ff7a"
  bad: "#ff5a4a"
  warn: "#ffc23a"
  readout-amber: "#ffcf8a"
  led-unlit: "#18181b"
  json-green: "#9fe9c8"
  highlight: "#ffffff"
  highlight-faint: "rgba(255, 255, 255, 0.035)"
  highlight-edge: "rgba(255, 255, 255, 0.09)"
  highlight-halo: "rgba(255, 255, 255, 0.3)"
  led-idle-core: "#6a5320"
  led-idle-edge: "#3a2e12"
  led-good-core: "#eaffef"
  led-bad-core: "#ffe3df"
  toast-error-text: "#ffb4ab"
  toast-success-text: "#b8ffc6"
  save-off-text: "#6f5a58"
  strip-dot: "#d6d6da"
  strip-dot-edge: "#9a9a9f"
  readout-glow: "rgba(255, 170, 50, 0.45)"
typography:
  display:
    fontFamily: "Doto, Share Tech Mono, ui-monospace, monospace"
    fontSize: "24px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Doto, Share Tech Mono, ui-monospace, monospace"
    fontSize: "21px"
    fontWeight: 900
    lineHeight: 1.1
  readout:
    fontFamily: "Doto, Share Tech Mono, ui-monospace, monospace"
    fontSize: "17px"
    fontWeight: 800
    lineHeight: 1
  readout-large:
    fontFamily: "Doto, Share Tech Mono, ui-monospace, monospace"
    fontSize: "20px"
    fontWeight: 900
    lineHeight: 1
  keyword:
    fontFamily: "Doto, Share Tech Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.02em"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  control:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  title:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 700
  label:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.16em"
  micro:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.1em"
  pad-label:
    fontFamily: "Archivo, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    letterSpacing: "0.14em"
  mono:
    fontFamily: "Share Tech Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  plate: "14px"
  recess: "10px"
  pad: "9px"
  well: "8px"
  key: "6px"
  swatch: "5px"
  track: "4px"
  led: "3px"
  strip: "2px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "22px"
  gutter: "24px"
components:
  key:
    backgroundColor: "{colors.rubber-top}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.key}"
    padding: "7px 14px"
  key-small:
    rounded: "{rounded.key}"
    padding: "4px 10px"
  key-ghost:
    textColor: "{colors.muted}"
    padding: "7px 14px"
  pad-tab:
    textColor: "{colors.text}"
    typography: "{typography.pad-label}"
    rounded: "{rounded.pad}"
    width: "132px"
    height: "50px"
  pad-save:
    backgroundColor: "{colors.pad-save}"
    typography: "{typography.pad-label}"
    rounded: "{rounded.pad}"
    width: "92px"
    height: "54px"
  input-well:
    backgroundColor: "{colors.well}"
    textColor: "{colors.text}"
    rounded: "{rounded.key}"
    padding: "7px 10px"
  module-plate:
    backgroundColor: "{colors.plate-top}"
    rounded: "{rounded.plate}"
    padding: "20px 22px 22px"
  rule-recess:
    backgroundColor: "{colors.recess}"
    rounded: "{rounded.recess}"
    padding: "14px 16px 16px"
  keyword-chip:
    backgroundColor: "{colors.well}"
    typography: "{typography.keyword}"
    rounded: "{rounded.key}"
    padding: "4px 9px"
---

# Design System: wled-ha-bridge editor

## Overview

**Creative North Star: "The Pad Controller"**

The editor is the LED panel's own control surface: charcoal silicone and ABS modules seated in a near-black chassis, recessed wells for everything you type into, and backlit silicone pads for the tabs and Save. Light is the information. A pad that is lit is the tab that is open; a red pad that glows is work waiting to be saved; a strip of LEDs between flow rules lights the path down to the rule that won. Everything else stays dark matte plastic so the light means something.

Density is a working instrument's: compact rows, 14px plates, small uppercase labels on status, numbers set in dot-matrix type like the panel itself. The panel preview is drawn pixel-true behind a diffuser grid (black 2px cell walls over unlit cells of `led-unlit`), so the editor and the hardware look like the same object.

The world refuses the category default of a grey dark dashboard with a single blue accent. Its accent is not a brand colour: it is whichever pad is lit.

**Key Characteristics:**
- Matte charcoal module plates on a near-black ground, each sitting in a moulded bay, top-lit, with a screw at every corner.
- Recessed wells for inputs; raised rubber keys for actions; backlit pads for tabs and Save.
- Five pad colours; the open tab's pad colour becomes the accent everywhere.
- Coloured glow marks state only: lit, matched, connected, checked, focused, warned.
- Doto dot type for headings, keywords and numbers; Archivo for reading; Share Tech Mono for ids and JSON.

## Colors

A dark matte neutral body with five saturated pad lights, one of which is lit at a time as the accent.

### Primary
- **Lit Pad Accent** (`--accent`, one of the pad colours below): not a fixed hue. `:root:has()` sets it from the selected tab, so caret, focus ring, selection, checked boxes, slider pads, the matched rule's ring and the LED strip all take the open tab's colour. Default is Entities cyan.

### Secondary
- **Entities Cyan** (pad-entities), **Flow Magenta** (pad-flow), **Display Yellow** (pad-display), **Settings Green** (pad-settings): each tab pad's own light, and the accent while that tab is open.
- **Save Red** (pad-save): the Save pad only. Never an accent.

### Tertiary (semantic)
- **Connected Green** (good): the live connection LED and success toasts.
- **Fault Red** (bad): the disconnected LED, error toasts, danger-key hover.
- **Caution Amber** (warn): preview warnings and their small square LED.
- **Readout Amber** (readout-amber): numeric dot-type readouts (what the panel is showing, dwell seconds), like a seven-segment display.
- **Payload Green** (json-green): the sent-payload JSON text.

### Neutral
- **Chassis Black** (ground): the page, with a faint fractal-noise grain over it.
- **Charcoal Plate** (plate-top to plate-bottom): the module surface, a warm top-to-bottom gradient under a top-light sheen (a 70px radial of white at 0.07 from the top edge) and a matte fractal-noise grain at 0.09 alpha.
- **Chassis** (chassis): the 4px bay ring every plate sits in.
- **Screw Ring** (screw-ring): the mid tone of the recessed corner screw heads.
- **Recess** (recess): a section or rule pressed into a plate.
- **Well** (well) with **Well Edge** (well-edge): input and readout recesses.
- **Rubber** (rubber-top to rubber-bottom): keys, selects, checkboxes, position pads.
- **Groove** (groove): pure black seams, table rules and dividers, always paired with a 1px light lip below.
- **Text** (text), **Muted** (muted), **Faint** (faint, placeholders only). Headings, slider values and lit-key hover use pure white (highlight).

### Highlight and Indicator Stops
- **Highlight scale** (white at fixed alphas): 0.025 row hover, 0.03 plate left edge, 0.035 lips under grooves and member hover (highlight-faint), 0.04-0.05 lips under dividers and the parting line, 0.06 chassis lip, 0.07 sheen and screw rim, 0.09-0.11 moulded top edges of plates and keys (highlight-edge), 0.25-0.35 dot-type heading halos and the lit-pad label emboss (highlight-halo), 0.5 the lit pad's inner rim. Do not invent steps in between.
- **LED stops:** an idle indicator is a radial of led-idle-core to led-idle-edge; a lit one starts from led-good-core (connected) or led-bad-core (fault), otherwise pure white, out to its colour at 60%.
- **Toast text:** toast-error-text and toast-success-text, light tints of bad and good for legible text beside the LED.
- **Save off:** save-off-text, the dead red-brown label of the disabled Save pad.
- **Strip LEDs:** strip-dot with a strip-dot-edge ring on the unlit connector strip.
- **Readout glow:** readout-glow (0.4-0.45 alpha) is the amber halo behind readout-amber digits.

### Named Rules
**The Lit Pad Rule.** The accent is whichever tab pad is lit. Never hard-code a pad colour into a component; use the accent so it follows the open tab. Save Red is the one pad that never becomes the accent.

**The Glow Is State Rule.** A coloured halo (`--glow` or a pad's 22px/48px bloom) appears only on something that is on: the lit tab, enabled Save, a checked box, an active painter tool, an open help toggle, the matched rule and the strip above it, the connection and toast LEDs, a focused input or slider thumb. Resting surfaces never glow. The faint white or amber halo (highlight-halo, readout-glow) on dot-type headings and readouts is the display's own emission, not a state signal, and stays at or under 0.45 alpha.

## Typography

**Display Font:** Doto (with Share Tech Mono, monospace)
**Body Font:** Archivo (with system-ui, Segoe UI, sans-serif)
**Label/Mono Font:** Share Tech Mono (with ui-monospace, Menlo, Consolas)

**Character:** Doto is the panel's own dot-matrix voice, used where the editor speaks as the device: titles, flow keywords, numbers. Archivo carries every sentence you read. Share Tech Mono marks machine strings.

### Hierarchy
- **Display** (Doto 900, 24px, 1; 20px under 700px): the page title, white with a soft white halo.
- **Headline** (Doto 900, 21px, 1.1): card titles.
- **Readout** (Doto 800, 17-18px, 1): slider values in white; the showing value in readout amber.
- **Keyword** (Doto 900, 15px, 0.02em): IF / ELSE IF / ELSE / OTHERWISE in a small well, and position numbers on rubber pads.
- **Readout large** (Doto 900, 20px, 1): dwell seconds in their field, readout amber.
- **Title** (Archivo 700, 16px): a flow rule's name.
- **Body** (Archivo 400, 15px, 1.5, tabular numerals): base text; controls, tables and toasts at 14px (control); hints and field labels at 13px muted; help text 14px/1.6 at 75ch.
- **Label** (Archivo 700, 11px, 0.14-0.16em, uppercase): status words only (connection badge, unsaved changes, matched flag, table headers).
- **Micro** (Archivo 700, 10px, 0.1-0.12em, uppercase): the kind and picker badges in their small wells.
- **Pad label** (Archivo 700, 12px, 0.14em, uppercase): the words printed on tab pads and Save.
- **Mono** (Share Tech Mono 400, 13-14px): entity ids, chips, view badges, token codes, JSON.

### Named Rules
**The Device Speaks In Dots Rule.** Doto is for what the panel would show (titles, keywords, numbers). Never set a sentence, label or button in Doto.

**The Machine String Rule.** Anything the owner would copy into Home Assistant or WLED (entity ids, tokens, JSON) is Share Tech Mono; nothing else is.

## Layout

A sticky top stack (header plate, then the tab-pad plate) stays in view with a ground-coloured fade beneath it, so Save is always reachable. Header and tabs cap at 1280px. Below, `main` is a single column (gap 22px, padding 14px 24px 96px): narrow views cap at 1008px; split views cap at 1328px and become two columns (1.15fr / 1fr) at 900px, with the preview column sticky under the header. Every grid column is `minmax(0, …)` so long entity ids scroll inside their card instead of widening the page.

Spacing rhythm runs 6 / 10 / 14 / 16 / 22 / 24px. Field grids auto-fit at a 150px minimum. Flow rules stack with no gap; the LED-strip connector (30px) is the space between them.

**Under 700px:** outer padding drops to 8-10px; module plates pad 24px 14px 20px so the heading clears the corner screws; the header wraps so the live mirror (shrunk to 160 x 40) and status take a full second line with Save at the right (76 x 44); what is showing wraps, with the entity id on its own line above the value; tab pads share the row (`flex: 1 0 74px`, 42px tall, 11px label); flow conditions put the entity on its own line and time conditions drop the redundant test; entity tables become stacked blocks with the id on its own line; row tools stay visible. On `hover: none` devices row tools are always shown.

## Elevation & Depth

Depth is physical and moulded, not floating. Modules sit in bays; inputs are pressed in; keys stand slightly proud; pads are lit from inside. All three levels are built from inset highlights, black hairline seams and hard 1px rings, plus one soft drop under plates.

### Shadow Vocabulary
- **Module plate** (`inset 0 1px 0 rgba(255,255,255,.09), inset 1px 0 0 rgba(255,255,255,.03), inset 0 -2px 0 rgba(0,0,0,.55), 0 0 0 1px #000, 0 0 0 4px #17161a, 0 0 0 5px rgba(255,255,255,.06), 0 18px 34px rgba(0,0,0,.6)`): header, tabs, cards, toast, picker list, member conditions. Moulded edge, black seam, chassis bay, bay lip, drop.
- **Recess** (`inset 0 2px 5px rgba(0,0,0,.7), 0 0 0 1px #2a2a2e`): a card inside a card, flow rules, state cases.
- **Well** (`inset 0 2px 4px #000, 0 0 0 1px var(--well-edge)`): text inputs, the mirror, the preview canvas, payload and JSON.
- **Rubber key** (`inset 0 1px 0 rgba(255,255,255,.11), 0 0 0 1px #000, 0 2px 0 #000`): buttons, selects, checkboxes. Pressed: `inset 0 2px 3px rgba(0,0,0,.5), 0 0 0 1px #000` and 1px down.
- **Pad, unlit** (`inset 0 1px 0 rgba(255,255,255,.1), inset 0 -3px 6px rgba(0,0,0,.45), 0 0 0 1px #000, 0 3px 0 #000`).
- **Pad, lit** (`inset 0 1px 0 rgba(255,255,255,.5), 0 0 0 1px #000, 0 0 22px <pad 65%>, 0 0 48px <pad 25%>`).
- **Glow** (`0 0 10px <accent 65%>`): the shared state halo.

- **Plate surface** (`--plate`): three layers, matte grain over the top-light sheen over the plate gradient. Every plate uses the whole stack.
- **Corner screws** (`--screw`, 12px at 9px in from each corner): top-level module cards only, drawn as background layers over the plate. A recessed slot, a light ring, the screw-ring tone, a black seat and a 0.07 rim.
- **Parting line**: a top-level card's head carries a 1px black groove with a 0.05 white lip and 14px below its title.

### Named Rules
**The Screws Hold Modules Rule.** Corner screws and the parting line belong to a top-level module card only. A nested recess, a toast, a picker list or the header and tab plates carry none.

**The Nothing Floats Rule.** Only the picker list and the toast add extra drop beyond the plate stack. No card hovers, lifts or casts a coloured shadow at rest.

## Shapes

Soft-cornered moulded plastic. Plates 14px; recesses 10px; pads 9px; wells 8px; keys and inputs 6px; checkboxes, swatches, chips and picker rows 5px; slider tracks and small badges 4px; LEDs and colour swatch insides 3px; the connector strip, link focus and warning LED 2px. LEDs and slider pads are squares, never circles. The help toggle is the one round key. Seams are 1px black rings; dividers and row rules are a black groove (2px divider, 1px top border on rows) with a 1px light lip beneath. No grey border lines.

## Components

### Buttons (rubber keys)
- **Shape:** gently rounded (6px).
- **Default:** rubber gradient, text colour, 14px/600, 7px 14px, key shadow.
- **Hover / Active:** text goes white and gains a 1px accent ring at 55%; pressing sinks 1px into an inset shadow.
- **Danger hover:** bad-red text, ring and a faint red halo.
- **Ghost:** no body or shadow, muted text, accent on hover. **Link:** accent underlined text. **Small:** 4px 10px, 13px.
- **Disabled:** 40% opacity.

### Pads (tabs and Save)
- **Unlit:** a radial gradient tinted 26% to 10% by the pad's own colour, label in a 40% tint of it.
- **Lit:** a radial bloom from white through the pad colour to its 68% shade, near-black label, inset highlight and a two-step coloured glow; a lit tab sits 2px down, pressed in.
- **Save:** 92 x 54, red. Dark and colourless while disabled (opacity stays 1); lit like an open tab once there are unsaved changes.

### Inputs / Fields
- **Style:** well background, well shadow, 6px radius, 7px 10px, 14px.
- **Hover:** edge ring brightens to #45454c. **Focus:** 1px accent ring plus a 12px accent halo; no outline.
- **Select:** a rubber key with a muted chevron, not a well; accent ring on hover.
- **Checkbox:** a 20px rubber pad that lights with the accent bloom and glow when checked.
- **Range:** a row of accent pads (14px lit, 4px black gap) on a 16px track; `--v` from `sliderField` dims everything past the value; a white 10 x 24 thumb that glows when active or focused.
- **Rule name:** reads as a 16px/700 title until hovered or focused, then becomes a well.

### Cards / Containers
- **Module plate:** plate background, 14px, module-plate shadow, 20px 22px 22px (24px 14px 20px on phones), four corner screws and a parting line under the head.
- **Nested:** a card inside a card is a recess, never a second plate.

### Navigation
- The tab row is a module plate holding 132 x 50 pads with 12px gaps; horizontal scroll if it overflows; the selected pad is lit and pressed.

### Flow Chain (signature)
Rules are recesses in a single column. The matched rule gets a 2px accent ring and a 26px accent halo, its keyword lights white with an accent halo, and a "matched" flag with a square LED appears. Between rules sits a 12 x 30 length of white LED strip with strip-dot LEDs; every strip above the matched rule lights (`.connector:has(~ .rule.matched)`), its dots turning accent with a glow, tracing the path the flow took.

### Indicators
Square 8-12px LEDs with a 1px black ring: dark amber (led-idle-core to led-idle-edge) when idle, radial white-to-colour with a 10px halo when on. Used by the connection badge, toast, matched flag and warnings.

### Panel Preview
The 32 x 8 canvas sits in a well with a 6px black diffuser border. Unlit cells are `led-unlit`; black 2px walls are drawn over every lit frame so each LED reads as its own cell. Pixelated rendering, no smoothing.

### Motion
Short and functional: 150ms colour and shadow transitions on keys and fields, 200ms on a rule's match ring, 80ms press, and a 220ms toast rise on `cubic-bezier(0.16, 1, 0.3, 1)`. Under `prefers-reduced-motion: reduce`, every transition and animation is removed.

## Do's and Don'ts

### Do:
- **Do** take colour state from `--accent` so it follows the lit tab (The Lit Pad Rule).
- **Do** seat every new module as a plate with the full plate surface and module-plate shadow, screws and parting line, and every nested section as a recess without them.
- **Do** put anything typed into a well, and anything pressed on rubber.
- **Do** show on/off state with a square LED or a lit pad, with glow only while on (The Glow Is State Rule).
- **Do** set numbers the panel would show in Doto, and ids and JSON in Share Tech Mono.
- **Do** keep every grid column `minmax(0, …)` and let long ids scroll or ellipsize inside their container.
- **Do** drop all transitions and animations under reduced motion.

### Don't:
- **Don't** add glow, coloured rings or lit gradients to resting surfaces or decoration.
- **Don't** use Save Red as an accent or for anything but Save.
- **Don't** stack a plate on a plate; nest as a recess.
- **Don't** add white highlight alphas outside the highlight scale.
- **Don't** draw LEDs, slider segments or indicators as circles; they are rounded squares.
- **Don't** set sentences, buttons or labels in Doto.
- **Don't** draw seams as grey border lines; use 1px black rings or the black groove with its light lip.
