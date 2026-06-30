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
- [x] **Backdrops: walls / floors / ceilings** (`Walls.i7x` / `Floors.i7x` / `Ceilings.i7x` /
  `PBR Common.i7x` / `Phobos Polish.i7x`): **DONE.** advent gained a general **`backdrop` type** — a
  thing surfaced in scope in *every* room by a second scope provider (the door seam's sibling; golden
  `backdrop1`, specs.md). Phobos's `lib/phobos/backdrops.lamp` adds the **walls / floor / ceiling**
  backdrops with **per-room descriptions**. The I7 originals key those off a `Table of Walls/Floors/
  Ceilings` (a row per room: description + touch description + low-ceiling flag) looked up by one
  generic instead rule; the port mirrors the table as **fields on the room** (`wall_description`,
  `wall_touch`, `floor_description`, `floor_touch`, `ceiling_description`, `ceiling_touch`,
  `low_ceiling`), read off `holder(actor)` by the generic `instead examine/touch` rules. The
  per-room text is verbatim from **Phobos Polish.i7x** (rough stone in the entry passages, the
  gray-tile interior as the room-type default, white tile in the labs, dense rubber in the ship);
  an empty field falls back to the PBR "nothing special" defaults. An **`outdoors`** flag on the
  `room` reopen (only the flight deck; no floating rooms) drives the outdoor wording — no walls
  ("There are no walls to see/feel"), floor→"ground", ceiling→open sky ("There's nothing up there
  but sky", "can't touch/take the sky"); the **ship** is the one `low_ceiling` room, so its ceiling
  is touchable while every other indoor ceiling reports "can't reach the ceiling". En route this
  fixed a latent bug: `feel` was missing from the locale verb vocab, so `[feel]` didn't conjugate
  ("She feel"→"She feels"); `touch1` now runs in third person to lock it. *Residual:* RUB/CUT and the
  "[We] would just embarrass [ourselves]" ATTACK refusals (no RUB/CUT verbs; ATTACK falls to advent's
  default — rides with the custom-attack-refusals item + a viewpoint `ourselves`), LOOK UP/DOWN →
  examine ceiling/floor, and location-gated `sky`/`ground` synonyms (understood everywhere now). The
  per-room messages aren't golden-covered (the sample's only golden is the `test endgame` walkthrough,
  which never touches a wall) — verified manually across all five textures.

**Alternate paths / behaviour:**
- [x] **SAY / ANSWER free-text** (`Guard.i7x`): **DONE.** lib/conversation gained a **`say` action**
  (`say [topic]` / `answer [topic]`) whose `topic` is a free-text `string` slot — captured verbatim,
  distinct from ASK/TELL's declared `subject`; fails by default ("There is no reply."), a game adds
  `instead say` guarded on `self.topic` (golden `conversation1`; specs.md). Phobos
  (`guard_persuasion.lamp`) uses it for both original SAY paths: **assert humanity** — "say I am
  human" / "I am from earth" (and the natural variants) sets `player_assert_humanity`, the guard
  dares Galaxy to prove it by removing her helmet, which then opens the **alliance with no gift**
  (the detection now spares an asserting Galaxy; the reveal's "in wonder / you are a human!" branch
  fires); and the **loyalty YES/NO** after giving the commander's log, answerable only the turn after
  (a one-turn window via an every-turn shift rule, mirroring I7's loyalty question rule). *Residual:*
  the **bare-word shortcuts** (typing just "yes"/"no"/"human" without "say") — I7 rewrites those via
  an *after reading a command* rule; Lamp has no command-rewrite hook (recorded in TODO.md), so for
  now the player says "say yes" / "say I am human".
- [x] **"Distracted → shot" mid-fight** (`Guard.i7x`): **DONE.** While the commando ambush is live
  (commandos in, not both down), doing anything but ATTACK or SHOOT gets Galaxy gunned down. Ported
  with an action **selector in the `before` band** — `before any except attack except shoot when
  commando_started and not commandos_down() and holder(player) == Control_Room` — which maps
  Inform's "doing something other than attacking or shooting" directly. The `before` band (not
  `instead`) makes it preempt *every* other rule for those actions regardless of library load order
  (so examining/touching a wall, taking/feeling a commando, or fleeing mid-fight is all death, not
  the gentler refusals). Both attackers up → "twin disruptor blasts"; one left → "the remaining
  commando … a disruptor blast"; ends with "Galaxy Jones has been terminated by a pair of Siriusian
  commandos." Replaced the old `instead go` "can't turn her back" placeholder. (Slightly stricter
  than I7's specificity-ordered `instead`, where a few noun-specific rules would slip through — this
  matches the do-or-die intent and is order-robust.) Verified in play; golden win path unchanged.
- [x] **Noun forms of FLY** ("fly ship" / "operate panel") and the ship-flying/simply-flying split
  (`Base.i7x`): **DONE.** The original's three flying actions (generic `flying`, `ship-flying`,
  `simply-flying`, separated by I7 grammar specificity) become two Lamp actions sharing the flight
  logic via `fly_the_ship()`: bare **`fly`** (+ launch/blast off/lift off/pilot/start/ride/engage —
  *simply-flying*: inside the ship or on the flight deck tries the ship, else "What should Galaxy
  fly?"), and **`fly_thing`** taking a noun (`fly`/`drive`/`pilot`/`operate`/`start`/`ride`/`launch
  [target]` — *ship-flying*+*flying* merged): the **ship or its control panel** flies it ("operate
  panel" inside → launch), the **Moon Sled** is "out of fuel", anything else "can't fly that". Two
  actions (not one with an optional slot) because an **unfilled object slot doesn't read as `none`**
  (gotcha recorded in TODO.md). This also ported the **Moon Sled** as a real scenery object at the
  Passage End (description, `feels`, `edificial` — Base.i7x), so X/DRIVE/TAKE MOON SLED all work.
  Win/loss logic unchanged (golden win path byte-identical); the noun forms verified in play.
- [x] **`blowing up the base` scene flavour** (`Guard.i7x`): **DONE.** Audited the guard-leading
  every-turn rules against the original and made the dialogue **verbatim** (the port had paraphrased
  it): the hub beckon "Time is short, human…", the reactor gesture sequence ("Here we are, human…"
  + "They gesture to two large levers… pull the lever on the left… 'Now you must pull the lever on
  the right side…'"), the return line "We have disabled the failsafe… other guards may have been
  summoned…", and the lever responses ("I have already pulled the left lever…", "Reactor has been
  armed… Get the hell out of here."). Added the **missed variant** — the reactor *"Hurry! Before we
  are caught!"* nag when Galaxy lingers after the left lever is pulled. Fixed placement so the
  "Time is short" beckon lands at the hub (the control→hub step is a silent move, as in the
  original), and used Inform's NPC-movement phrasing "The Siriusian guard goes <dir>." Golden
  updated (leading section only); win path intact. *Note:* the original censors Siriusian swears
  with a `$` glyph marker ("$hell", "$godforsaken"); the port renders them as plain English
  throughout the guard speech — a separate consistency pass if we want the censorship joke (below).

**Messages / polish:**
- [x] **Siriusian swear censorship (`$` markers)** (`Guard.i7x`): **DONE.** The original tags
  Siriusian profanity with a `$` control-word marker so it renders as untranslated glyphs — a running
  bleep joke. Restored it across all ported guard speech: the greeting's `$godforsaken`/`$effin'n`,
  the mothership topic's `$dammit`, and the reactor-arming `$hell` ("Get the $hell out of here"). The
  linguistics engine already glyphs `$` words (control word, always alien), so they bleep while the
  rest of the now-scanned speech reads English. Also corrected the stale guard_persuasion header
  (guard speech is scan-aware `siriusian()`, not "shown in English"; `!` names + `$` swears stay
  alien). Golden updated (greeting + right-lever glyphs). (`$shit`/`$fooblitsky` ported with the
  guard combat speech below; `$rearend`/`$stupid` ported with the goofy PA broadcasts below — so all
  Siriusian swears are now restored.)
- [x] **Goofy PA broadcasts** (`Guard.i7x` "Volume - PA Messages"): **DONE.** While Galaxy is inside
  the base but hasn't reached the control room, the bored guard pipes random nonsense over the PA —
  the twelve verbatim messages (with `!mfk5plas`/`!stuff` names and `$rearend`/`$stupid` swears), each
  spoken once, heard in Siriusian (scan-aware, so they clear up as she scans). `lib/phobos/
  pa_broadcasts.lamp`: an every-turn rule, separate from the doom-clock PA (countdown.lamp). **Release**
  shuffles the order at startup (Guard.i7x line 726) and rolls a 1-in-7 chance per turn; **debug**
  removes both — natural order, exactly every 7th eligible turn — for a deterministic, readable golden
  (mirroring how debug_mode fixes the keypads; since the puzzle shuffles are also debug-skipped, no RNG
  is drawn in a walkthrough). Golden gained 9 deterministic PA lines, win path byte-identical.
- [x] **Guard interjections** (`Guard.i7x` "Volume - Interjections"): **DONE.** While Galaxy is in
  the control room with the guard during the disguised meeting (before the alliance), the guard tosses
  out the occasional unprompted aside on a quiet turn — the seven verbatim asides, each spoken once.
  `lib/phobos/interjections.lamp`. The suppression flag `no_interjection_this_turn` is set inside
  **`g_say`** (the single chokepoint for guard speech), so an interjection is never piled on a line the
  guard already said this turn (greeting, gift reactions, loyalty/say) — and, faithfully, ASK/TELL
  replies (which render via `write()`, not `g_say`) do *not* suppress, matching the original's `After
  quizzing` rule. Same determinism split as the PA: release shuffles + 1-in-3, debug uses natural order
  + every 3rd eligible turn. Golden byte-identical (the walkthrough's two meeting turns are both
  guard-speech turns, so none fire); verified by hand.
- [x] **Guard combat speech: shoot-on-sight + spy-death button overrides** (`Guard.i7x`): **DONE.**
  The two unported combat scenes. **Arrival shoot-on-sight** (`guard_persuasion.lamp` `after go`):
  entering the control room undisguised, the guard shrieks "Oh `$shit`, a human!" and opens fire —
  death ("terminated by a Siriusian guard"), or, if the Galaxy Suit is **powered up**, the suit
  **reflects the fire** and the guard dies. (Reachable by hacking the purple door disguised, then
  doffing before entering; the every-turn detection still covers uncovering *after* arrival, with
  its "profoundly startled" variant.) **Spy-death button overrides** (`control_room.lamp`): reaching
  for the launch or self-destruct button while the guard is present and not yet allied blows Galaxy's
  cover — "Hey, what are you doing? You're not !NB563FFAA at all! You're a spy!" → death ("`$fooblitsky`!
  …") or the powered suit-deflect. Shared `guard_suit_deflect`/`guard_spy_death` helpers; the
  overrides are declared before the no-guard button rules so they win while the guard is present.
  Golden byte-identical (the walkthrough arrives disguised and never pushes a button with the guard
  there); all four paths verified in play. *Note:* suit-deflecting one's would-be ally is a dead end
  (no alliance → can't arm the reactor), as in the original.
- [x] **Viewpoint subject: name "Galaxy", not pronoun "She"** (house style / `Third Person
  Narration`): **DONE.** Added a **named third-person viewpoint** to the engine/locale: a
  `viewpoint_named` global (`lib/sys/globals.lamp`); when true and `viewpoint_person == 3`, the
  locale's `we()` (`lib/en-US`, mirrored in `lib/fr-FR`) emits the player's `display_name` on the
  first `[We]` of a render and pronominalizes later references in that same render (via a new
  per-render `viewpointNamed` flag in the runtime + `renderViewpointNamed`/`renderSetViewpointNamed`).
  So advent's `[We] …` messages now read "**Galaxy** can't reach Stickney Crater.", "Galaxy opens the
  cabinet, revealing …", etc. Phobos sets `viewpoint_named = true` (startup_rules). Default false, so
  every en-US/fr-FR golden is byte-invariant; the Phobos golden changed only the three `[We]`-derived
  lines (She→Galaxy). *Known minor:* the room-contents intro ("[We] [see] … here." → "Galaxy sees a
  commando here.") follows the manual "Galaxy is in …" heading, which is a *separate* literal render,
  so the per-render flag can't link them and it names rather than pronominalizes — a mild repetition,
  rare (only rooms with a listable item). Pronominalizing it would need a per-turn flag + routing the
  heading through `[We]`, or the deferred contents-reword; left as-is. (Distinct from the deferred
  third-person *action reports*. The "that"/"Stickney Crater" demonstrative split is separate, in repo
  `TODO.md`.)
- [x] **Custom "can't go that way"** (`Can't Go That Way.i7x` + `Phobos Polish` Table of Excuses):
  **DONE.** advent's blocked-exit refusal is now **direction-aware** (up → "can neither climb walls
  nor fly.", down → "can't just dig downward.", in → "What do we want to enter?", else "can't go that
  way." — byte-invariant for the default 2nd-person). Phobos refines the **Passage End** via a
  `report failed go` rule in the **main file** (author order, so it beats advent's default): south →
  "Galaxy Jones never runs away from a fight!", the six lateral compass points → "There are only stone
  walls in that direction." (up/down/in fall through to the defaults).
- [x] **Custom attack / take refusals** (`Can't Hit That.i7x`, `Can't Take That.i7x`, `Phobos Polish`
  Tables of Attacking + Frustrated Taking): **DONE.** advent gained `take_refusal` / `attack_refusal`
  string fields on `physical` (Can't Take That / Can't Hit That tables → per-object fields), read by
  the take/attack `report failed` to replace the default refusal (golden `refusal1`; specs.md). Phobos
  (`lib/phobos/refusals.lamp` + door fields inline in `base.lamp`) sets them for every ported object —
  e.g. "Galaxy Jones pounds pointlessly on the moonsled's hull", "Galaxy could probably rip the X door
  off its hinges …", "firmly attached to the wall", "Galaxy Jones can't take the walls!". Powered ATTACK
  matches unpowered except the **Moon Sled** ("Galaxy would rather not damage her ship.") — a small
  `instead attack when … powered_up` rule. *Residual:* the push/pull **"move message"** column (lower
  value; conflicts with the levers' own PULL rules), and entries for **not-yet-ported objects** (suit
  light, reset button, in-prose signs, sleeping pods, handprint scanners, counters/tile, PA System) —
  they ride along with those objects. The walls/floor/ceiling **attack** refusal ("[We] would just
  embarrass [ourselves]", Walls.i7x) is still deferred (needs a viewpoint reflexive).
- [x] **Power banner** (`Galaxy Banner.i7x` + `Powerup.i7x`): **DONE.** The POWER figlet
  (`power_banner()` in `scoring.lamp`, beside the Galaxy figlet) flashes whenever the Galaxy Suit
  spends a charge — printed by the `use_charge` callers (the powered door-smash in `suit.lamp` and
  the guard suit-deflect in `guard_persuasion.lamp`) just before the outcome message, then the
  "[Galaxy doesn't earn any points…]" note, mirroring Powerup.i7x's `use a charge`. Golden
  byte-identical (the walkthrough never spends a charge). (The third banner — the little **action
  banner** — is defined in the extension but **unused** by Phobos, so it isn't ported.)
- [x] **Banner placement** (`story.ni`): **DONE.** The title banner now appears **between** the intro
  narration and the Galaxy Jones reveal (intro → banner → reveal → first room), as in the original.
  Built the advent seam: advent extracts the banner into a callable **`print_banner()`** and gates
  its auto-print on a new **`auto_banner`** field on `game` (default true). Phobos sets `auto_banner
  false` and calls `print_banner()` itself in `startup_rules`, between the intro and the reveal.
  Other banner-using games (default `auto_banner true`) are byte-invariant.
- [x] **In-prose sub-objects as examinables** (`Base.i7x`): **DONE.** `lib/phobos/scenery.lamp`
  adds the eight in-prose signs (door/west/storeroom/junction/eastern/western/locker labels + the
  barracks poster) as **privately-named** scenery — so X SIGN / X POSTER work, each with the
  Siriusian label text, the "plastic sign" feel, and the "firmly attached" take-refusal — plus the
  **sleeping pods** (N/S barracks, refusing ENTER/OPEN), the science-lab **counters** and **tile**,
  and the **PA System** backdrop (X PA → "you can hear the PA, but…"). This needed a new general
  **`private_name`** engine flag (Inform's "privately-named", item 13 below): the sign objects'
  identifiers (`locker_sign`, `door_sign`) were leaking colliding parser tokens ("locker", "door")
  that broke HACK LOCKER / HACK DOOR; `private_name true` suppresses identifier tokens so an object
  answers only to its `understand` words (golden `privatename1`; specs.md). Phobos golden
  byte-identical. *Residual:* the everywhere `Label-sign` fallback (generic "ordinary sign" in
  signless rooms), and the PA System's region-confinement (it's everywhere, not just the indoor
  base, pending region-scoped backdrops).
- [x] **Handprint-scanner door-parts** (`Base.i7x`): **DONE** via the new advent **`part_of`**
  relation (infra item 6 below). `lib/phobos/scenery.lamp` adds the six handprint scanners (one
  `part_of` each door), the **suit light** (`part_of` the Galaxy Suit), and the **RESET button**
  (`part_of` the KIM) — each in scope wherever its whole is (the scanners from both sides of their
  door, the light with the worn suit, the button with the carried KIM), with the originals'
  descriptions/feels/refusals (incl. the suit light's powered-attack variant). Hacking still targets
  the door, not the scanner (the scanner is examinable flavour).
- [x] **Examine-self disguise variants** (`GJ Basics.i7x`): **DONE.** X ME (and X JONES) shows
  Galaxy's description, which varies with the disguise — undisguised "looks ready to kick ass";
  carapace-only / helmet-only "looks a bit silly"; both → "fully disguised as a Siriusian cyborg"
  (`instead examine when self.target == player` in `cyborg.lamp`). This also fixed the long-standing
  "feel me / attack me don't resolve" gap: **`me`/`myself` are now parser self-words** resolving to
  the *current* `player` global (a general engine addition — they follow a reassigned protagonist;
  golden `selfword1`), so the player's `feels`/`attack_refusal`/description are all reachable. Galaxy's
  name synonyms ("galaxy/jones/woman") are object-bound `understand` on `yourself` ("galaxy" also
  matches the Galaxy Suit, so it disambiguates, as in the original). The player's `printed_name` is the
  full proper **"Galaxy Jones"** (`article proper`) — so `[the player]` and the disambiguation prompt
  read "Galaxy Jones" (no article) — while narration keeps the short first name via the new
  **`viewpoint_name = "Galaxy"`** global (mirrors I7's `[Player]` short-name substitution; the old
  collapsed `printed_name "Galaxy"` made the prompt read "the Galaxy"). Engine fix: disambiguation
  prompts now honor proper-naming (golden `disambigproper1`).
- [x] **`indescribable` objects + button asides** (`Phobos Polish.i7x` / `Polish.i7x`): **CLOSED.**
  The "button asides" were never a distinct feature — they're just `attack_refusal` rows in the Table
  of Attacking, and they're already ported (launch/self-destruct → "Why not press it instead?" in
  `refusals.lamp`; reset/generic buttons → "…silly idea!" in refusals.lamp/scenery.lamp). The
  `indescribable` half (yourself / disruptor pistol marked indescribable) is **intentionally skipped**
  — it's a debug-style suppression not needed for the port.

- [x] **FROTZ Easter egg** (`GJ Basics.i7x` "Volume - Frotz"): **DONE.** `frotz <thing>` in
  `lib/phobos/frotz.lamp` — the three message branches (scenery / `edificial` / take-refusal-bearing →
  "Although Galaxy completes the spell, nothing seems to have happened."; the player → "Galaxy is
  bathed in a sickly yellow light…"; any other thing → the adaptive "almost blinding flash… now quite
  usable as a light source", via a `verb begin, fade` declaration). Sets the new advent **`bool lit`**
  (`physical`), which annotates the inventory row **`(providing light)`** next to `(worn)` — golden
  `providinglight1`. "Fixed in place" maps to scenery/`edificial`/non-empty `take_refusal` (the doors).
  FROTZ itself is verified manually (the phobos golden is `test endgame`).

**Audit passes (may add items):**
- [x] **`Actions.i7x`** — **DONE.** Ported the SHOOT flavour the port's one-noun `shoot` was missing
  (guard_endgame.lamp): `fire`/`shoot at`/`fire at` synonyms; generic "Galaxy can't see the point of
  that."; `shoot me` → "Don't be morbid."; `shoot <pistol>` → "That would be a neat trick."; a hackable
  door → "…energy beam harmlessly dissipates against the door."; no-pistol → "Galaxy doesn't have a
  firearm to shoot with." The two-noun `shoot/fire X with Y` + `attack X with Y` grammar is left as a
  deliberate simplification (the pistol is the only firearm, supplied implicitly; attack-with would
  just fall through to the noun's `attack_refusal`, already ported). TASTE/SMELL: N/A (advent has no
  such verbs, so they're already unrecognised, matching I7's "Understand … as something new").
- [x] **`Improved Pushing.i7x`** — **N/A (confirmed).** Tracks a "thing pushed" consumed only by Third
  Person Narration's content listing; nothing in Phobos is pushable between rooms, so it never fires.
- [x] **`GJ Basics.i7x` / `PBR Common.i7x` / `Polish.i7x`** — **DONE.**
  *GJ Basics:* score-based **status line** ("[score] of [max_score] points" instead of turns — a
  general advent change gated on `max_score > 0`; the room name is already title-cased from its
  identifier) and the **remove-suit refusal** ("Galaxy needs the Galaxy Suit to complete her mission.",
  suit.lamp). `color on/off` N/A (the port renders keypads with `[N]`/`<N>` markers, no colour styling
  to toggle). *Polish:* the two library-message overrides (lib/phobos/messages.lamp) — `drop_not_carrying`
  → "Galaxy doesn't have that." and `parser_cant_see` → "There is nothing there."; the Table of
  Transitions is empty in the original, so N/A. *PBR Common:* infrastructure only — indoors/outdoors
  already ported (the `outdoors` flag); `floating` / `initializing` activity / sentence-case are unused
  in Phobos.
- [x] **Final line-by-line parity pass** — **DONE.** Two strands:
  1. *Second-person → viewpoint-adaptive.* Converted advent's plain `You [verb]` defaults to `[We]
     [verb]` (byte-identical for the default 2nd-person viewpoint, third-person for Phobos): inventory
     header/empty, wear/doff reports, put-on report, the "not something you can take/wear/open/close"
     refusals, darkness. The contracted ones (no adaptive be-contraction form) are overridden in
     `lib/phobos/messages.lamp`: `take_already_carrying`, `wear_already_worn`, `doff_not_worn`. The
     score/win notifications keep "Your"/"You" (Inform convention; the port matches).
  2. *Feels / refusal text-fidelity check* (diffed the I7 Tables of Attacking / Frustrated Taking and the
     `feels` assignments against the port). Filled gaps the original port missed: **attack refusals** on
     the green/purple/flight-deck doors, the green/purple handprint scanners, walls/floor/ceiling, the
     static force field, the Siriusian ship, the sleeping pods, and the storeroom sign; the
     **unconscious-commando** "Attacking a defenseless person is not Galaxy's style." (an `instead
     attack` guarding the down state); and the science-lab **tile**'s missing `feels`. (The dead-guard
     `feels` "Galaxy leaves the dead guard alone." already matched I7 — it was *not* a divergence.)

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
- **Banner placement (DONE):** the starting banner sits **between the intro
  narration and the Galaxy Jones reveal** — intro → banner → reveal → first room.
  advent's `on startup` auto-prints the banner only when `game.auto_banner` is true
  (the default); Phobos sets `auto_banner false` and calls advent's extracted
  `print_banner()` itself, in `startup_rules`, between the intro and the reveal.

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
again reports it is already running. The **guard-present overrides** (the cyborg's suspicion →
"spy!" → death-or-suit-deflect) are now ported too (see "Guard combat speech" in the parity
checklist above).

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
   with their I7 closed/locked/not-lockable state. Door **descriptions** (the
   handprint-scanner line with the open/closed state conditional) and the
   handprint-**scanner parts** (via the `part_of` relation) are now done.
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
6. ~~**Parts / components** — `X is a part of Y`~~ **DONE.** advent now has a **`part_of`**
   relation (`lib/advent/parts.lamp`): a part is in scope wherever its whole is and moves with it
   — `wire_parts` materializes a `contains` edge so it rides scope's fixpoint (parallel to
   `wire_doors`); `whole_of(part)` queries the whole. Exposed `isTypeOrSubtype` to the barrier seam
   and scoped the closed-container barrier to actual `container` types (so a *closed door* no longer
   hides its scanner part). Golden `parts1`; specs.md. Used by the handprint scanners / suit light /
   RESET button (above). The control-room screens/buttons/levers were ported earlier as standalone
   scenery (not `part_of` the panel) — could be re-parented now, but it's cosmetic.
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
10. ~~**Scope/backdrop tricks**~~ **Backdrops DONE** — advent's general `backdrop` type +
    a second scope provider surface a thing in scope in *every* room (golden `backdrop1`); the
    walls/floor/ceiling use it (`lib/phobos/backdrops.lamp`). `far_away` (Mars, Stickney Crater)
    is done too (TOUCH/TAKE item). Still open: arbitrary "place X in scope" / "reaching inside"
    rules and region-scoped backdrops (every backdrop is currently everywhere).
11. **Custom actions** — flying / ship-flying / simply-flying, listening,
    pulling, searching.
12. ~~**`end the story saying "…"`**~~ **DONE.** The custom final line is a
    game-contributed `rule end_story_rules when story == won/lost:` that prints the
    bespoke text and `stop true`s to suppress advent's default banner. **Must live in
    the main game file** (`phobos.lamp`): only main-file rules register at author order
    (0), ahead of advent's order-1 default `when story == …` rules — a lib-file
    contribution would register at library order and lose. Used by the countdown (below).
13. **Misc object properties** — `outdoors` (done, backdrops), per-room `preposition` (done),
    `edificial` (done, TOUCH/FEEL), `always-indefinite` (done, room heading), **`privately-named`**
    (done — `private_name` engine flag, see in-prose sub-objects above). Still: `indescribable`.
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
