# Phobos → Lamp porting log

Incremental port of the Inform 7 game at `~/dev/Inform/Phobos` to Lamp. Working
top-down from `story.ni`, then the Philip Riley extensions. Records what is
ported, what is **blocked** by a missing Lamp/advent feature (so we can revisit),
and **open questions** for the author.

I7 sources:
- Story shell: `Phobos.inform/Source/story.ni`
- Extensions: `Phobos.materials/Extensions/Philip Riley/*.i7x` (third-party
  extensions handled later)

## Goal: 1:1 parity with the original

The game is already playable start-to-win (Queen of Mars) through the real puzzles, but the
**target is a 1:1 port** — every behavior, message, and object of the original — as a proof of
Lamp's capabilities. The checklist below tracks what's left; we work through it one item at a time.
(Durable goal also in agent memory `phobos-1to1-goal`.)

### Remaining for 1:1 parity (work top-down)

**Subsystems (the meatier pieces):**
- [x] **TOUCH / FEEL + `feels`** (`Can't Touch This.i7x`): **DONE.** Machinery in advent — the
  TOUCH/FEEL verb (prints a thing's `feels` text or "[We] [feel] nothing unexpected."), the
  `feels` string + `feelable`/`far_away`/`obstructed`/`edificial` traits on `physical`, with the
  unfeelable/out-of-reach refusals and the trait-driven TAKE refusals (can't-take/can't-reach/too-
  massive). Golden `touch1`; see specs.md. **Per-object `feels` text ported** onto every currently-
  ported Phobos object (doors, the five documents, KIM/Linguistic Module, suit/pistol/chocolate,
  cyberhelmet/cybercarapace, the control-room + reactor + ship fixtures, the locker/cabinet, the
  guard, the dead guard, Galaxy herself), plus the I7 traits: `far_away` on Mars and Stickney Crater
  (→ "can't reach"), `edificial` on the Siriusian ship (→ "too massive to take"). The commandos' feels
  is state-dependent (fighting/unconscious/dead), so it's an `instead touch` in `guard_endgame.lamp`
  rather than a static field. *Residual:* the `feels` on objects **not yet ported** (the in-prose
  signs/poster, handprint scanners, the Moon Sled, sleeping pods, tile/counters, the PA System, the
  suit light, the RESET button) rides along with those objects when they land (sub-objects/backdrops/
  parts items below). `feel me`/`feel galaxy` needs the player's self-synonyms (the X ME item below).
- [ ] **Backdrops: walls / floors / ceilings** (`Walls.i7x` / `Floors.i7x` / `Ceilings.i7x` /
  `PBR Common.i7x`): examinable scenery present in *every* room (X WALL / FLOOR / CEILING / SKY /
  GROUND), per-room descriptions via tables, low-ceiling/outdoors variants. Needs a backdrop
  mechanism in advent (the scope-provider seam doors use is the hook).

**Alternate paths / behaviour:**
- [ ] **SAY / ANSWER free-text** (`Guard.i7x`): "say I am human" / "I'm from earth" →
  player-assert-humanity → the alliance *without* a gift; the loyalty YES/NO after giving the log.
  A free-text SAY/ANSWER mechanism distinct from ASK-about-topic — a currently-unreachable solution.
- [ ] **"Distracted → shot" mid-fight** (`Guard.i7x`): doing anything but attack/shoot while a
  commando is up gets Galaxy killed (today she simply can't flee).
- [ ] **Noun forms of FLY** ("fly ship" / "operate panel") and the ship-flying/simply-flying split
  (`Base.i7x`).
- [ ] **`blowing up the base` scene flavour** (`Guard.i7x`): audit the guard-leading lines against
  the original for any missed beckons/variants.

**Messages / polish:**
- [ ] **Custom "can't go that way"** (`Can't Go That Way.i7x`): per-room excuse messages.
- [ ] **Custom attack / take refusals** (`Can't Hit That.i7x`, `Can't Take That.i7x`, the
  `Phobos Polish` Table of Attacking): e.g. "Galaxy pounds pointlessly on the Moon Sled's hull" +
  powered variants.
- [ ] **Power / action banners** (`Galaxy Banner.i7x` + `Powerup.i7x`): the POWER figlet on
  power-up, and the little action banner.
- [ ] **Banner placement** (`story.ni`): the title banner should appear *between* the intro
  narration and the Galaxy Jones reveal (intro → banner → reveal), not before `startup_rules`.
  Needs an advent seam (a callable `print_banner()` + opt-out of the auto-print). See house-style note below.
- [ ] **In-prose sub-objects as examinables** (`Base.i7x`): the door/west/store signs and the
  barracks poster, declared as scenery so X SIGN / X POSTER work.
- [ ] **Handprint-scanner door-parts** (`Base.i7x`): each door's scanner as a real part-object.
- [ ] **Examine-self disguise variants** (`Cyborg.i7x`): X ME / X GALAXY changes with the disguise.
- [ ] **`indescribable` objects + button asides** (`Phobos Polish.i7x` / `Polish.i7x`): yourself,
  the disruptor pistol, etc. marked indescribable; the "Why not press it instead?" button replies.

**Audit passes (may add items):**
- [ ] **`Actions.i7x`** — audit for unported custom actions (shooting, listening, searching →
  examining, etc.).
- [ ] **`Improved Pushing.i7x`** — pushing things between rooms (likely N/A; confirm).
- [ ] **`GJ Basics.i7x` / `PBR Common.i7x` / `Polish.i7x`** — sweep for leftover behaviours.
- [ ] **Final line-by-line parity pass** over every extension + `story.ni` once the above land, to
  catch missed messages and edge cases.

**Infrastructure (enabling, not game content):**
- [x] **Automate `test endgame` in CI** — *done.* Golden discovery now walks one level into
  subdirectories (`tests/golden/run-golden.js` `lampInputsIn`), so `sample/phobos/phobos.lamp` is a
  golden: stdin `test endgame` / quit, expected the full ~750-line winning transcript (`phobos`
  golden; no pinned generated JS, so it doesn't churn). The whole game is now a deterministic
  regression check — re-run `npm test`.

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
| autopower down rule listed last (L95) | every-turn rule ordering | **Done** — advent now has `every_turn_rules` (run_command returns turn-spent); `suit.lamp` wires the auto-power-down as an every-turn rule (skips the power-up turn via a flag) |
| `Instead of searching: try examining` (L92) | redirect search→examine | **Blocked** — no `search` action in advent yet |
| can't-exit response (A) (L97) | message override | **Blocked** — no exit/enter action in advent |
| parser clarification response (E) (L119) | "What should Galaxy…" | **Blocked** — parser feedback not author-exposed by name |
| describable/indescribable property (L8) | bool on all objects | **Blocked/minor** — only used by debug code; needs adding a field to a base type |
| Use MAX_STATIC_DATA / text length (L3, 6) | I6 VM memory tuning | **N/A** — no equivalent needed |
| Before starting VM / debug-now / RulesOnSub (L53–57) | I6 inline + rule tracing | **N/A** — debug only |
| NOT FOR RELEASE block (L122–164) | DEBUG flag, debug verbs, mistakes, test scripts | **Partly done** — the **`test … with "…"` runner is built** (see below); other debug verbs (PURLOIN/SHOWME/GONEAR/…) are in `lib/advent/debug.lamp` + Phobos's `late`/`scanall`/`arm`/`disguise`. The mistakes (`*`) and the faithful puzzle-walkthrough scripts are still to do |

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

**Ported (in `base.lamp`):** the room declarations and the door-free connections,
and now **every room description** (Base.i7x). Siriusian signage uses the static cipher
`[siriusian("…")]` (always alien, like the Passage End door label) and door-state shows
via `[if <door>.closed]…[end if]`; both render correctly in play (verified open↔closed
across the green/yellow doors). The North Barracks `cabinet` was added (a scenery `box`)
so its `[if cabinet.closed]` resolves. Door-gated rooms (Reactor Room, armory,
Commander's Quarters, and now the Control Room via their puzzles — the purple door's keypad
is ported; the Flight Deck lies beyond the Control Room's still-unported door) all have
descriptions in place.

**Scan-aware Siriusian labels: DONE.** `siriusian("…")` is now scan-aware — the per-word filter
the documents use was extracted into a string-returning `translate(text, levels)`, and both
`print_translated` (documents) and `siriusian` (inline signs/labels) call it against the global
`scan_levels`. So every sign, door label, and serial reads progressively: a word turns to English
once its tier is scanned (proper-noun/control words `!`/`$` stay alien). Text that must stay alien
regardless — the blue keypad's digit glyphs — calls the raw `siriusian_word` directly. In a plain
(non-TTY) transcript the `fixed()`/`bold()` styling drops, so an all-alien label is byte-identical
to before (verified: the Passage End label still renders unchanged at the start).

**Deferred (room-description follow-ups):** The remaining in-prose **sub-objects** (door/west/store
signs, the poster, the reactor levers) are mentioned in description text but not yet declared
as examinable objects. (The sign-out form, the Cyberhelmet, and now the **Control Room
furniture** — central control panel, screens, chair, launch/self-destruct buttons — are real
objects.)

**Control Room furniture (Base.i7x "Book - Control Room"): ported as scenery (EXAMINE only).**
The six fixtures (central control panel, screens, control room chair, the collective buttons,
the launch button, the self-destruct button) are scenery `item`s in `Control_Room` with their
Base.i7x descriptions and synonyms (bare "button" disambiguates the three; "green"→launch,
"red"→self-destruct, "controls"→panel). The generic **PUSH verb is in advent** (`push
[target]`, any item, default "Nothing obvious happens."; `instead push` to respond), so the
buttons are pushable — inert until their endgame `instead push` rules land. The Phobos keypad
action was renamed **`press_key`** (was `press`) to keep PUSH (items) and PRESS (keypad keys)
from colliding — faithful to Inform (KIM.i7x gates its "press [key]" to active hacking, while a
button is pushed). **Deferred:** advent has no part-of relation, so each fixture is a standalone
object rather than "part of" the panel; the `feels`/TOUCH strings (no TOUCH verb);
SIT/enterable-supporter for the chair.

**Button push behaviour (Guard.i7x, base/no-guard variants): ported in `control_room.lamp`.**
Two `instead push` rules on the buttons: **launch** = the immediate loss (Galaxy fires the
thruster and destroys Mars herself) — it ends the story with a banner specific to that ending,
carried by a new `ending_override` global (the Lamp analogue of I7's `end the story saying "…"`;
`end_story_rules` in phobos.lamp prints it when set, else the generic win/lose line — reused by
the Guard death endings later). **self-destruct** = starts the sequence and sets
`self_destruct_pushed`, telling Galaxy the reactor's arming levers must be engaged; pushing it
again reports it is already running. **Deferred:** the guard-present overrides (the cyborg's
suspicion → "spy!" → death-or-suit-deflect).

**Flight Deck + Siriusian ship (Base.i7x "Book - Flight Deck"): ported.** The flight-deck scenery
(Stickney Crater, Mars, the static force field), the ship, its interior room `Inside_The_Ship`,
and the pilot's seat + ship control panel are in `base.lamp`; the ENTER + FLY behaviour is in
`flight_deck.lamp`. New advent generics this needed: an **`enter` action** (`enter [target]`,
fails by default, `instead enter` to respond; golden `enter1`) and the **`inward`/`outward`
directions** (typed `in`/`out`; named that way because `in` is a reserved keyword). Enter the
ship (or go `in`/`north`) → the interior; `out` leaves. **FLY** (the bare verb, with synonyms)
decides the ending: a **loss** if the self-destruct isn't armed (Galaxy flees but Phobos still
hits Mars — reachable now), the **heroic win** once `self_destruct_in_progress` is set. Both
endings use `ending_override`. The flight deck is reachable in normal play via the powered
suit-smash on the flight-deck door (`suit.lamp`); the door's guard/handprint opening is deferred.
A debug verb **`arm`** (not-for-release) sets `self_destruct_in_progress` so the win is testable
before the guard lands. **Deferred:** the commandos Galaxy can carry to safety (+ their scoring),
the `blowing up the base` scene's extra flavour, and noun forms of FLY ("fly ship"/"operate
panel"). The guard-driven lever arming that normally sets `self_destruct_in_progress` is the last
big missing piece (the Guard).

**The Guard — conversation foundation (Guard.i7x): ported.** The Siriusian guard is now a
conversational NPC in the control room (`guard.lamp`). Conversation lives in a **new third
library `lib/conversation`** (kept out of core advent — conversation is a matter of taste; the
game pulls it in with `lib conversation`, declared between `lib advent` and `lib phobos`). It adds
the `subject` topic type + the `ask`/`tell` actions (ASK GUARD ABOUT X / TELL GUARD ABOUT X); see
specs.md. The ~43 topics from the Table of Conversing are `subject` objects each carrying its
`reply` — no table primitive needed (decided: subjects carry their own data). **Guard speech is
Siriusian, scan-aware** — the guard speaks the alien language, and Galaxy understands a reply only
as far as she has scanned it, so the reply (English *source* text) is rendered through `siriusian()`
exactly like the signs (a guard `instead ask`/`tell` override; rendered via `write()` so a
multi-sentence reply isn't broken per sentence by print's sentence-end rule). Proper nouns that
stay alien (`!NB563FFAA`, `!x34agclw`, `!Cleopatra`) carry the `!` marker. Also: **EXAMINE now
targets any `physical`** (was `item`), so NPCs/scenery are examinable (byte-invariant; golden suite
green). The log/diary/chocolate topics use their "not yet given" replies. Every *spoken* line in
the whole Guard arc — the greeting, the gift reactions, the alliance, the lever/flee/death lines,
and the control-room PA announcements — goes through the same scan-aware path via a `g_say(speech)`
helper (narration stays plain English; only the quoted speech is Siriusian). In normal play the
guard is reached only after a full scan (the purple-door code needs it), so the speech reads in
English; reach it under-scanned (debug `gonear`) and it is alien.

**The Guard — persuasion + the alliance reveal (Guard.i7x): ported** (`guard_persuasion.lamp`).
New advent generics: **GIVE / SHOW** actions (`give [gift] to [recipient]`, `show [shown] to
[recipient]`; fail by default, `instead give`/`instead show` to respond; golden `give1`). Galaxy
wins the guard over with a **pleasing action** — give or drop the disruptor pistol, give the
commander's log, or give the chocolate bar (all carried from the start now). Once `guard_pleased`,
removing the Cyberhelmet or Cybercarapace fires the **alliance reveal**: the guard recognizes her
humanity, allies, slams the self-destruct (sets `self_destruct_pushed`), and asks her to come help
with the levers. **Death-on-detection**: standing in the control room undisguised and not-yet-
pleased gets Galaxy shot (every-turn). A disguised first entry triggers the guard's **greeting**.
A not-for-release **`disguise`** debug verb (dons both pieces) eases testing past the purple door.
**Death-on-detection**, the greeting, and the meeting/blowing-up "scenes" are modelled with flags +
every-turn rules rather than a general scene abstraction.

**The Guard — endgame: ported** (`guard_endgame.lamp`). After the alliance the guard **leads**
Galaxy to the reactor (NPC movement via co-location-keyed every-turn rules: the guard steps to the
next room when Galaxy is with it, so she follows each step) and pulls the **left** arming lever;
Galaxy pulls the **right** to arm the self-destruct (`self_destruct_in_progress`, countdown 20) —
retiring the `arm` debug crutch. The guard then leads back to the control room, where two
**commandos** (a small `commando` type with defeated/dead state) burst in. Galaxy **ATTACK**s them
(unconscious) or **SHOOT**s them with the disruptor pistol (dead; a new Phobos `shoot` action that
needs the pistol still in hand — so giving it away earlier forecloses that path); she can't leave
mid-fight. Downing the second commando triggers the guard's death (it shielded her), opens the
flight-deck door, and clears the way to the ship and the win. To make people attackable/examinable,
advent's **`examine` and `attack` now target `physical`** (was `item`; byte-invariant). **Deferred:**
**scoring** (carrying the unconscious commandos to safety earned points in I7), the "distracted ->
shot" punishment for non-combat actions mid-fight (here she simply can't flee), and the SAY/ANSWER
free-text asides (assert-humanity / loyalty yes/no — a separate text-topic mechanism). The
unconscious commandos can be **carried to the ship** (one at a time; a shot/dead one can't be
saved) for the score bonus (see Scoring below). **`test endgame` plays the whole game to victory,
saving both commandos for the full score, with no debug shortcuts.**

**Scoring + the Galaxy Banner (Score.i7x / Galaxy Banner.i7x / Rank.i7x): ported.** A general
**score subsystem** lives in advent (`scoring.lamp`): `score`/`max_score` globals, `award_points(n)`
(+ the notification), and the out-of-world **SCORE** verb (see specs.md). Phobos (`scoring.lamp`)
wraps it as **`galaxy_score(n)`** — which flashes the "Galaxy Jones" ASCII figlet (`fixed()`
monospace) on every point — and maps the final score to a **rank** (Cyborg Bait → Queen of Mars),
shown in the end banner. Eleven points (`max_score = 11`): the six puzzle solves (green/yellow/red/
blue/locker/purple), the alliance, arming the reactor, the **launch** (+1), and **+1 for each
unconscious commando carried into the ship** (max 2). So the top rank of **Queen of Mars** (11)
*requires saving both commandos* — punch them (TAKE the unconscious ones, one at a time, drop them
in a passenger seat) rather than SHOOT them dead; shooting both caps the run at 9 (Dame of Deimos),
faithful to I7. The suit-smash bypass earns nothing. **Deferred:** the power/action banners
(Powerup/Galaxy Banner extras).

**TEST runner (story.ni L159–163's `test … with "…"`): the mechanism is built** (general; in
`lib/advent/debug.lamp`, see specs.md "Debug: the TEST runner"). `test [name]` queues a
`test_script`'s `"/"`-joined commands through the real command loop; a script may begin with
another `test name` (expands in place). Phobos ships four scripts in its debug file:
**`test most`** — the faithful puzzle walkthrough (ported from story.ni's "test most"): collects and
scans all five documents and solves every keypad (green/yellow/red/blue/locker/purple), ending
disguised in the control room; **`test endgame`** — `test most` + the guard win (give chocolate →
reveal → arm → fly to the victory banner); plus quick all-debug **`test talk`** and **`test win`**.

**Deterministic puzzles for the walkthroughs (story.ni's `DEBUG is true`).** Two keypads use the
RNG: the purple control code (`shuffle 1-16, take 5`) and the blue sort-by-swap arrangement.
Mirroring I7's NOT-FOR-RELEASE `DEBUG is true` (which forces the control code to `12345` and the
blue order to `{2,1,3..}`), a Phobos **`debug_mode`** global — set true by a `startup_rules`
contribution in the (not-for-release) debug file — forces the purple code to buttons **1-5** and
the blue arrangement to a single swap (**press 1/press 2**). A release build excludes the debug
file, so `debug_mode` stays false and both shuffle randomly for players. The Lamp keypad solutions
(yellow **2,3,5,7,9**; red **1,2,3,5,7**; locker **1,4**) are the port's own, computed from its
flip-sets (they differ from I7's).

**Reactor Room furniture + arming levers (Base.i7x "Book - Reactor Room"): ported.** The reactor
control board and the two arming levers (left/right) plus the collective "levers" are scenery
`item`s in `Reactor_Room` (`base.lamp`); the reactor manual was already a textual document. The
generic **PULL verb is now in advent** (`pull [target]`, any item, default "Nothing obvious
happens."; shares the `nothing_happens` reason with PUSH; golden `pull1`). The levers' **no-guard
PULL behaviour** is in `control_room.lamp`: a single lever "springs back… nothing happens", and
grabbing both is "too far apart for one person to pull at once" — because arming needs *two*
people. **Deferred (guard-driven):** the actual arming — the Siriusian guard pulls the left lever
and holds it, Galaxy pulls the right, setting `self_destruct_in_progress` (countdown.lamp) and so
the doom-clock's heroic win — ports with the Guard (its lever rules go more specific / earlier
than these "guard not present" fallbacks). Still unported: the flight deck + escape ship.

**Infrastructure Base.i7x needs that Lamp/advent lacks** (rough priority):

1. ~~**Doors**~~ **DONE — built in advent.** A `door` type declares its two sides
   as `<direction> <room>` fields; closed doors block `go`; doors are examinable
   from both rooms (scope-provider seam). Phobos's 6 doors are wired in `base.lamp`
   with their I7 closed/locked/not-lockable state. **The base is currently SEALED**
   — there's no unlock/HACK verb yet, so only Passage End is reachable. *(Next
   real progression blocker is HACK, item 5.)* Door **descriptions** and the
   handprint-**scanner parts** are still deferred (Siriusian markup + parts).
2. ~~**Third-person room presentation**~~ **Heading DONE.** advent factors the
   heading into an overridable `room_heading_rules` rulebook (default unchanged);
   Phobos's author-file rule prints the name-embedded intro that runs on into the
   description ("Galaxy is in **the passage end**. <desc>"). The presentation fields it
   needs — `preposition` ("in"/"on") and `always_indefinite` — are **Phobos's**, added by
   reopening the `room` type in `base.lamp` (advent's `room` stays free of game-specific
   presentation; the rooms set the fields where they differ from the defaults). **Third-person viewpoint DONE:** advent's player-facing
   `[We]`/verb messages now render by the **story viewpoint** — Phobos sets
   `viewpoint_person = 3` (in `startup_rules`) and `gender "female"` on `yourself`, so the
   room-contents listing reads "She sees a form here." and examine-nothing "She sees
   nothing unusual about …". This filled a real engine gap: the viewpoint formerly carried
   person+number only, hard-coding gender to neuter (→ "it"). The locale's `viewpoint()` now
   reads **gender off the player object** (`player.gender`, the same source the subject
   pronouns use) rather than a separate global — so it tracks the main character (reassign
   `player` and the pronoun follows). advent's `room_contents_intro` switched from a
   hard-coded "You see " to the `[We] [see]` sugar (byte-invariant for default 2nd-person
   games). `gender "female"` works in both locales (en-US `gender_of` and fr-FR
   `is_feminine` both accept it). Remaining: the deferred third-person
   *action reports* (NOT take/drop — those stay "Taken."/"Dropped." per the agreed
   scope), and the still-2nd-person **parser feedback** ("You can't see any such thing.")
   — a separate message family (`parser_cant_see`/`parser_no_understand`).
3. ~~**`[Siriusian]…[English]` glyph cipher**~~ **Display cipher DONE.** The
   `siriusian(text)` algorithm — a deterministic, deliberately **non-invertible** cipher
   (drops odd-position chars; shift-by-length; reverse; many-to-one glyph table) — is now
   a **pure-Lamp function** (`lib/phobos/linguistics.lamp`; see the native→Lamp migration
   below). Used in descriptions as `[siriusian("…")]`. Verified:
   `siriusian("This way to the secret base")` === `"ſĺĺļĿŀĹıŧĹŁĽ"`, and **the full Passage
   End description now renders byte-for-byte like the transcript.** **Reading DONE (slice 1
   of the Linguistic Module):** the **progressive per-word, scan-level reveal**
   (`lib/phobos/linguistics.lamp`, `print_translated`). The `textual` marker + `content`
   + `scan_level` are added to `item` by **reopening the type in Phobos** (no `document`
   subtype, advent untouched); examine/read renders the content word-by-word through the
   filter — each word translates to English (bold) once its difficulty tier (`!`/`$`/`#`
   = proper-noun/control tiers 15/16/20, else a 1-5 char-sum hash) is in the global
   `scan_levels`, otherwise it shows as fixed-width Siriusian; `/` = paragraph break.
   Emitted via `write()` so only `/` breaks the prose (no per-sentence auto-break). The
   diary is the first textual item — its **full text is ported** from Texts.i7x (content1 +
   content2, 9 paragraphs); `!`-proper-nouns stay alien even fully scanned, and word-final
   possessives use the `[']` escape so the quote convention doesn't turn `humans'` into a
   typographic `"`.
   **All five textual documents DONE:** the remaining four are ported (`base.lamp`), one per
   tier — the **sign-out form** (1, storeroom), **science notebook** (3, science lab),
   **reactor manual** (4, reactor room), and **commander's log** (5, commander's quarters) —
   joining the diary (2) for **full tier coverage**, so scanning every document now unlocks
   complete translation (the log's tier-20 `#` security-key words reveal only once all five
   tiers are scanned, dropping the `#`). Tier markers verified end-to-end: `!` proper noun
   (angle-bracketed, always alien), `$` control word (always alien, no brackets), `#`
   security-key (reveals at full scan), `[']` literal apostrophe, `/` break. The form alone
   carries a physical `description` (its wall framing + "It reads in part:"), now shown before
   the readable content by the textual-examine rule (other documents leave it empty).
   **Initial appearances DONE:** each loose document has its Base.i7x **initial appearance**
   ("A form hangs on the wall beneath the sign.", "Someone has left behind a science notebook
   …", etc.) — shown as its own paragraph in the room until first picked up, after which it
   joins the standard "She sees … here." list. This dogfooded a new general advent feature:
   `item.initial_appearance` + a `handled` flag set on take, with `listable_contents` pulling
   not-yet-handled initial-appearance items out of the contents list (golden
   `initial_appearance1`). They stay in scope (examinable/takeable) the whole time.
   **Control-code reveal DONE (purple-door slice 2):** once all five tiers are scanned, the
   log's `#`-security-key sentence resolves ("The new security key for control is") and a
   dedicated examine rule (in `hacking.lamp`, which loads before `linguistics.lamp` so it
   handles the log) appends "The decoded security key reads: <five glyphs>". Those glyphs are
   the purple-door control code (see the purple-door note below).
   **Scanning DONE (slice 2):** the **SCAN verb + Linguistic Module item** (carried from
   start). `scan [target]` marks the text `scanned` and flips its tier on in `scan_levels`,
   so every text of that tier reads more clearly afterward. Guards: not-textual (a friendly
   "needs more text" message), already-scanned, and not-carrying-the-Module. `scan_levels`
   is a fixed five-slot `list<bool>` (one per tier) so adding a tier is plain element
   assignment — no list append. The temporary `reveal` lever is gone. Undo reverts scan
   state.
   **Native→Lamp migration DONE:** the entire Phobos native JS (`lib/phobos/index.js`,
   now deleted) — the Siriusian cipher, `token_difficulty`, and `print_translated` — is
   rewritten in pure Lamp on new lib/sys string primitives (`length`/`char_at`/`code_at`/
   `substring`) and the new `mod` operator; verified **byte-identical** to the native (door
   label + diary). `is_textual` collapsed into the pure-Lamp guard `self.target.textual`.
   **Deferred:** the `obscure`/`revealed` real-name/real-description swap on examine.
   (Full translation is now reachable — all five tiers have a document; see above.)
4. ~~**`feels` property + FEEL/TOUCH action**~~ **DONE** (from `Can't Touch This.i7x`): the
   TOUCH/FEEL verb, the `feels` string and `feelable`/`far_away`/`obstructed`/`edificial` traits
   on `physical`, the unfeelable/out-of-reach refusals, and the trait-driven TAKE refusals (golden
   `touch1`; specs.md). The **per-object `feels` text is ported** onto every currently-ported Phobos
   object, with `far_away` on Mars/Stickney Crater and `edificial` on the Siriusian ship; the
   commandos' state-dependent feels is an `instead touch`. Residual feels ride with the not-yet-
   ported sub-objects (signs/scanners/Moon Sled/pods/tile/PA/suit-light/RESET button).
   ~~**Galaxy Suit + power-up (GJ Basics / Powerup / Galaxy Smash)**~~ **DONE**
   (`lib/phobos/suit.lamp`): the worn Galaxy Suit, `powered_up`/`charges_left`/
   `first_power_use` globals, POWER UP/DOWN actions (with the `--`-optional "suit"
   variants + already-powered / out-of-charges / not-powered checks). The
   **ATTACK/HIT/SMASH/PUNCH verb itself lives in advent** now (any `item`; default
   declines via `attack_violence`); the suit layers the **powered smash** on top with
   `instead attack` rules — a powered strike destroys any locked door open (purple resists
   with a force field), and anything not handled (unpowered, a non-door, an already-open
   door) falls through to advent's default. A `use_charge()` helper powers down,
   decrements, and prints the first-use no-points note. **Great for testing** — POWER UP
   then ATTACK bypasses any door's hacking puzzle. The every-turn **auto-power-down** is
   now wired (a powered-but-unused suit powers down next turn — "Unused, the Galaxy Suit
   powers down."; the power-up turn is skipped via a flag), via advent's new
   `every_turn_rules`. **Deferred:** the power banner (with scoring) and the locker-smash
   variant.
   ~~**Cyberhelmet + Cybercarapace (Cyborg.i7x)**~~ **DONE (first slice)**
   (`lib/phobos/cyborg.lamp`): the two disguise wearables — the **Cyberhelmet** (in the
   North Barracks cabinet) and **Cybercarapace** (loose in the armory, using the new
   `initial_appearance`). Each `wear` is handled by an `after wear` rule that prints the
   item's own message (replacing advent's second-person default report — `after` runs before
   the report band and `stop`s it) and, once both are worn, the completion line "She is now
   disguised as a Siriusian cyborg." The cabinet starts **closed**; the player OPENs it (see
   the OPEN/CLOSE note below) to reveal the helmet. The disguise *payoff* (the purple-door
   visual-identity gate and the guard interactions) is ported with the endgame, and the
   helmet's **number-translation** (the doom-clock count reads in plain numerals while worn) is
   in `countdown.lamp`. **Deferred:** the examine-self disguise variants and `feels`.
5. **HACK / the KIM — in progress** (from `KIM.i7x`). The KIM tool + `hack` verb,
   the green door (instant bypass), and the **yellow and red doors (Lights-Out
   keypads)** are done (`lib/phobos/hacking.lamp`): `press [n]` flips a hidden
   per-key set of the 9 buttons (red `[N]`/blue `<N>`), solving opens the door.
   Yellow starts all-red; red starts with button 6 already blue and uses a
   different (harder) flip-set — the shared all-blue goal check is `nine_solved()`.
   Built on the new number slots + mutable `list` state. Edge cases handled
   (press-when-idle, re-press undoes, hack-while-adhered). Red solution: 1,2,3,5,7.
   The **blue door** is a different mechanic — a *sort-by-swap*: the nine buttons
   carry shuffled Siriusian digit-glyph labels (`number_order` list), pressing two
   lights+swaps their labels, goal is to sort them (`number_order == 1..9`). Its
   random start shuffle dogfooded the **general `random(n)` native** and now the general
   **`shuffle(list)` native** (both lib/sys, on the engine's seeded/save-captured RNG);
   `shuffle_labels()` just calls `shuffle(number_order)` and reshuffles if it lands sorted.
   The exact start order is deterministic under the fixed test seed (and changed when the
   shuffle moved to the lib/sys native), but no test pins it.
   The **locker** (in South Barracks, the one room ported in full — its description
   has no Siriusian markup) is a four-button toggle (each press flips only itself;
   start `{red,blue,blue,red}`, goal all-blue → press 1 and 4). Unlike the doors it
   opens a **container** and reveals the **diary** sealed inside — which dogfooded a
   general advent feature: a **closed container hides + seals its contents** (the
   `contents_of` closed-check for listings + a core **scope-barrier seam**
   `registerScopeBarrier` so closed contents are out of scope; golden `closedbox1`).
   Chosen (author): the KIM.i7x 4-button puzzle, not Base.i7x's simple bypass.
   **Purple door — slices 1+2 DONE:** a 16-button **select-five** keypad gated on the cyborg
   disguise. Hacking it checks that Galaxy wears both the **Cyberhelmet and Cybercarapace**
   ("Visual identity confirmed/not confirmed"); on confirm the KIM attaches and shows the
   keypad. `press [n]` (1-16) toggles a button lit/dark; lighting exactly the five
   `control_parts` opens the door (→ the control room), while a fifth wrong selection beeps
   and resets all to red. **Slice 2 (the clue):** the code is **random** — `ensure_control_parts`
   shuffles 1-16 and takes five (lazily, at the first hack or fully-scanned log read). Each
   button carries a distinct Siriusian glyph (`button_glyphs`, 16 non-aliasing cipher glyphs);
   the **fully-scanned commander's log** reveals the five code glyphs, and the **keypad shows
   every button's glyph**, so the player decodes glyph → button number by matching. A
   NOT-FOR-RELEASE `scanall` debug (like `late`) completes the model for testing.
   `read` is now a synonym for `examine` (advent), so reading the diary
   shows its description. Deferred for the locker: the sleeping-pod scenery and the
   `personal/effects/chest/trunk` synonyms.
   **Still partial:** every solve also runs `score 1` (Galaxy Banner + notification)
   — deferred with scoring (see the Scoring note above). RESET button deferred
   (re-pressing a button undoes it, so it's not required to solve).
6. **Parts / components** — `X is a part of Y` (handprint scanners, screens,
   buttons, levers). advent has no part-of relation.
7. ~~**KIM / scanning (Linguistic Module) + all documents**~~ **DONE** (item 3 above):
   `textual`, `content`, `scan_level`, `scanned`; the per-tier translation filter +
   examine/read surface (slice 1), the SCAN verb + Linguistic Module item (slice 2), and
   **all five textual documents** (form/diary/notebook/manual/log, tiers 1-5). The log's
   control-code reveal is now wired (purple-door slice 2, above). Remaining is only the
   `obscure`/`revealed` real-name swap noted in item 3.
8. ~~**Open/close actions** for containers~~ **DONE (containers).** advent now has
   **OPEN/CLOSE** (`shut`) over `box`es: opt in with `closable true`, opening reveals
   newly-visible contents, a `locked` box refuses ("seems to be locked"). The cabinet
   (`closable`/`closed`) and the locker (`closable`/`locked`, unlocked by the hack so OPEN
   can't bypass the puzzle) use it. **Deferred:** LOCK/UNLOCK verbs, and OPEN/CLOSE on
   **doors** (kept on their own passage/hack mechanism — revisit with the door work).
9. **Vehicles / ENTER / enterable supporters** — Moon Sled, Siriusian ship,
   chair, pilot's seat; the ENTER verb, vehicles, sitting on supporters.
10. **Scope/backdrop tricks** — `far away` (Mars, Stickney Crater), "place X in
    scope", "reaching inside" rules. (The scope-provider seam from doors is the
    hook.)
11. **Custom actions** — flying / ship-flying / simply-flying, listening,
    pulling, searching.
12. ~~**`end the story saying "…"`**~~ **DONE.** The custom final line is a
    game-contributed `rule end_story_rules when story == won/lost:` that prints the
    bespoke text and `stop true`s to suppress advent's default banner. **Must live in
    the main game file** (`phobos.lamp`): only main-file rules register at author order
    (0), ahead of advent's order-1 default `when story == …` rules — a lib-file
    contribution would register at library order and lose. Used by the countdown (below).
13. **Misc object properties** — `outdoors`, per-room `preposition`, `edificial`,
    `indescribable`, `always-indefinite`, `privately-named`.
14. ~~**The self-destruct doom-clock (Countdown.i7x)**~~ **DONE**
    (`lib/phobos/countdown.lamp`): a `countdown` turn counter (789) decrements every turn
    via advent's `every_turn_rules`; once Galaxy is **inside the base** (`holder(player)`
    not Passage End) the PA system announces the remaining count each turn — rendered in a
    **separate Siriusian digit-cipher** (`siriusian_number`: digit→glyph then reversed,
    `fixed`-width), with the I7 `[first time]…[only]` preamble done via a `pa_announced`
    flag. At zero the story ends: the moon fires its thrusters and **"The Sirius Syndicate
    has destroyed Mars."** (loss). The custom endings are contributed to `end_story_rules`
    in the **main file** (item 12). A NOT-FOR-RELEASE `late` verb (I7 `lowcounting`) jumps
    the clock to 5 to exercise the ending. **Deferred:** `self_destruct_in_progress` is
    never set true yet (reactor self-destruct unported), so only the loss ending is
    reachable — the **win branch** (heroic death, "Galaxy Jones has saved Mars…") is wired
    but **untested/unreachable** until that puzzle lands. Also deferred: the **Cyberhelmet**
    number-translation (count stays alien) and the **PA System backdrop** object (needs
    backdrops, item 10).

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
