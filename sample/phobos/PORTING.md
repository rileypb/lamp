# Phobos → Lamp porting log

Incremental port of the Inform 7 game at `~/dev/Inform/Phobos` to Lamp. Working
top-down from `story.ni`, then the Philip Riley extensions. Records what is
ported, what is **blocked** by a missing Lamp/advent feature (so we can revisit),
and **open questions** for the author.

I7 sources:
- Story shell: `Phobos.inform/Source/story.ni`
- Extensions: `Phobos.materials/Extensions/Philip Riley/*.i7x` (third-party
  extensions handled later)

## Presentation / house style (read first)

Phobos departs from advent's defaults in ways that affect almost all output, so
descriptions can't be ported verbatim. (Durable note also in agent memory
`phobos-presentation`.)

- **Third-person, name-based POV.** The protagonist is "Galaxy", with third-person
  verbs — never "you" ("Galaxy is in the passage end"; "it is north that Galaxy
  must go"). I7 *Third Person Narration* extension. The subject is the **name**,
  not a bare "she".
- **Room name embedded in prose, no heading.** No bold room-name line; the
  description paragraph opens "Galaxy is in the <room>. <description>" (room name
  lowercased, inline). `describe_room` must be **reshaped**, not just re-themed.
- **Siriusian is a glyph cipher.** `[Siriusian]…[English]` renders as unreadable
  Latin-Extended glyphs (e.g. `ſĺĺļĿŀĹıŧĹŁĽ`) until translated (helmet/KIM). In
  every room/sign description. Mapping lives in `Siriusian.i7x` / `Texts.i7x`.
- **Banner:** standard Inform format (title / "<headline> by <author>" / "Release N
  / serial / build"), not advent's "Version N <release>".
- **Banner placement (TODO):** the starting banner appears **between the intro
  narration and the Galaxy Jones reveal** — i.e. intro → banner → reveal → first
  room. advent currently prints its banner *before* `startup_rules` (banner → intro
  → reveal), so the order is wrong. Needs an advent seam: let the game trigger the
  banner mid-narration (e.g. a callable `print_banner()` invoked from within the
  startup sequence, with advent's auto-print made opt-out) rather than always
  printing it first.

## story.ni walkthrough

| I7 element (story.ni) | What it does | Status |
|---|---|---|
| story title / author (L1, 42–43) | bibliographic | **Done** — `game Phobos` |
| When play begins (L59–80) | intro narration | **Done** — `rule startup_rules` |
| Passage End | start room | **Done** — `base.lamp` |
| `about` verb (L107–110) | one-line blurb | **Done** — `action about` (see Deferred: out-of-world) |
| `help` verb (L112–115) | command help | **Done** — `action help` (see Deferred: out-of-world) |
| `credits` verb (L99–105) | playtester/credits | **Done (partial)** — `action credits`; static playtest/assist lines ported, the dynamic *extension credits* list omitted until extensions are ported |
| story headline (L44) | subtitle | **Done** — `tagline "A Looming Disaster"` turns on advent's banner |
| story release / genre / description / year (L45–48) | bibliographic | **N/A for now** — no advent fields; kept `version 0 / release dev` (partial-port markers) |
| Before looking for the first time (L85–86) | Galaxy Jones reveal beat | **Done** — appended to `startup_rules` (prints just before the first room description); `[bold type]`→`[bold]…[/bold]` |
| `Use scoring` + Score/Rank (L5) | scoring subsystem | **Blocked** — advent has no score/rank system |
| autopower down rule listed last (L95) | every-turn rule ordering | **Blocked** — every-turn rules not implemented (TODO item 2); also needs Powerup ext |
| `Instead of searching: try examining` (L92) | redirect search→examine | **Blocked** — no `search` action in advent yet |
| can't-exit response (A) (L97) | message override | **Blocked** — no exit/enter action in advent |
| parser clarification response (E) (L119) | "What should Galaxy…" | **Blocked** — parser feedback not author-exposed by name |
| describable/indescribable property (L8) | bool on all objects | **Blocked/minor** — only used by debug code; needs adding a field to a base type |
| Use MAX_STATIC_DATA / text length (L3, 6) | I6 VM memory tuning | **N/A** — no equivalent needed |
| Before starting VM / debug-now / RulesOnSub (L53–57) | I6 inline + rule tracing | **N/A** — debug only |
| NOT FOR RELEASE block (L122–164) | DEBUG flag, debug verbs, mistakes, test scripts | **Deferred** — debug tooling; the `test … with "…"` scripts are a useful porting oracle/walkthrough later |

## Blocked by a missing engine/library feature

These are things the I7 game does that Lamp/advent can't express yet. Some are
already on the engine roadmap in `TODO.md`.

- **Out-of-world verbs** (no turn taken; usable after the game ends). `about`,
  `help`, `credits` are out-of-world in I7; ported here as ordinary in-world
  actions. Tracked: `TODO.md` item 2 (Parser v2 → out-of-world actions).
- **Every-turn / timed rules** (the "autopower down rule"). Tracked: `TODO.md`
  item 2.
- **Scoring / rank** (`Use scoring`, Score.i7x, Rank.i7x). The custom phrase
  `score N` (Score.i7x) does three things in order: **(1) prints the Galaxy
  Banner** (a "Galaxy Jones" ASCII figlet — *not* a title screen, shown on every
  point-gain), **(2) increases the score by N**, **(3) fires the standard score
  notification** ("[Your score has just gone up by one point.]"). So each hack and
  every other point lands the banner + notification. **The green-door hack is thus
  only partly ported** — it opens the door but omits `score 1` (banner + score +
  notification, which belong between the bypass message and "Galaxy retrieves the
  KIM."). Deferred with scoring. Galaxy Banner.i7x also defines an **action banner**
  and a **power banner** (other events). The galaxy banner art (Galaxy Banner.i7x):

  ```
   _________      __                     _____
   __/ ____/___ _/ /___ __  ____  __     __/ /___  ____  ___  _____
   _/ / __/ __ `/ / __ `/ |/ / / / /____ _/ / __ \/ __ \/ _ \/ ___/
   / /_/ / /_/ / / /_/ />  </ /_/ / _/ /_/ / /_/ / / / /  __(__  )
   \____/\__,_/_/\__,_/_/|_|\__, /  _\____/\____/_/ /_/\___/____/
   _____________________________/
  ```
- **`search` action** and an **exit/enter** action. Not in advent.
- **Author-named parser feedback** beyond the existing `parser_cant_see` /
  `parser_no_understand` messages (e.g. the "What should Galaxy …?" clarification).
- **Adding a field to a base/library type** (the describable property) — needs a
  type-reopen idiom if/when the debug code is ported.

## Base.i7x (in progress)

Base.i7x is the **content** layer — ~14 rooms, the map, scenery and props —
layered on **infrastructure** defined in the other extensions (Base is `Include`d
*last* in story.ni). advent supplies almost none of that infrastructure.

**Ported (scaffold, in `base.lamp`):** the room declarations (names) and the
**door-free** connections. Navigable; rooms show name-only until descriptions
land. Door-gated rooms (Reactor Room, armory, Commander's Quarters, Control
Room, Flight Deck) are declared but not yet connected.

**Deferred — room descriptions.** Every room/sign description embeds
`[Siriusian]…[English]` markup and `[if <door> is closed]…` state, so none can be
ported verbatim yet (see infrastructure below). The simplified `Passage_End`
description already in `base.lamp` predates this and will be revisited.

**Infrastructure Base.i7x needs that Lamp/advent lacks** (rough priority):

1. ~~**Doors**~~ **DONE — built in advent.** A `door` type declares its two sides
   as `<direction> <room>` fields; closed doors block `go`; doors are examinable
   from both rooms (scope-provider seam). Phobos's 6 doors are wired in `base.lamp`
   with their I7 closed/locked/not-lockable state. **The base is currently SEALED**
   — there's no unlock/HACK verb yet, so only Passage End is reachable. *(Next
   real progression blocker is HACK, item 5.)* Door **descriptions** and the
   handprint-**scanner parts** are still deferred (Siriusian markup + parts).
2. ~~**Third-person room presentation**~~ **Heading DONE.** advent factors the
   heading into an overridable `room_heading_rules` rulebook (default unchanged) +
   `room` `preposition`/`always_indefinite` fields; Phobos's author-file rule
   prints the name-embedded intro that runs on into the description ("Galaxy is in
   **the passage end**. <desc>"). Remaining: contents reword "Also here is/are …"
   (needs a parallel contents seam), and the deferred third-person *action reports*
   / `[We]`-as-name (not take/drop) per the agreed scope.
3. ~~**`[Siriusian]…[English]` glyph cipher**~~ **Display cipher DONE.** Ported the
   `siriusian(text)` algorithm to a phobos-lib native (`lib/phobos/index.js`): a
   deterministic, deliberately **non-invertible** cipher (drops odd-position chars;
   shift-by-length; reverse; many-to-one glyph table). Used in descriptions as
   `[siriusian("…")]`. Verified: `siriusian("This way to the secret base")` ===
   `"ſĺĺļĿŀĹıŧĹŁĽ"`, and **the full Passage End description now renders byte-for-byte
   like the transcript.** Deferred: the **progressive per-word, scan-level reveal**
   (the Linguistic Module / KIM shows English for scanned words) — that's the
   KIM/scanning gameplay layer (item 7).
4. **`feels` property + FEEL/TOUCH action** — nearly every object has a `feels`
   string. From `Can't Touch This.i7x`.
5. **HACK / the KIM — in progress** (from `KIM.i7x`). The KIM tool + `hack` verb +
   the green door's instant bypass are done (`lib/phobos/hacking.lamp`): hacking it
   opens it and `go north` works — but **only partly**: the real hack also runs
   `score 1`, i.e. the Galaxy Banner + score notification (deferred with scoring;
   see the Scoring note above). Each other door is a *different* modal button
   mini-game (rules not explained): Lights-Out (yellow/red), sort-by-swap (blue),
   4-toggle (locker), pick-5-of-16 (purple, needs the scan/control-code system).
   **Blocked on the `press <n>` input** — the key is a number, but Lamp's parser
   only resolves slots to in-scope objects (number/text slots are roadmap). Fork:
   keys-as-objects (game-level) vs. number slots in the parser (engine).
6. **Parts / components** — `X is a part of Y` (handprint scanners, screens,
   buttons, levers). advent has no part-of relation.
7. **KIM / scanning** — `textual`, `scanning level N`, `content "…"`, the SCAN
   verb + Linguistic Module. From `KIM.i7x`.
8. **Open/close actions** for containers (cabinet, locker); advent's `box` has
   `closed`/`closable` fields but no open/close *actions*.
9. **Vehicles / ENTER / enterable supporters** — Moon Sled, Siriusian ship,
   chair, pilot's seat; the ENTER verb, vehicles, sitting on supporters.
10. **Scope/backdrop tricks** — `far away` (Mars, Stickney Crater), "place X in
    scope", "reaching inside" rules. (The scope-provider seam from doors is the
    hook.)
11. **Custom actions** — flying / ship-flying / simply-flying, listening,
    pulling, searching.
12. **`end the story saying "…"`** — advent has `story = won/lost` +
    `end_story_rules`; the custom final line needs a hook.
13. **Misc object properties** — `outdoors`, per-room `preposition`, `edificial`,
    `indescribable`, `always-indefinite`, `privately-named`.

Implication: Base content can't be finished until this infrastructure exists.
Likely the port should pivot to building the infrastructure (engine vs. phobos
lib — an open question), starting with **doors**.

## Resolved decisions

1. **Banner** — use advent's banner (`tagline "A Looming Disaster"`). *Galaxy
   Banner is a per-point scoring graphic, not a title screen.*
2. **First-look reveal** — appended to the startup narration.
3. **Sequencing** — `Base.i7x` next after story.ni's remaining items.

## Open questions for the author

_(none open — next up: Base.i7x)_
