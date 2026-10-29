# wled-ha-bridge

Middleware: watches Home Assistant entities, decides what belongs on a WLED
panel, and POSTs it.

Runs with nothing configured — no token, no network, no hardware:

```bash
deno task start
```

```
wled-ha-bridge: mock source -> dry run (set WLED_IP to post)
4 entities, 4 flow rules
editor on http://127.0.0.1:8000

[17:53:01] live           mock source, no Home Assistant
[17:53:01] mock           music playing, TV off — music takes the panel
[17:53:01] show           media_player.living_room_2_0
[17:53:01] dry run        {"on":true,"bri":96,"seg":[{"id":0,"on":true,...,"fx":122,"n":"Superstitious Fantasy",...}]}
[17:51:00] mock           music paused — the rotation takes over
[17:51:00] show           sensor.kitchen_temperature
[17:51:00] dry run        {"on":true,"bri":96,"seg":[{...,"fx":122,"n":"18C",...}]}
[17:51:03] show           sensor.battery_state_of_charge
[17:51:03] dry run        {"on":true,"bri":96,"seg":[{...,"fx":98,"sx":255,"ix":64,...}]}
```

Set `HA_TOKEN` to use the real WebSocket subscription instead of the mock; set
`WLED_IP` to POST for real instead of printing. Either independently.

Then open **http://127.0.0.1:8000** to configure it.

## The pieces

| File | Job |
| --- | --- |
| [`panel.config.json`](panel.config.json.example) | The configuration the editor writes: entities, flow, output |
| [`flow.ts`](flow.ts) | The rule, condition and action types the flow is made of |
| [`panelConfig.ts`](panelConfig.ts) | The default flow, and the one validator the file and the API share |
| [`configUpgrade.ts`](configUpgrade.ts) | Brings a file written by an older version up to the current shape |
| [`configStore.ts`](configStore.ts) | Reads that file, seeds it, writes it back atomically |
| [`source.ts`](source.ts) | Where readings come from — the mock, or the real socket |
| [`builtins.ts`](builtins.ts) | The clock and the date: the items that are not Home Assistant's |
| [`library.ts`](library.ts) | What the entity picker is shown: filtered, ordered, and cut to a window |
| [`readings.ts`](readings.ts) | Parses one entity's state into a percent, a temperature or text |
| [`whatToShow.ts`](whatToShow.ts) | The one decision: what belongs on the panel right now |
| [`wled.ts`](wled.ts) | Turns that decision into one `/json/state` body, and sends it |
| [`ledEntries.ts`](ledEntries.ts) | An icon's pixels as WLED's `i` field; `public/ledEntries.js` reads one back |
| [`fonts.ts`](fonts.ts) | WLED 16's five text fonts and the four rotations, so the preview can lay text out in them |
| [`template.ts`](template.ts) | The `{{...}}` placeholders a custom display's own JSON carries |
| [`bridge.ts`](bridge.ts) | The daemon: the tick, the queue, and applying a saved config live |
| [`server.ts`](server.ts) | Static files out of `public/`, and six JSON endpoints |

`main.ts` is just the wiring. The one-second tick is in `bridge.ts`, because the
rotation is time-based rather than event-driven.

### What to show

`whatToShow.ts` holds one pure function, `decidePanel`, and it no longer decides
anything by itself — it runs the flow in `panel.config.json`. Read top to
bottom, first match wins:

| | |
| --- | --- |
| `IF` the television is playing | turn the panel off |
| `ELSE IF` music is playing | show it |
| `ELSE` | the sensors take turns, 5s each |
| `OTHERWISE` | turn the panel off |

That is the default flow, and it is exactly what used to be written in code. A
rule with **no conditions always matches**, which is how the last block works.

A condition either tests an entity (playing, has a reading, above, below,
state equals) or is a **time window**: `{ "test": "timeBetween", "from":
"22:00", "to": "07:00" }`, on this host's local clock. The start is included
and the end is not, and a window whose end is earlier than its start runs past
midnight — so that one is the night. A window has no `entityId`, and one that
names one is refused.

`above` and `below` read the entity's raw state as a number, whatever it is
read as: a power sensor added as text compares fine, and a battery read as a
percentage is not clamped to 100 first. A state that is not a number —
`unavailable`, `playing` — matches neither.

A sensor with no reading is left out of a rotation rather than taking its turn
and showing nothing — and a rotation with *nothing* left declines to match at
all, so the rules below it are tried. That is why a flow wants a conditionless
rule at the bottom.

A loop member can also have conditions of its own — "show when…" on the Flow
tab — and is left out the same way while they do not match. The battery,
only while it is low:

```json
{ "id": "battery", "entityId": "sensor.battery_level",
  "when": { "match": "all", "conditions": [{ "entityId": "sensor.battery_level", "test": "below", "value": 20 }] } }
```

`when` takes the same conditions a rule does, time windows included. Leave it
out for a member that always takes its turn; an empty one is refused.

A member can hold the panel for a time of its own — `"dwellSeconds": 15` on
the member, or the seconds field in its row on the Flow tab, left empty to
inherit. Without one it gets the loop's `dwellSeconds`.

Rotations have memory. Interrupted by music and then resumed, one comes back to
the member it was on and gives it a full turn, rather than counting the
interruption against it. That position is not persisted: a restart begins at the
first member.

### A display of its own in the flow

Every entity has one display of its own, used wherever the flow shows it. A
`show` rule or a loop member can set a `display` that replaces it **in that
place only** — "own view…" on the Flow tab copies the entity's display into it
and opens it on the Display tab.

A loop's members are objects with ids of their own, which is what lets **one
entity be a member twice**. A media player's title, then its artist:

```json
{
    "do": "loop",
    "dwellSeconds": 5,
    "members": [
        { "id": "title", "entityId": "media_player.living_room",
          "display": { "style": "text", "segmentId": 0, "text": "{{title}}", "settings": { "speed": 80 } } },
        { "id": "artist", "entityId": "media_player.living_room",
          "display": { "style": "text", "segmentId": 0, "text": "{{artist}}",
                       "settings": { "color": [255, 160, 0], "speed": 80 } } }
    ]
}
```

### Adding an entity

Click it, on the Entities tab. Nothing is configured in Home Assistant, and
nothing needs editing here.

`kind` picks the parse; `display.style` is intent (`'bar'` or `'text'`), not a
WLED effect id — which effect that becomes and which slider carries what is
`wled.ts`'s business. The third style, `'custom'`, is the way out of that
abstraction when the two intents cannot say what you want, and the fourth,
`'byState'`, picks between displays on the entity's state; see below. Entities
no longer carry a `role`: the order of the rules is the priority.

A `text` display says what it draws with a `text` template: `"{{value}}"` on
its own, or with anything around it — `"PV {{value}}W"` is a prefix and a
suffix, and there is no separate field for either. The placeholders are the
custom body's, below. `{{value}}` is the one that is fitted: a media player's
`Title - Artist` is tried in the template first, then `Title` alone, before
anything is cut at 32 characters. A reading that has dropped off draws
nothing, not the template's own text around a gap.

### How text looks

Every setting WLED's Scrolling Text effect has is one of nine, and they live
**once**, at the top of the configuration as `textSettings` — edited under
*Text* on the Settings tab:

```json
"textSettings": {
    "color": [255, 255, 255],
    "gradientColor": [255, 255, 255],
    "speed": 70,
    "yOffset": 128,
    "trail": 0,
    "font": 0,
    "rotation": "normal",
    "gradient": false,
    "reverse": false
}
```

| setting | slider | what it does |
| --- | --- | --- |
| `color` | `col[0]` | the letters |
| `gradientColor` | `col[2]` | the far end of the gradient, read only while `gradient` is on |
| `speed` | `sx` | 0-255, as in the WLED UI |
| `yOffset` | `ix` | 128 is the middle row; 0 and 255 scroll text that *fits* vertically |
| `trail` | `c1` | `fade_out(255 - (c1 >> 4))`. 0 is none; anything else smears a scroll |
| `font` | `c2` | 0-4, WLED 16's five built-ins (`fonts.ts`) |
| `rotation` | `c3` | `normal`, `clockwise`, `counterClockwise`, `upsideDown` |
| `gradient` | `o1` | `color` to `gradientColor`, and only because `pal` is pinned to 0 |
| `reverse` | `o3` | scroll left to right rather than right to left |

The one the effect has that is **not** here is `o2`, *Custom Font*: it reads a
font file uploaded to the device, and nothing here can put one there.

Each of the two styles that draw text — `'text'` and the `'iconText'` below —
then carries a `settings` object holding **only what it sets for itself**:

```json
{ "style": "text", "segmentId": 0, "text": "{{value}}", "settings": { "speed": 80 } }
```

`{}` follows the global entirely. So changing the global font changes the font
everywhere except the views that have taken that one setting over — which is
what the per-setting button on the Display tab does. Taking one over copies the
global's current value, so nothing moves on the panel until you then edit it;
pressing the button again deletes the key and hands it back.

`rotation` is stored by name rather than as a slider value because `c3` is the
one slider on this effect that is not 0-255: WLED declares `custom3` as a
five-bit field and reads it as `map(c3, 0, 31, -2, 2)`, so **upright is 16 and
`c3` 0 is a half turn**. A quarter turn also swaps each glyph's width and
height, so it changes how much text fits across the panel — `fonts.ts` and the
preview both account for that.

`PANEL_ENTITIES` in `entities.ts` is now only the **seed** for a fresh
`panel.config.json`. Once that file exists, it is the registry.

### A display chosen by state

The fourth style, `'byState'`, is a choice between displays made on the
entity's **raw state**: the first case the state matches is drawn, and
`otherwise` when none does. A case either lists states, compared exactly —
`{ "test": "is", "states": ["sunny", "clear-night"] }` — or compares the state
as a number: `{ "test": "above", "value": 25 }`, `{ "test": "below", "value":
5 }`, both strict, as the flow's own tests are. A state that is not a number
(`unavailable`) matches neither, and so falls to a later case or `otherwise`.
Order the thresholds the way you read them: `above 30` before `above 20`; the
other way round, the second could never be drawn and is refused.

Each case is an ordinary `text`, `bar`, `iconText` or `custom` display — a choice inside a
choice is refused, because conditions belong in the flow. It works anywhere a
display does: an entity's own, or one set in the flow.

A **glyph** is an `iconText` case — see the next section. A sun for `sunny`,
the outside temperature beside it, and plain text otherwise.

### An icon beside text

WLED's fonts are ASCII only, so a picture is per-pixel data. `'iconText'` is a
picture with a reading beside it, painted in the editor:

```json
{
    "style": "iconText",
    "pixels": ["000000", "000000", "FFC800", "...256 in all, row by row"],
    "textStart": 10,
    "text": "{{value}}",
    "settings": { "color": [230, 255, 244], "speed": 128, "font": 3, "yOffset": 131 }
}
```

`wled.ts` sends it as the two segments every hand-written glyph body used:

- **segment 0**: the whole panel, frozen, its `i` the 256 pixels. They are
  encoded as wled-matrix-painter's "Copy as JSON" writes them (`ledEntries.ts`).
- **segment 1**: Scrolling Text from column `textStart` to the edge, with
  every slider from its resolved text settings and `bm: 8`, Lighten. Its
  `settings` work exactly as a plain `text` view's: the same nine, over the
  same global.

Because of Lighten, the picture may run on under the text: wherever the text is
unlit, the picture shows. `pixels` therefore covers the whole panel rather than
only the icon's columns.

Switching a `custom` display to "icon and text" in the editor converts it. The
body has to be shaped like a glyph: one segment with `i`, and one with a name.
The picture is decoded from the first segment, and the text and start from the
second — whose colour, speed, font and offset become the new view's own
`settings`, because a body written by hand set them on purpose.

### The built-in items

Two of the things the panel can show are not Home Assistant's: `builtin.time`
and `builtin.date`. They sit in the registry beside the entities, are added
from the same picker, and once read they are an ordinary text `Reading` — so a
clock can be a rotation member, the `OTHERWISE` block, or the `{{value}}` of a
custom body, with nothing downstream knowing the difference.

```json
{
    "entityId": "builtin.time",
    "kind": "text",
    "format": "hour24",
    "display": { "style": "text", "segmentId": 0, "text": "{{value}}",
                 "settings": { "color": [110, 175, 255], "speed": 60 } }
}
```

`format` is one of a **fixed set of names**, not a pattern string — the same
reason `template.ts` is not a template language. The editor offers each one
with an example of what it says right now:

| | |
| --- | --- |
| `builtin.time` | `hour24` → `14:32`, `hour12` → `2:32pm`, `hour24Seconds` → `14:32:05` |
| `builtin.date` | `weekdayDayMonth` → `Thu 22 Oct`, `dayMonth` → `22 Oct`, `dayMonthNumeric` → `22/10`, `isoDate` → `2026-10-22` |

The value is **this machine's clock**, rendered here and sent as the segment
name — not WLED's own. The device's NTP and timezone may be anything; the host
running this is the one you can check. It is read in `output.timeZone` (the
**timezone** field on the editor's Settings tab), an IANA name like
`Europe/Brussels`; empty means the host's own, which on a container or a fresh
Pi is usually UTC. A flow's time window is read in the same zone. The payload diff means a clock costs one
POST a minute rather than one a second. (If you would rather the firmware did
it, that is already reachable: a `custom` display can put WLED's own `#HHMM` in
a segment name. Nothing here will preview it.)

They are seeded into a fresh `panel.config.json` but are **not in the default
flow**, which is still exactly the order that used to be hardcoded. To light the
panel when nothing else is on, change the trailing `idle` rule from
`{ "do": "blank" }` to `{ "do": "show", "entityId": "builtin.time" }`, or make
it a rotation of the clock and the date.

### A custom WLED body

`style: 'bar'` and `style: 'text'` are *intents*: you say what the value is and
`wled.ts` picks the effect and the sliders. Both describe one segment, which is
the limit — a title scrolling above a progress bar is two segments at once, and
there is no way to ask for that in terms of an intent.

`style: 'custom'` gives up the abstraction instead of growing it. You write the
device's whole `/json/state` body and nothing here knows what any of it means:

```json
{
    "entityId": "media_player.living_room_2_0",
    "kind": "text",
    "display": {
        "style": "custom",
        "payload": {
            "seg": [
                { "id": 0, "fx": 122, "n": "{{title}}", "sx": 80, "ix": 128, "c2": 0 },
                { "id": 1, "fx": 98, "ix": "{{percent}}", "sx": 255, "o1": true }
            ]
        }
    }
}
```

The `{{...}}` placeholders are the whole of the templating — no expressions, no
conditionals, no formatting options, because each of those is a thing that can
go wrong on a device you cannot read a stack trace from:

| | |
| --- | --- |
| `{{value}}` | the reading as the panel draws it: `18C`, `64%`, a media title — without a text display's own template |
| `{{percent}}` | 0-100, rounded — the number `ix` wants on a Percent segment |
| `{{degrees}}` | the temperature, rounded |
| `{{unit}}` | the entity's `unit_of_measurement` |
| `{{title}}` | a media player's title alone, so it can have a segment of its own |
| `{{artist}}` | and its artist |
| `{{sensor.outside}}` | another of the panel's entities, as `{{value}}` would draw it |
| `{{sensor.outside:degrees}}` | any of the names above, read from that entity instead |

The dotted form is how **one display draws two entities**: `"in {{value}} out
{{sensor.outside_temperature}}"` on the inside sensor's text display, or a
custom body giving each its own segment. The id has to be one of the panel's
entities — only those are read — so add the other one on the Entities tab
first; it does not have to be in the flow.

A string that is **nothing but one placeholder takes that value's own type**, so
`"ix": "{{percent}}"` arrives as the number WLED needs. Anywhere else it is
interpolated and stays a string: `"bat {{percent}}%"`.

What the service still does for you, because a body cannot know it:

- **the other entities' segments are switched off**, appended to whatever `seg`
  you wrote — the same rule every display obeys, for the same reason
- **every segment you draw starts from a clean one**: each field you leave out
  goes out at WLED's own default, and the bounds as the whole panel — so
  nothing the previous view set lingers. Name a field and yours wins; a `col`
  with fewer than three colours has the rest filled with black. An entry that
  only says `"on": false` is sent as it is
- **`on` and `bri` are filled in if you leave them out**, so the editor's
  brightness slider still reaches a custom display; name your own and it wins

What it insists on, in `panelConfig.ts`, for both the file and `PUT /api/config`:

- **`seg` is present, and every entry's `id` is a literal number.** The service
  has to know which segments a display owns *before* it has a reading, or it
  could not switch the others off — so an `id` cannot itself be a placeholder.
- **every placeholder is one that exists.** `{{percentage}}` is refused with the
  path to it, rather than scrolling across the panel as a literal.

## The editor

Four tabs on http://127.0.0.1:8000, bound to loopback — `PUT /api/config` is
unauthenticated, and this runs on a network that by construction has a WLED
device and a Home Assistant instance on it.

The header carries a thumbnail of the panel, drawn from the body the service
last sent, beside the entity it is showing, that entity's raw state, and what
it is read as — `percent`, `temperature`, `text` or `unavailable`. The flow's
tests compare the raw state; the kind is how its display parses it. While the
panel is off it names the rule that turned it off instead. Only a single scrolling name or a
single bar is mirrored; a custom body leaves it dark.

- **Entities** — a search box over what Home Assistant exposes, and the list of
  what the panel knows. The search is the *server's*: `/api/library` answers
  with a window of the matches and says how many it left out, so a Home
  Assistant with a few thousand entities never arrives in the browser at once.
  With no `HA_TOKEN` the picker offers the mock source's own ids instead. The
  two built-in items are always at the top of it.
- **Flow** — the chain above, as blocks you reorder. The block currently
  deciding is outlined as you watch. A rule's and a member's tools appear when
  you hover or tab onto it. "own view…" beside a `show` target or a loop member
  gives it a display of its own, shown as a badge that opens it; "reset" drops it.
- **Display** — how one entity is drawn, with a mock-up of the panel, the exact
  segment name, and the real `/json/state` body folded under "What gets sent".
  Placeholders are inserted at the caret from the chips under the template. For
  a display chosen by state, the sample value is the state, and the preview says
  which case it picked. An icon-and-text display adds a pixel painter: the whole
  panel, the text's columns shaded, with paint, erase, fill, pick, undo and a
  palette. Either text style ends with **How this view looks**: the nine text
  settings, each with a button saying whether it follows the global or has been
  taken over here. A setting that follows is shown at the global's value and
  disabled, so you can see what it gives you without taking it over. A custom
  display swaps the mock-up for a JSON editor and
  lists what each of its segment names filled to; the shared validator's
  complaint appears as you type.
- **Settings** — the WLED address, the brightness, the timezone and the text
  settings every view inherits: what belongs to the device rather than to any
  one entity. Changing one under *Text* reaches every view that has not taken
  that setting over, which is the place to set the font or the speed for the
  whole panel at once. **Export** downloads the
  saved configuration as `panel.config.json`, written as the service writes it,
  so a deployed one can be dropped into a dev checkout and restarted. It
  carries the WLED address, so that copy posts to the same device unless you
  clear it. **Import** is the way back without a restart: the file is upgraded
  if it is an older version and run through the validator
  (`POST /api/config/import`, which saves nothing), then replaces the draft on
  every tab. Save applies it, as with any other edit — so check the WLED
  address it brought before you do.

Every explanation is behind the `?` on its card, and stays open across edits
once opened. Ctrl+S saves.

One picker, used by every tab that chooses an entity ([`public/picker.js`](public/picker.js)): a
`<select>` stops being usable somewhere around a hundred options, and you cannot
type at one. The Entities tab's asks the server as you type; the flow's and the
Display tab's filter the panel's own entities in the browser. Arrow keys and
Enter work in both.

Saving is explicit. The service applies whatever it is given immediately, so a
half-written rule would otherwise become the panel's behaviour mid-edit.

Changing which *Home Assistant* entities exist makes the service resubscribe,
because the subscription carries a fixed list of ids. Adding or removing a
built-in item costs no reconnect: it is never in that list. That costs a reconnect, which is cheap
here for the reason the whole design rests on: a fresh `subscribe_entities`
opens with a full snapshot, so reconnecting *is* the catch-up. The panel keeps
showing the old reading until that snapshot lands.

## Commands

```bash
deno task start      # the service and the editor on http://127.0.0.1:8000
deno task dev        # the same, but always on the mock source whatever .env says
deno task doctor     # says which step of the connection fails, and why
deno task entities   # lists real entity ids; takes filters, e.g. `deno task entities battery`
deno task test       # 106 tests, no hardware; --allow-net is for the fake HA server
deno task check
```

Run these **through `deno task`**, not as a bare `deno run`. The read and write
grants are scoped to `public/` and `panel.config.json`, and Deno resolves those
relative paths against the working directory at startup — launched from
somewhere else, the process silently loses them.

Run `deno task doctor` before debugging anything about the connection. It
reports reachability, the token over REST, the WebSocket upgrade, auth and the
subscription as separate steps, so a failure names itself instead of showing up
as a reconnect loop. It prints no token and no entity values.

To run it unattended on a Linux box, as a systemd service that survives
reboots, see [`deploy/README.md`](deploy/README.md).

The entity ids seeded into `panel.config.json` are **mocks**. Only
`media_player.living_room_2_0` and `sensor.kitchen_temperature` are known real
(from `wled-now-playing`); the Entities tab lists the rest.

## Why a WebSocket subscription rather than HA automations POSTing in

The deciding argument was where the configuration lives.

Automations put half the system in HA's YAML: each new graphic needs an
automation, a route and an agreed payload shape, kept in sync by hand. They also
have no state on startup — a restart shows a blank panel until something next
changes — and `rest_command` does not retry, so an event landing during a
restart is gone.

`subscribe_entities` gets push latency while every entity id stays in this repo,
and the subscription **opens with a full snapshot**, so a restart or a dropped
connection needs no catch-up logic: reconnecting *is* the catch-up.
`tests/socket.test.ts` proves exactly that.

If an event ever needs to come *from* HA — "the doorbell rang, show this for ten
seconds" — add one authenticated POST endpoint. That is the one thing automations
are genuinely better at, and it stays one endpoint rather than one per feature.

## Things that bite

Configuration:

- **An older `panel.config.json` is upgraded as it is read, and rewritten only
  by the next save.** `configUpgrade.ts` takes it one version at a time — 1 to 2
  folded a text display's `prefix` into its `text` template, 2 to 3 made a
  loop's members objects with ids, 3 to 4 added an empty `output.timeZone`,
  4 to 5 tagged every `byState` case with the test it makes, and 5 to 6 lifted
  every text view's settings into one `textSettings` at the top and left each
  view only the ones that *differ* from it — so a panel looks the same after
  the upgrade while the views that merely repeated the old defaults now follow
  the global. The start-up log says when it did. Until you save, the file on disk is still the old
  version, so it can be read by the old code.
- **Version 6 is the one upgrade that changes what the device is told.** Four
  of the nine text settings were never set by choice before it, so a plain text
  segment inherited `SEGMENT_RESET`'s `c1: 128` — a trail that smears a
  scrolling reading. They now go out at WLED's own defaults for the effect: no
  trail, upright, no gradient, right to left, which is what the `iconText`
  style always hardcoded. Everything a view actually set is preserved exactly.
- **A display set in the flow is a copy, not a link.** It starts as the
  entity's own and then goes its own way: changing the entity's colour later
  does not reach it. "reset" goes back to following the entity. A built-in's
  `format` is the exception — it belongs to the entity, so it is the same
  everywhere, and the Display tab only offers it on the entity's own display.
- **A loop member's `id` is what the rotation remembers**, not its entity — the
  same entity can be there twice. Version 3 turned an old `entityIds` list into
  members whose ids are the entity ids.
- **`WLED_IP` and `WLED_BRIGHTNESS` seed `panel.config.json` once, then the file
  wins.** Editing `.env` afterwards does nothing, which is confusing exactly
  once. Delete the file to seed it again. `HA_BASE_URL`, `HA_TOKEN` and `PORT`
  stay environment-only — a long-lived token has no business in a file the
  server writes and serves over HTTP.
- **`output.wledIp` is validated, not just stored.** It is interpolated into
  `http://${ip}/json/state`, and it can arrive from an HTTP request, so anything
  that could smuggle a scheme, a path or credentials into that URL is refused.
- **Changing the set of entities resubscribes; changing a colour does not.** The
  swap is deliberately not awaited by the request that caused it, because
  `stop()` can take seconds against a host that is not reachable.
- **Rotation position is not persisted.** It survives a save, so editing a
  colour does not send the rotation back to its first entity, but not a restart.
- **A custom display's `seg` ids have to be literal numbers.** `"id":
  "{{percent}}"` is refused, not honoured. Switching the other entities'
  segments off happens before there is a reading to fill the body with, so the
  ids have to be readable from the stored template.
- **A built-in item's `format` is required, and a format on anything else is
  refused.** Not ignored: accepting it would be a save that quietly did nothing,
  which is how a typo'd entity id looks. A built-in also cannot be a `bar` — a
  bar wants a number, and a clock would leave one permanently empty with nothing
  on the panel to say why — and its `kind` can only be `text`.
- **A time window's `from` and `to` cannot be equal.** That could mean an empty
  window or the whole day; a rule that should always apply has no conditions.
- **The clock is the host's, so the panel is only as right as this machine.** A
  wrong clock on the box running this is a wrong clock on the panel, and
  nothing in the editor can tell. Its timezone is the host's only while
  `output.timeZone` is empty — set it rather than relying on the box's. The
  formats are written out rather than taken from `toLocaleString`, deliberately: that would make the panel depend on the
  host locale and on which ICU the Deno build carries, and recent ICU puts a
  narrow no-break space before `PM` — which `wled.ts` then strips, so `2:32 PM`
  would reach the device as `2:32PM` on one machine and `2:32 PM` on another.
- **A panel of nothing but built-in items sends no subscription at all.** An
  empty `entity_ids` is not how you ask Home Assistant for nothing — it reads a
  missing or empty filter as *every* entity. The empty snapshot is still
  emitted, because that is what tells the bridge it may start deciding.
- **`{{sensor.outside}}` is that entity's plain reading, never its own text
  template.** Otherwise two templates could name each other. It is also not
  fitted with the display's `{{value}}`, so a long media title named this way
  is cut at 32 characters rather than losing its artist first.
- **Removing an entity another display names is refused on save**, with the
  path to the placeholder — the Entities tab only checks the flow before
  removing.
- **A display chosen by state compares the raw state, exactly.** `"Sunny"` is
  not `sunny`, and a temperature's state is `"18.4"`, not `18C` — which is what
  `above` and `below` read as a number. A state with
  spaces around it is refused, because it could never match; so is one listed
  by two cases, because only the first would ever be drawn. A built-in's state
  is the text it renders.
- **A placeholder a reading cannot supply is empty or zero, not an error.** The
  same body may be in front of a sensor that has dropped off, and `{{percent}}`
  on a media player is `0` — the same thing a `bar` display draws. Nothing warns
  you, because there is no way to tell that case from one you meant.

WLED:

- **Every view starts from a clean segment, because WLED keeps whatever a body
  leaves out.** Left alone, a bar's `o1` turned the next text into a gradient,
  a glyph's `i` left its segment frozen on the old pixels, and a custom body
  that shrank segment 0 to columns 8-31 left every later display there in 24
  columns. So every segment drawn goes out with *every* field: its own, and
  `SEGMENT_RESET`'s for the rest — WLED's defaults for a new segment, with
  bounds of the whole 32x8 panel. That makes a body's `fxdef` moot: the
  defaults it loads are overwritten by the ones sent. Top-level keys a custom
  body sets other than `on` and `bri` (`transition`, `nl`, `mainseg`) are not
  reset — the device's own value for those is a setting nothing here can read.
  Only the segments being drawn are on, so overlapping segments do not fight.
- **An icon beside text is the hand-written glyph body, generated.** Segment 0
  is the whole panel, frozen, with `fx: 122` carried over, and segment 1 is the
  text with `bm: 8`. Nothing about that arrangement is new. What is new is that
  `wled.ts` writes it, so the tests can only promise the same bytes as the body
  it replaces, not how the device draws them. Lighten is a WLED 16 blend mode;
  before 16 `bm` is ignored and overlapping segments are undefined. The
  segments are fixed at 0 and 1, so another display's segment 1 is switched
  off while it is drawn, as any shared segment is.
- **A custom body's pixels are unverified against hardware**, like the bar's
  direction: that `i` creates nothing and only paints, that indices run row by
  row across a 2D segment, and that a body naming segments 1 and 2 creates them
  if the device has fewer. The editor cannot show it either — a custom body has
  no mock-up.
- **`ix` is the percentage for the Percent effect (FX 98), not `sx`.** `sx` is
  how fast the bar slides to a new value. (From FX.cpp by way of
  `wled-now-playing/wled/effects.ts`, which has run against the hardware.)
- **A bar fills left to right only because it is told to, three flags over.**
  Percent is a 1D effect, so on a matrix WLED expands it: the default `m12: 0`
  (Pixels) walks LED order and fills top to bottom, and `m12: 1` (Bar) paints a
  whole row per 1D pixel and fills bottom to top. Neither is across. `tp`
  transposes the segment, and because `virtualWidth` and `virtualHeight` swap
  with it, those rows become columns and the effect's length becomes the panel's
  width — 32 steps across instead of 8 up. `reverse_y` is applied *before* the
  transpose, so `rY` and not `rev` is the flag that picks which end fills first.
  All three go out on every bar segment.
- **Those flags are segment state, so text has to unset them.** A bar and text
  share segment 0 in the default config, and a transposed Scrolling Text comes
  out sideways. The clean segment every view starts from has them off.
- **An empty segment name is not blank.** Scrolling Text falls back to drawing
  the date and time, so a segment is cleared by switching it off.
- **The segment name caps at 32 characters** (`WLED_MAX_SEGNAME_LEN`) and the
  device's fonts are ASCII only. There is no ellipsis glyph, so a long title
  drops the artist rather than being cut mid-word — otherwise the panel reads
  as a misspelling. A custom body writes its own names, so `{{value}}` is
  capped the same way but `{{title}}` is not: the device would cut it, and only
  the editor is in a position to warn you, which it does.
- **Short text does not necessarily sit still.** Scrolling Text centres text
  that fits the segment, but at `ix` exactly 0 or 255 it scrolls it
  *vertically* instead; 128 is the static middle. A `18C` left at 0 sits there
  crawling upwards, so the preview warns about both ends of the slider.
- **`c3` is the one slider on this effect that is not 0-255.** WLED declares
  `custom3` as a five-bit field and `mode_2Dscrollingtext` reads it as
  `map(c3, 0, 31, -2, 2)` — quarter turns of -2 to +2. So **upright is 16, and
  `c3` 0 is upside down**, which is why a rotation is stored by name and sent
  as the lowest `c3` that selects it, the way a font is. A value above 31 maps
  far outside that range and draws at an orientation nothing names.
- **A quarter turn changes what fits.** At ±90° WLED swaps each glyph's width
  and height and uses a letter spacing of 1 regardless of the font, so the same
  string needs a different number of columns. `fonts.ts` models that, which is
  what keeps "does it scroll?" honest under a rotation.
- **The gradient checkbox does nothing without a second colour.** `o1`
  gradients `col[0]` to `col[2]`, and only while the palette is 0 — which this
  project pins. Send the same colour in both slots and it is a gradient from a
  colour to itself, so there is a `gradientColor` setting to be the far end.
- **Trail is a fade, and 0 is the useful value.** `c1` is read as
  `fade_out(255 - (c1 >> 4))`, so anything above 0 leaves part of the last
  frame behind and a scrolling reading smears. WLED's own default for the
  effect is 0; a *segment's* default `c1` is 128, which is the trap — a plain
  text segment inherited that until the settings were named.
- **Every one of those sliders is sent on every text segment.** Left unset the
  device keeps whatever its own UI last had, so neither the service nor the
  preview could say what the panel was showing. `SEGMENT_RESET` covers the rest
  of the segment; the text settings cover these.
- **The editor's preview is honest about being a mock-up.** The service draws
  with WLED's effects, never with pixels, so the device's glyphs cannot be
  reproduced in a browser. Both styles that draw text are laid out from
  `fonts.ts`'s glyph widths, so where each letter sits, whether the string fits,
  which way it scrolls and how fast are right; the letterforms are not. A
  rotation reaches the glyph *boxes* but not the letterforms, and trail,
  gradient and the vertical crawl are not drawn at all — the last of those
  warns instead. The bar is drawn across 32
  columns, left to right, over the whole panel, which is what the device does. An
  icon beside text is drawn pixel for pixel, with its text over it blended as
  Lighten. For a
  custom body there is **no mock-up at all**, deliberately: it can draw one
  scrolling string or one bar across the whole panel, and a custom body is
  neither. It lists the filled segment names and the finished JSON instead.
- **The preview fakes one entity, not the others it names.** There is one
  sample field; `{{sensor.outside}}` fills from what the running service last
  read for that entity, so it is empty on the mock source for an id the mock
  does not have.
- **The preview fakes the entity, so what it can fake matters.** The sample
  value becomes `media_title` for a `media_player.` entity and nothing else —
  that prefix test is the only reason `{{title}}` and `{{artist}}` preview at
  all rather than sitting empty while working on the hardware.

The editor:

- **`/api/library` answers with a window, not the list.** 50 matches by default,
  500 at most, and the counts say what was cut — a picker that silently showed
  the first 50 of 2,431 would look like the other 2,381 did not exist. The
  built-in items are ordered first so a filter that matches one cannot push it
  off the end. `deno task entities` still prints everything.
- **The library is cached for ten seconds.** The picker searches as you type and
  each search would otherwise be a fresh `/api/states` — megabytes of JSON per
  word on a large installation. The cost is that the state column can be up to
  ten seconds stale, which is nothing for choosing an entity and would be wrong
  for anything else.
- **The flow tab no longer rebuilds once a second.** It used to, to move the
  "matching now" mark, which took the caret out of a label being typed; the mark
  is now moved in place. Anything else added to that tab has to be told about
  the live poll, or it will be the thing that does not survive it.
- **A field you type into or drag reports `edited`, not `changed`.** `changed`
  re-renders the whole tab, which replaces the input under the caret — a label
  then takes one letter at a time, and a slider or colour drag ends after one
  step. `changed` is for selects, buttons and pickers, whose edits can alter
  what else the tab shows.
- **The editor repeats `template.ts`'s placeholder names by hand**, because it
  is plain browser JavaScript and cannot import a `.ts` file. The built-in
  formats are *not* repeated — they come from `/api/builtins` with a live
  example each, which is what that endpoint is for.

The host and the network:

- **macOS Local Network Privacy will block every LAN connection**, and it looks
  exactly like the device being switched off. Deno gets `No route to host`
  (os error 65) for Home Assistant, for WLED, even for the router, while the
  public internet and loopback are fine — and `curl` and `nc` to the same
  address succeed, because they already hold the grant. Fix it in System
  Settings -> Privacy & Security -> **Local Network** by enabling Deno, and your
  terminal app too: the grant is attributed to the responsible process, so which
  one needs it depends on how you launched the service. The entries only appear
  after something has tried a local connection. `deno task doctor` and the
  `disconnected` log line both name this, because nothing else about the symptom
  points at it.
- **`HA_BASE_URL` may be given as a bare `host:port`.** That is not a URL, and
  the REST calls build paths onto it, so `config.ts` prepends `http://` when no
  scheme is given. This is why the socket could appear to half-work while
  `deno task entities` could not build a URL at all.

Home Assistant's compressed WebSocket format:

- **`+.a` in a diff is a *partial* attribute set.** It merges. Treat it as a
  replacement and you silently lose every attribute that did not change — for a
  media player that is nearly all of them. Plausible stale state, no error.
- **`lc` sets both timestamps; `lu` sets only `last_updated`.** HA omits `lu`
  when it equals `lc`.
- **`subscribe_entities` accepts entity ids that do not exist**, silently — they
  are simply absent from the snapshot, so a typo looks exactly like an
  unavailable sensor.
- **Envelope timestamps are epoch seconds, not ISO strings.** Attributes are
  unaffected: `media_position_updated_at` stays an ISO string.
- **Message ids are per-connection** and restart at 1 on every reconnect.
- **A dead connection does not always close.** It can sit open with nothing
  arriving; the application-level ping is the only way to notice.
- **`auth_invalid` is fatal on purpose.** Retrying a rejected token only loops.

## What is verified

`deno task test` — 106 tests, no hardware and no Home Assistant:

- the compressed format: merges, attribute removal, both timestamp rules, diffs
  with no snapshot behind them, removals, `clear`
- every branch of the default flow, unchanged from when that order was
  hardcoded: TV blanking over playing music, paused music giving way, the
  rotation on the clock, unavailable sensors skipped, nothing at all
- the flow evaluator itself: first match wins, `all` against `any`, a
  conditionless rule as the OTHERWISE block, a flow that matches nothing, a
  time window including its start and excluding its end, one running past
  midnight, the validator refusing a malformed time, an equal start and end
  and a window tied to an entity, a
  rotation advancing on its dwell, **a rotation resuming on the entity it was on
  after an interruption**, one whose members have all dropped off falling
  through, and one losing a member mid-turn
- a text template: a prefix and a suffix around the value, fitted per form of
  the value so the artist is dropped before either end is, and a dropped-off
  reading drawing nothing; the validator refusing an empty one and a typo'd
  placeholder in one
- placeholders naming another entity: its value by default and any name after a
  colon, a whole-string reference keeping its type, an absent one filling
  empty, one display drawing two temperatures, and the validator refusing an
  id that is not on the panel and a typo'd name after the colon
- displays set in the flow: one entity a loop member twice with a display each,
  alternating; a `show` rule passing its display on and none when it has none;
  the override replacing the entity's own on the panel, with the segment it is
  not using switched off either way; the validator holding one to the entity's
  rules (no bar on a built-in, only the panel's entities named) and refusing
  two members with one id
- a display chosen by state: the case listing the state drawn as its custom
  body with its pixels, a state no case lists drawing `otherwise` with the icon
  case's segments switched off, and the validator refusing a choice inside a
  case, a state listed twice, one padded with spaces, and a bar hidden in a
  built-in's `otherwise`; a case above or below a number, strictly, with a
  state that is not a number (or is empty) matching neither, and the validator
  refusing a missing or quoted value and a threshold an earlier case covers
- a loop member's own `when`: left out while it does not match, taking its turn
  while it does, a loop whose every member is left out falling through to the
  next rule, and the validator keeping one and refusing an empty one
- an old file: version 2's loop entity ids becoming members, numbered only
  where one repeats; version 1 upgraded and then passing the current validator, a
  `prefix` becoming the text in front of `{{value}}`, version 3 getting the
  host's own timezone, version 4's cases saying they list states — on an
  entity, a `show` rule and a loop member — version 5's text views keeping only
  the settings that *differ* from the new global while one that matched the old
  defaults comes out following it, and a current file passed through untouched
- the timezone: one instant read in Brussels and New York landing on different
  hours and dates, midnight as `00` rather than `24`, a time window deciding
  differently in each, and a misspelt zone refused by name
- the payloads: `ix` carrying the percentage, the bar's `m12`/`tp`/`rY` going
  out and text's `tp` going out *off*, text in the segment name, other
  segments switched off rather than emptied, the text fitting and ASCII rules,
  and an unchanged payload not being sent twice
- a custom body: both its segments going out, a whole-string `{{percent}}`
  arriving as a *number* rather than a string, its own `bri` beating the
  slider while an absent one takes it, the other entities' segments still
  switched off around it, a segment it shares not being switched off under it,
  and an unavailable reading filling as empty rather than throwing
- the text settings: every slider the effect has going out on a text segment,
  a view with none of its own taking all nine from the global, one overriding
  two of them keeping the global's other seven, a `false` override counting as
  an override against a global that is `true`, and both text styles resolving
  to the same sliders
- the fonts and rotations: each font round-tripping through `c2` and each
  rotation through `c3` with upright at 16 rather than 0, a quarter turn
  swapping every glyph's width and height so the same four letters stop
  fitting, a half turn leaving the boxes alone, each glyph centred by its own
  height, and a `c3` past 31 clamped into range
- the validator on settings: a misspelt override named as not a setting, and
  one left flat on the display told where it moved to
- an icon beside text: the solar glyph's `i` byte for byte as its hand-written
  body had it, the text from `textStart` with its resolved sliders and
  Lighten, its two segments owned and the others switched off, working as
  a case; three painter-written glyphs decoding and re-encoding unchanged, and
  WLED's continuation and range forms decoding; the validator refusing part of
  a panel, a `#`-prefixed colour, no room for text or picture, and font 5
- every segment going out clean: a bar, text and a custom body each setting
  every field a previous view could have left, a custom segment's own fields,
  bounds, `len` and partial `col` winning over the reset, and a segment it only
  switches off left as it is
- the template itself: the type rule above against interpolation, filling at
  any depth, an unknown name left verbatim, and a placeholder in a *key* being
  neither found nor filled
- the validator on a custom body: a placeholder typo refused with the path to
  it, no segments refused, a templated or fractional or out-of-range `seg` id
  refused, a body far larger than a panel needs refused, and a custom display
  not being made to carry a `segmentId` or a colour it has no use for
- the built-in items: every format against a fixed instant, midnight and noon on
  the 12-hour clock, every format being ASCII so nothing is stripped on the way
  to the device, each item offering only its own formats, a clock reaching the
  device as an ordinary text segment through its template, and the examples
  `/api/builtins` serves
- the validator on a built-in: no format refused with the choices named, the
  other item's format refused, a `bar` display refused, a stray format on a Home
  Assistant entity refused, and a custom body on one accepted
- what the picker is sent: a window with the counts of what was cut, built-ins
  ordered ahead of everything so a match cannot be truncated away, ids sorted,
  filters as an OR over id, name and device class, and a nonsense `limit`
  falling back rather than failing the request
- a panel with no Home Assistant entities subscribing to nothing rather than to
  everything, while still getting the snapshot that lets it start
- a connection that closes before Home Assistant ever speaks is reported as
  never having reached it, rather than as a bare retry
- the real socket against a fake HA that speaks the handshake
  (`tests/fakeHomeAssistant.ts`): auth, subscription, partial diffs surviving,
  a rejected token reported once rather than retried, and a dropped connection
  coming back with a fresh snapshot it had missed

**Not verified:** a successful exchange with the real Home Assistant or the real
WLED device — both are currently blocked by the Local Network grant above, so
the POST path has only ever run as a dry run. The failure path against both real
devices has been exercised, which is how that grant was found.

Also unverified against hardware: the bar's direction. `m12`, `tp` and `rY` are
read off WLED's own `json.cpp` and `FX_2Dfcn.cpp` (checked against both 0.15.0
and current `main`) — the Bar expansion, the `virtualWidth`/`virtualHeight` swap
on transpose, and `reverse_y` being applied before that swap — but no panel has
drawn one yet.

The editor has no tests. It was checked by hand against the mock source: the
three tabs, saving, a flow reordered, an entity added and removed, and the
validator's refusals. Most recently: both built-in items added from the picker
and the search surviving it, the clock and the date previewing at every format,
`bar` absent from a built-in's styles, the pickers in the flow and on the
Display tab, a picker staying open across the live poll, and a truncated library
page reporting what it left out. Then, against a copy of a real config: a rule
label, a text template and a time typed with real keystrokes without losing
focus; a time window saved and the panel falling through it; a version 1 file
upgraded on start and saved as current; one entity added to a rotation twice,
given its own view and both forms appearing in turn in the dry-run log; and a
weather entity chosen by state, the sample picking the icon case and then
`otherwise`. After the decluttering pass: all four tabs at 1440px and at 375px
with no sideways scroll, a placeholder chip inserted at the caret, a member's
own view opened from its badge, the header thumbnail following the panel, and
Ctrl+S saving.
