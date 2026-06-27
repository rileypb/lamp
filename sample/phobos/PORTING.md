# Phobos → Lamp porting log

Incremental port of the Inform 7 game at `~/dev/Inform/Phobos` to Lamp. Working
top-down from `story.ni`, then the Philip Riley extensions. Records what is
ported, what is **blocked** by a missing Lamp/advent feature (so we can revisit),
and **open questions** for the author.

I7 sources:
- Story shell: `Phobos.inform/Source/story.ni`
- Extensions: `Phobos.materials/Extensions/Philip Riley/*.i7x` (third-party
  extensions handled later)

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
- **Scoring / rank** (`Use scoring`, Score.i7x, Rank.i7x). Note: the *Galaxy
  Banner* extension is part of this — it's **not** a title screen but an ASCII
  graphic shown when the player scores a point. Now tracked in `TODO.md`
  (Smaller / opportunistic).
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
   real progression blocker is HACK, item 4.)* Door **descriptions** and the
   handprint-**scanner parts** are still deferred (Siriusian markup + parts).
2. **`[Siriusian]…[English]` markup** — renders text as the untranslated alien
   language (the player can't read it without the helmet/KIM). Pervasive in every
   description. From `Siriusian.i7x` + `Texts.i7x`.
3. **`feels` property + FEEL/TOUCH action** — nearly every object has a `feels`
   string. From `Can't Touch This.i7x`.
4. **`hackable` + HACK action** — the lock-bypass verb that drives progression.
   From `Actions.i7x` / `GJ Basics`.
5. **Parts / components** — `X is a part of Y` (handprint scanners, screens,
   buttons, levers). advent has no part-of relation.
6. **KIM / scanning** — `textual`, `scanning level N`, `content "…"`, the SCAN
   verb + Linguistic Module. From `KIM.i7x`.
7. **Open/close actions** for containers (cabinet, locker); advent's `box` has
   `closed`/`closable` fields but no open/close *actions*.
8. **Vehicles / ENTER / enterable supporters** — Moon Sled, Siriusian ship,
   chair, pilot's seat; the ENTER verb, vehicles, sitting on supporters.
9. **Scope/backdrop tricks** — `far away` (Mars, Stickney Crater), "place X in
   scope", "reaching inside" rules.
10. **Custom actions** — flying / ship-flying / simply-flying, listening,
    pulling, searching.
11. **`end the story saying "…"`** — advent has `story = won/lost` +
    `end_story_rules`; the custom final line needs a hook.
12. **Misc object properties** — `outdoors`, per-room `preposition`, `edificial`,
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
