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

A sensor with no reading is left out of a rotation rather than taking its turn
and showing nothing — and a rotation with *nothing* left declines to match at
all, so the rules below it are tried. That is why a flow wants a conditionless
rule at the bottom.

Rotations have memory. Interrupted by music and then resumed, one comes back to
the entity it was on and gives it a full turn, rather than counting the
interruption against it. That position is not persisted: a restart begins at the
first member.

### Adding an entity

Click it, on the Entities tab. Nothing is configured in Home Assistant, and
nothing needs editing here.

`kind` picks the parse; `display.style` is intent (`'bar'` or `'text'`), not a
WLED effect id — which effect that becomes and which slider carries what is
`wled.ts`'s business. The third style, `'custom'`, is the way out of that
abstraction when the two intents cannot say what you want; see below. Entities
no longer carry a `role`: the order of the rules is the priority.

A `text` display says what it draws with a `text` template: `"{{value}}"` on
its own, or with anything around it — `"PV {{value}}W"` is a prefix and a
suffix, and there is no separate field for either. The placeholders are the
custom body's, below. `{{value}}` is the one that is fitted: a media player's
`Title - Artist` is tried in the template first, then `Title` alone, before
anything is cut at 32 characters. A reading that has dropped off draws
nothing, not the template's own text around a gap.

`PANEL_ENTITIES` in `entities.ts` is now only the **seed** for a fresh
`panel.config.json`. Once that file exists, it is the registry.

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
    "display": { "style": "text", "segmentId": 0, "color": [110, 175, 255], "speed": 60, "text": "{{value}}" }
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
running this is the one you can check. The payload diff means a clock costs one
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

A string that is **nothing but one placeholder takes that value's own type**, so
`"ix": "{{percent}}"` arrives as the number WLED needs. Anywhere else it is
interpolated and stays a string: `"bat {{percent}}%"`.

What the service still does for you, because a body cannot know it:

- **the other entities' segments are switched off**, appended to whatever `seg`
  you wrote — the same rule every display obeys, for the same reason
- **`on` and `bri` are filled in if you leave them out**, so the editor's
  brightness slider still reaches a custom display; name your own and it wins

What it insists on, in `panelConfig.ts`, for both the file and `PUT /api/config`:

- **`seg` is present, and every entry's `id` is a literal number.** The service
  has to know which segments a display owns *before* it has a reading, or it
  could not switch the others off — so an `id` cannot itself be a placeholder.
- **every placeholder is one that exists.** `{{percentage}}` is refused with the
  path to it, rather than scrolling across the panel as a literal.

## The editor

Three tabs on http://127.0.0.1:8000, bound to loopback — `PUT /api/config` is
unauthenticated, and this runs on a network that by construction has a WLED
device and a Home Assistant instance on it.

- **Entities** — a search box over what Home Assistant exposes, and the list of
  what the panel knows. The search is the *server's*: `/api/library` answers
  with a window of the matches and says how many it left out, so a Home
  Assistant with a few thousand entities never arrives in the browser at once.
  With no `HA_TOKEN` the picker offers the mock source's own ids instead. The
  two built-in items are always at the top of it.
- **Flow** — the chain above, as blocks you reorder. The block currently
  deciding is marked as you watch.
- **Display** — how one entity is drawn, with a mock-up of the panel, the exact
  segment name, and the real `/json/state` body. A custom display swaps the
  mock-up for a JSON editor and lists what each of its segment names filled to;
  the shared validator's complaint appears as you type.

One picker, used by all three tabs ([`public/picker.js`](public/picker.js)): a
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
deno task test       # 90 tests, no hardware; --allow-net is for the fake HA server
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
  folded a text display's `prefix` into its `text` template — and the start-up
  log says when it did. Until you save, the file on disk is still the old
  version, so it can be read by the old code.
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
  wrong timezone on the box running this is a wrong clock on the panel, and
  nothing in the editor can tell. The formats are written out rather than taken
  from `toLocaleString`, deliberately: that would make the panel depend on the
  host locale and on which ICU the Deno build carries, and recent ICU puts a
  narrow no-break space before `PM` — which `wled.ts` then strips, so `2:32 PM`
  would reach the device as `2:32PM` on one machine and `2:32 PM` on another.
- **A panel of nothing but built-in items sends no subscription at all.** An
  empty `entity_ids` is not how you ask Home Assistant for nothing — it reads a
  missing or empty filter as *every* entity. The empty snapshot is still
  emitted, because that is what tells the bridge it may start deciding.
- **A placeholder a reading cannot supply is empty or zero, not an error.** The
  same body may be in front of a sensor that has dropped off, and `{{percent}}`
  on a media player is `0` — the same thing a `bar` display draws. Nothing warns
  you, because there is no way to tell that case from one you meant.

WLED:

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
  out sideways. The text payload pins `tp`, `rY` and `m12` off for the same
  reason it pins `c2` and `ix`: unset means whatever was there before.
- **An empty segment name is not blank.** Scrolling Text falls back to drawing
  the date and time, so a segment is cleared by switching it off.
- **The segment name caps at 32 characters** (`WLED_MAX_SEGNAME_LEN`) and the
  device's fonts are ASCII only. There is no ellipsis glyph, so a long title
  drops the artist rather than being cut mid-word — otherwise the panel reads
  as a misspelling. A custom body writes its own names, so `{{value}}` is
  capped the same way but `{{title}}` is not: the device would cut it, and only
  the editor is in a position to warn you, which it does.
- **Short text does not necessarily sit still, and `c2`/`ix` have to be pinned.**
  `c2` is the font size — `map(c2, 0, 255, 0, 4)`, five built-ins, and font 0 is
  4px wide so eight glyphs are exactly 32 columns. `ix` is the Y offset, and
  Scrolling Text centres text that fits but at 0 or 255 scrolls it *vertically*
  instead; 128 is the static middle. Left unset, the device uses whatever was
  last chosen in its own UI, so `18C` could sit there crawling upwards and
  nothing here could predict how much text was visible. Both are now sent on
  every text segment.
- **The editor's preview is honest about being a mock-up.** The service draws
  with WLED's effects, never with pixels, so the device's glyphs cannot be
  reproduced in a browser. Letters are drawn one to a fixed cell of the same
  width font 0 uses, so the character count, the visible window and whether a
  string scrolls are right; the letterforms are not. The bar is drawn across 32
  columns, left to right, which is what the device does whatever the segment's
  height — but nothing here knows that height, so a bar on part of the panel is
  drawn taller than it will be. For a
  custom body there is **no mock-up at all**, deliberately: it can draw one
  scrolling string or one bar across the whole panel, and a custom body is
  neither. It lists the filled segment names and the finished JSON instead.
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

`deno task test` — 90 tests, no hardware and no Home Assistant:

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
- an old file: version 1 upgraded and then passing the current validator, a
  `prefix` becoming the text in front of `{{value}}`, and a current file passed
  through untouched
- the payloads: `ix` carrying the percentage, the bar's `m12`/`tp`/`rY` going
  out and text's `tp` going out *off*, text in the segment name, other
  segments switched off rather than emptied, the text fitting and ASCII rules,
  and an unchanged payload not being sent twice
- a custom body: both its segments going out, a whole-string `{{percent}}`
  arriving as a *number* rather than a string, its own `bri` beating the
  slider while an absent one takes it, the other entities' segments still
  switched off around it, a segment it shares not being switched off under it,
  and an unavailable reading filling as empty rather than throwing
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
page reporting what it left out.
