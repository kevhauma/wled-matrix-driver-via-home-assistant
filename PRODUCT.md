# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One owner, configuring their own WLED 32x8 LED matrix panel that is driven by
their own Home Assistant. They open the editor on their home network, mostly at
a desktop, sometimes from a phone, to change what the panel shows and when.

## Product Purpose

wled-ha-bridge watches Home Assistant entities, decides what belongs on the
panel right now, and posts it to WLED. The editor is where the owner picks the
entities, writes the flow that decides what is shown, designs how each entity
is drawn, and sets the output. Success: the owner can change the panel's
behaviour and see the result on the panel without editing JSON by hand.

## Positioning

A first-match-wins flow (IF / ELSE IF / ELSE / OTHERWISE) over live Home
Assistant state, with a pixel-true preview of the 32x8 panel in WLED's own
fonts, so what the editor shows is what the panel shows.

## Operating Context

- Runs as a Deno daemon on the home network; the editor is served on
  http://127.0.0.1:8000 by default.
- Works with nothing configured: a mock source and a dry run stand in for Home
  Assistant and the panel.
- Four tabs: Entities, Flow, Display, Settings. A sticky header shows what the
  panel is showing now, the connection state, and Save (Ctrl+S).

## Capabilities and Constraints

- All behaviour, copy, tab names and labels are fixed; visual work may not
  change them.
- Plain HTML, CSS and ES modules in `public/`, no build step and no framework.
- The panel is 32x8 LEDs; previews and the header mirror draw it pixel for
  pixel.

## Product Principles

- What the editor shows is what the panel shows.
- The flow reads top to bottom, first match wins, and says so plainly.
- Nothing is hidden behind JSON unless the owner asks for a custom display.
