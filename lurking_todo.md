# Lurking Horror — Candidate Features

A menu of features observed in `lurkinghorror.txt` (a real Infocom game) that
Lamp / the advent library **does not yet have**, for you to pick from. Sourced by
reading the whole transcript against the current feature set
(`lib/advent/*.lamp`, `devdocs/game_parser.md`).

Legend:
- **NEW** — nothing comparable exists yet.
- **PARTIAL** — we have a related primitive; this is an extension or sibling.

Decision tags (this pass): **[???]** no decision yet · **[Will do]** · **[Won't do]** · **[Done]**.

Line numbers (`L###`) point into `lurkinghorror.txt` for the example.

Already in Lamp (excluded below): `look`, `take`/`get`, `drop`, `inventory`,
`wear`, `take off`/`doff`, `examine`/`x`, `go` + compass directions, `put X on Y`
(supporters), open/closed boxes, darkness (`lighted`), the "Which X do you mean…"
disambiguation, the `it` pronoun, `"You can't go that way."`, and
`"There is X here."` room listing.

---

## 1. Verbs we don't have

### Object manipulation
- [Done] **NEW — `open`/`close` as a general openable trait, with `reveals`.** Beyond
  boxes: fridge, microwave, flask, manhole, door, access panel, plate.
  "Opening the refrigerator reveals a two liter bottle of Classic Coke and a
  cardboard carton." (L257); "The microwave oven is now open." (L276)
- [Done] **NEW — `put X in Y` (containment) verb.** We only have `put X on Y`
  (supporters). "put carton in microwave" → "Done." (L278); refused when closed:
  "Inspection reveals that the microwave oven isn't open." (L273)
- [Done] **NEW — `take X from Y` / `take X out of Y`.** "take stone from professor" (L2049).
  **Implemented (2026-07-11):** not a new world verb — a `take_from` action whose `taken` slot the
  runtime **scopes to `source`'s contents** (`setSlotScopedByContents`, registered in index.js;
  resolveSlots resolves the source first and narrows the slot's scope). Disambiguates a same-named
  object and bounds `all` (`take all from coffer`); a closed/empty source or absent object → the
  **generic** no-match (no bespoke message, matching Inform — a specific "isn't in the basket"
  would leak existence/location). `do` delegates to TAKE per object. en-US (`from`/`out of`/`remove
  … from`) + fr-FR (`prendre … dans/sur`). Confirmed open-container contents are already in scope,
  so FROM's job is narrowing/bounding. Goldens `takefrom1`/`takefromfr1`.
- [Done] **NEW — `turn on` / `turn off` (switchable devices).** pc, flashlight,
  forklift, computer. "The flashlight clicks on." (L839); "The forklift sputters
  to life." (L774). **Implemented (2026-07-11):** `switchable`/`switched_on` on `physical`
  (types.lamp); `switch_on`/`switch_off` actions do **only** one thing — set/clear
  `switched_on`, refusing a non-`switchable` and the already-on/off cases (actions.lamp).
  Deliberately generic — the verb owns no device behavior; consequences are game-wired (a
  `report switch_on` links a flashlight's `switched_on` → `lit`; a forklift's "sputters to life"
  is a per-object report). Grammar `turn on/off [x]` / `switch on/off [x]` both orders, en-US +
  fr-FR (allumer/éteindre). Goldens `switchdevice1`, `switchdevicefr1`.
- [Done] **NEW — `unlock X with Y` / `lock X with Y`.** Lock+key as world state.
  "The lock, though rusty and unwilling, opens, releasing the hatch." (L1229);
  "The master key doesn't work on this lock." (L1964)
- [Done] **NEW — `push`/`press` (buttons, movable objects).** "push call button",
  "press start", "push bench" → "It's heavy, but it moves, revealing a hinged
  metal trapdoor beneath." (L2701)
- [Done] **NEW — `pull` / `move`.** `pull` exists as a fail-by-default action
  ([actions.lamp](lib/advent/actions.lamp), same shape as `push`); responders are
  per-game `instead pull` rules for levers etc. `move` is an optional one-line grammar
  synonym for `pull` (left to games, exactly like `press`→`push`).
- [Won't do] **NEW — `pry X with Y` / `break X with Y` / `cut X with Y` (tool-mediated).**
  Two-noun instrument verbs. "remove cover with crowbar" (L896); "cut cord with ax"
  (L1810); "break glass" → "Wearing the heavy gloves, you confidently smash the glass…"
  (L1656). A general action-with-an-instrument facility is a non-goal — games express
  these as bespoke rules. (The `with Y` instrument clause is the same non-goal that keeps
  ATTACK's `with Y` form out of scope.)
- [Done] **NEW — `hit` / `attack`.** Already built: `attack` action (actions.lamp),
  fail-by-default with a per-object `attack_refusal` override and default "Violence isn't the
  answer to this one."; grammar `attack`/`hit`/`smash`/`punch`. "cut man with axe" (L1821).
  The `attack X with Y` instrument form is out of scope (see the tool-mediated line above).
  (Merged from the former separate `attack` bullet.)
- [Won't do] **NEW — `pour X on Y` / `pour X`.** "pour liquid" → "It pours out and spreads
  like ants at a picnic." (L1884)
- [Will do] **NEW — `search X`.** "search junk" → "You find many worthless items… but
  nothing of any use or value." (L848). Fail-by-default like `push` ("You find nothing of
  interest."), **but succeeds for a container/supporter** — searching one lists its
  (in-scope) contents, same rendering as looking in/on it. Games add `instead search X`
  for scenery that hides things.
- [Won't do] **NEW — `dig` / `dig in X`.** "dig in dirt" → "…you encounter something hard."
  (L2159)
- [Done] **NEW — `touch`/`fiddle with`.** "Fiddling with the cardboard carton has no
  effect." (L326)
- [Won't do] **NEW — `set X to Y`.** Setting a value/dial. "set timer to 4:20" (L510)

### Movement variants
- [Will do] **NEW — `enter`/`exit`/`get in`/`get out`/`get on`/`get off` (vehicles &
  enterable objects).** "You are now in the forklift." (L768); reach limits while
  riding: "You can't reach the urchin from within the forklift." (L783)
- [Won't do] **PARTIAL — `up`/`down`/`in`/`out` already exist as directions, but `climb X`,
  `climb up/down`, and verb-form `enter`/`exit` mapping to movement do not.**
  "climb rope" (L2325)
- [Will do] **NEW — vehicle-constrained movement.** A ride blocks some exits: "The forklift
  won't fit into the stairwell." (L786)

### Sensory / examine extensions
- [Won't do] **NEW — `read X` distinct from `examine`.** Text objects render their writing.
  "read sign" → "It says 'NO ADMITTANCE!'…" (L2118). `read [target]` is already a synonym for
  `examine` (en-US.lamp); a distinct READ with its own text property isn't worth it — authors
  fold the inscription into the examine description.
- [Done] **NEW — `listen` / `smell` / sensory verbs.** "listen" → "You hear the
  chittering of rats." (L1247) — and the answer *changes over turns*. **Implemented
  (2026-07-11):** distance sense verbs with objectless (ambient room `sound`/`scent`) and
  targeted (`listen to X` / `smell X`, the thing's own `sound`/`scent`) forms; empty text →
  "You hear/smell nothing unexpected." No reach gating; works in the dark; spends the turn (so
  the "changes over turns" case is a game `instead listen` + §4 daemon). en-US + fr-FR
  (écouter/sentir; added `entendre` to the French conjugator). Goldens `sense1`, `sensefr1`.
- [Done] **NEW — `look <direction>` (incl. `look down`).** **Implemented (2026-07-11):**
  `look_direction` with a `direction way` slot glances a compass/vertical direction; succeeds
  with a generic default ("You see nothing unexpected that way.") a game overrides per
  room/direction (`instead look_direction when self.way == down`). en-US + fr-FR (`regarder
  [way]`). Golden `look1`/`lookfr1`.
- [Done] **NEW — `look in X` / `look through X` / `look under X` / `look behind X`.**
  "look through trapdoor" → "…you can see part of a workroom or lab." (L924). **Implemented
  (2026-07-11):** `look in`/`inside`/`through` list an open container's contents (closed →
  closed, empty → empty, non-container → refused), reusing EXAMINE's container machinery; `look
  under`/`look behind` fail-by-default (games add `instead look_under`/`look_behind` to reveal a
  hidden object). en-US + fr-FR (`regarder dans`/`à travers`/`sous`/`derrière`). Golden
  `look1`/`lookfr1`.
- [Done] **NEW — `examine me` / self-description.** "x me" → "You are wide awake, and are
  in good health." (L663). **Implemented (2026-07-11):** `me`/`myself`/`self` (fr `moi`/`me`/
  `moi-même`) resolve to the acting actor (self-words, already wired; added `self`/`moi-même`);
  EXAMINE of yourself with no `description` prints `examine_self` ("You are as good-looking as
  ever." / "Vous êtes en pleine forme.") instead of the generic line. A game sets the actor's
  `description` for the health/fatigue wording (§5, layered on top). Goldens
  `examineme1`/`examinemefr1`.

### Eating / drinking / consumables
- [Done] **NEW — `eat X` / `drink X`, with edible/potable traits.** "drink coke" →
  "Delicious! …You feel much more alert and awake now." (L1192); non-food: "The
  food here is terrible, but this is ridiculous!" (L149)
- [Won't do] **NEW — consumable depletion.** A drink empties its container: "The bottle is
  empty." (L2242)

### NPC interaction (a whole subsystem)
- [Will do] **NEW — `talk to X` / `X, hello`.** "talk to hacker" → "Hmmm … the hacker waits
  for you to say something." (L12). Not in `lib/conversation` (which has `say`/`ask`/`tell` but
  no greet/opener). A `TALK TO` nudge + `hello`/greeting handling. **Design deferred to a
  separate document.**
- [Done] **NEW — `ask X about TOPIC`.** Topic-based dialogue. "ask hacker about keys" →
  a paragraph of lore (L196). Unknown topic: "I don't know the word 'hacking.'"
  (L18). Built in `lib/conversation`: `ask [interlocutor] about [topic]` resolves a `subject`
  globally, prints its `reply` or a puzzled default; games layer dynamic answers via
  `instead`/`after ask`. Caveats (not blockers): the unknown-topic line is a §2 parser
  unknown-word response, not the ask action; and it's opt-in (`lib conversation`) by design.
  **Future:** allow asking about *objects* (physical things as topics), not just declared
  `subject`s.
- [Done] **NEW — `give X to Y` / `show X to Y`.** The give/show economy with per-NPC
  reactions: "give chinese food to hacker" → "'Yuck! This isn't warm enough!'" (L393);
  "show stone to creature" → "The thing is uninterested." (L154). Built in advent
  (actions.lamp): both fail-by-default with per-recipient `instead give`/`instead show`.
- [Will do] **NEW — `ask X for Y` / `feed`.** The reverse of give (NPC hands you something)
  plus `feed X to Y`. `ask [someone] for [thing]` grammar + action; `feed` likely a
  give-to-a-creature synonym. Neither present yet.
- [Will do] **NEW — `X, COMMAND` (ordering an NPC).** "urchin, boo" (L761); enforced
  addressing: "You must address the urchin directly." (L759). Parse `NPC, imperative`, run the
  action with `actor = that NPC`, plus the "must address directly" refusal for un-orderable
  NPCs. Execution side is partly there (actions carry `self.actor`; reports branch on
  `actor == player`); the **parsing** of the `X, …` addressing form is the new work.

### Meta / out-of-world
- [Done] **DONE — `wait` / `z`.** "Time passes." — a core advent action (lib/advent/actions.lamp),
  a normal in-world turn so every-turn rules fire; message `wait_report`; golden `wait1`; specs.md.
- [Done] **PARTIAL — `again` / `g`.** Repeat last command. "again" (L1280). Fully built in
  the **runtime** (not lib/advent): `src/lamplighter/index.js` replays the last in-world
  command above the grammar and never records itself; locale words `againWords: ["again","g"]`
  in `lib/en-US/index.js`; documented in game_parser.md / state.md; test fixture `again1.lamp`.
- [Done] **NEW — `save` / `restore` / `restart`.** "Okay." (L65); end-of-game menu.
  All wired (en-US.lamp): `save`/`restore`/`restart`/`undo`; dedicated `lib/advent/save.lamp`;
  RESTART documented in startup.lamp ("begins again from `on startup`").
- [Done] **NEW — `score`.** Implied by the endgame readout (L1848). `understand "score" as
  request_score` (en-US.lamp) + dedicated `lib/advent/scoring.lamp` (`max_score`, point awards).
  Narrower than §8 (rank table + move counter decided there); the SCORE verb + tracking exist.
- [Done] **NEW — `verbose` / `brief` / `superbrief` display modes.** "Verbose
  descriptions." (L593). **Implemented (2026-07-11):** a `verbosity_mode` enum global (default
  `verbose`, so existing behavior is unchanged) + a per-room `visited` flag; `describe_on_arrival`
  consults them (verbose = always full, brief = full first visit then name-only, superbrief = name
  only), while explicit LOOK stays full. Out-of-world `set_verbose`/`set_brief`/`set_superbrief`
  (no turn). en-US (`verbose`/`long`, `brief`/`normal`, `superbrief`/`short`) + fr-FR
  (`détaillé`/`bref`/`minimal`). Goldens `verbose1`/`verbosefr1`.

---

## 2. Grammar & parser features

- [Done] **NEW — `ALL` / `EVERYTHING` with per-item reporting.** "take all" →
  ```
  two liter bottle of Classic Coke: Taken.
  cardboard carton: Taken.
  ```
  (L260); also `drop all` (L1714).
- [Done] **NEW — multiple objects & `EXCEPT`.** "take all except…", comma lists. The
  selector machinery for multi-object resolution. Built: `multi` actions resolve a
  multiple-object noun phrase ("drop ball and umbrella") and dispatch once per object
  (non-multi refuses `parser_no_multi`); `all except` via `exceptPieces` (src/lamplighter).
- [Won't do] **WON'T MODEL (by design) — adjectives as a part of speech.** "smooth stone",
  "carved symbol" vs "incised symbol", "new brick" vs "broken brick" (L1335).
  These are handled by the **token bag** (AND-matched name tokens), not POS
  tagging — a decided non-goal (`game_parser.md` → Non-goals). The disambiguation
  behavior is wanted; the *mechanism* is token-bag, so this lands under the
  `ALL`/multi-object + disambiguation work, not a separate adjective feature.
- [Done] **PARTIAL — disambiguation answered by a bare distinguishing word.** After
  "Which brick…", the player types just "new" (L1337). Fully wired in the runtime: a pending
  disambiguation takes the next line as the answer and narrows candidates by a token-bag query
  (`phraseTokens.every(t => objectVocab(obj).has(t))`, no adjectives) — 1 match dispatches,
  >1 re-prompts accumulating the partial answer (chained), 0 falls through; the answer is also
  spliced into the AGAIN target ("take ball"+"red"→"take red ball"). Doc's "not wired" was stale.
- [Done] **NEW — multiple commands per line (`.` separator).** "take off gloves. wear
  hyrax. put on gloves." (L2786). `splitCommands` (src/lamplighter) splits on `.` (digit-guarded
  so "4.20" survives) and on sequence words ("then"), each run as its own turn.
- [Done] **NEW — richer prepositional grammar tokens.** `with`, `in`, `on`, `to`,
  `from`, `about`, `into`, `through`, `down`, `for`. Many map to two-noun verbs. Umbrella, not
  standalone work: prepositions are literal words in `understand` templates (proven — `with`,
  `in`/`into`/`inside`, `on`, `to`, `about` all live). The unused tokens (`from`/`through`/
  `down`/`for`) ride the verb items that need them (take-from, look-through/down, ask-for), all
  already Will do.
- [Won't do] **NEW — parser comment lines (`;…`).** Lines beginning with `;` are ignored
  (Infocom convention) (L629).
- [Done] **NEW — distinct structural parse errors.** We already emit every structural error
  the whole-template-matching parser can *distinguish*:
  - empty input → "I beg your pardon?" (L232) — `beg_pardon` in the loop (startup.lamp), golden `begpardon1`.
  - unparseable → generic `parser_no_understand` "I don't understand that." (L2695)
  - missing/unresolvable noun → `parser_cant_see` "You can't see any such thing." (L39)
  - multiple-object misuse → `parser_no_multi`; unbound pronoun → its own renderer.

  Not reachable under this design (no verb POS; templates match wholesale — see `sawVerbMatch`),
  and adjacent to the adjective/POS non-goal: **no verb** ("There was no verb…" L780) and
  **verb/noun mismatch** ("How do you do that with a banners?" L238) both collapse into
  `no_understand`; **bad preposition** ("You used 'of' in a way…" L830) would need a known-word
  registry + positional analysis.
- [Will do] **NEW — "noun missing" parse error.** "There seems to be a noun missing in that
  sentence." (L39). Designed as interactive re-prompts ("What do you want to take?" / "Who…?" /
  "Which way…?") rather than a static error. Detection needs `matchGrammar` to surface partial
  matches (the `span.length===0 → return null` line currently blocks it); the answer flow
  reuses `pendingDisambiguation`. Full design + cases + boundary + tie-break in
  **`devdocs/missing_noun.md`**.

---

## 3. World-model / object capabilities

- [Done] **NEW — openable + lockable + key, as composable traits.** open/closed/locked
  state; a key object that fits a lock; "open" refused when locked. World-model twin of the
  OPEN and LOCK/UNLOCK verb items (both Done): `box`/`door` carry `closable`/`closed`/`locked`/
  `matching_key` (types.lamp); OPEN refuses locked; UNLOCK/LOCK check key-fit.
- [Done] **NEW — a portable light source.** A `flashlight` you carry that provides light
  in dark rooms. **Implemented (2026-07-11):** `lit == true` on any object in the actor's scope
  now illuminates an otherwise-dark room — `light_in_scope` native (index.js, reuses `scopeOf`
  so a closed box seals the light) drives `in_darkness`/`describe_room` (rooms.lamp). No special
  item type. Golden `providinglight2` (carried light → visible; sealed in a closed box → dark;
  reopened → lit). Pairs with turn on/off (still Will do), but the linkage is game-wired: TURN
  ON only sets `switched_on`; a flashlight connects `switched_on` → `lit` itself (a rule or a
  derived `lit`). The verb stays generic across machine kinds and owns no lighting behavior.
- [Done] **NEW — doors as shared, stateful connectors between two rooms.** A door/glass
  wall/plate that is itself an object and blocks the exit until opened/unlocked.
  "There is a glass wall in the way." (L679); "The Alchemy Department door is
  closed." (L2060). Built: `door` type (types.lamp, closed/locked/matching_key + compass
  room links) + dedicated `lib/advent/doors.lamp`.
- [Done] **NEW — custom blocked-exit messages (per exit).** "Impenetrable snow drifts
  block the street." (L1172); "You can't walk off with that! It's Tech
  property!" (NPC blocks an exit, L606). Rule-based: a game overrides via its own
  `report failed go` (per room/direction, author-order) or a `check go`/`instead go` for a
  conditional block. No declarative per-exit message slot, but the rule override suffices
  (as with push/search).
- [Won't do] **NEW — carry capacity / weight limits.** "Your load is too heavy." (L570);
  "You're holding too many things and can't quite get them all arranged…" (L1551)
- [Won't do] **NEW — bulk / squeeze constraints on movement.** "It's too tight a fit
  carrying the metal flask." (L1216)
- [Won't do] **NEW — wear-layer conflicts.** "The brass hyrax won't go on over the gloves."
  (L2784)
- [Won't do] **NEW — liquids as a substance kind.** Not takeable; drinkable; pourable. "You
  can't take it, it's a liquid." (L2760). (Umbrella for pour + consumable depletion, both
  Won't do; the "can't take, it's a liquid" refusal is game-authorable via `take_refusal`.)
- [Will do] **NEW — enterable objects that aren't vehicles (beds, chairs, closets).**
  Getting in/on such a thing relocates the player's holder to it (posture "in"/"on") and
  adds ", in the bed" / ", on the chair" to the room header; `exit`/`get out` returns to the
  room. **No** driving or movement-constraint semantics — that's the vehicle item below.
  In Inform terms: an `enterable` container or supporter that isn't a vehicle — simpler than
  the vehicle model, and its natural substrate. Shares the `enter`/`exit`/`get in`/`get out`/
  `get on`/`get off` grammar (§1 Movement variants).
- [Will do] **NEW — enterable / ride-able objects (vehicles) with their own location
  semantics.** Room headers gain ", on the forklift" / ", in the forklift"
  (L789, L795).
- [Done] **NEW — object state that changes description & reactions.** Szechuan shrimp is
  cold → warm → hot → overcooked depending on microwave time, and the hacker
  reacts differently to each (L332, L371, L396, L478, L560). Authorable today: mutable
  properties + author-order rules (`instead examine`/`report`/NPC reactions guarded on
  `self.cooked == hot`). Capability exists; the shrimp is game content.
- [Done] **NEW — "initial" vs "moved" object descriptions.** Before first touched, an
  object gets a bespoke presence sentence ("Sitting on the kitchen counter is a
  package of Funny Bones.", L248); after, the generic "There is X here." Built:
  `initial_appearance` + `handled` (rooms.lamp) — `list_room_contents` prints the bespoke
  line while un-handled and excludes it from the generic list; `take` sets `handled` so it
  reverts to generic. (Same facility answers §6 "varied object-presence sentences".)
- [Done] **PARTIAL — group/plural objects.** "There are urchins here." / "rats" treated
  as a swarm (L1471). **Implemented (2026-07-11)** as a single collective object: the `plural`
  field already gave "some rats" / plural agreement / "them"; the one new piece — unifying the
  `them` pronoun so a plural object and a multi-object result share one antecedent — is now
  built (golden `themgroup1`). Counting/duplicates/member-reference are non-goals. Full design +
  the original open questions in `devdocs/plural_objects.md`. Historical open questions:
  - What is the object model? One collective entity that *reads/agrees* as plural (verb
    agreement "are"/"them"/"they", plural pronoun antecedent), vs. N identical instances the
    lister already collapses. Probably the former.
  - Author capabilities: declare a plural-named thing with plural agreement + custom presence
    ("There are urchins here"); swarm reactions; optional count that can deplete (some leave).
  - Player capabilities: refer to it by plural name, examine/interact with the whole; can they
    single one out ("take a rat")? What happens to the group when they do?
  - Relationship to the existing pluralized-list rendering and the `[those]`/pronoun machinery.
  **Design done — `devdocs/plural_objects.md`:** target is a single collective object (members
  not referable), the `plural` presentation field already works, counting is a non-goal, and
  the one new mechanism is unifying the `them` pronoun (a plural object and a multi-object
  result share one antecedent slot).

---

## 4. Turn cycle, daemons & timed events

(Overlaps with TODO item 4 "Parser v2 — every-turn & timed rules.")

- [Done] **NEW — the turn clock / `wait` advancing time.** "Time passes…" (L355). Core turn
  cycle built: `wait` spends a turn, `every_turn_rules()` (globals.lamp) fires once per
  turn-spending command (startup.lamp), turn count tracked/displayed (status.lamp).
- [Done] **NEW — daemons (per-turn background messages on an object/room).** The pit:
  "A low, guttural, groaning and snarling issues from the opening." repeats each
  turn (L998–L1028); the professor's escalating "continues to gaze at you with
  malign intent." (L2007+). Authorable on `every_turn_rules` (`rule every_turn_rules when
  <pit in scope>: print …`). No dedicated per-object daemon primitive with start/stop, but the
  behavior is covered (consistent with push/blocked-exit calls).
- [Done] **NEW — countdown timers / fuses.** The microwave counts down over turns and
  fires an event at zero: "The microwave stops." (L317). Authorable: a counter (global or
  object property) decremented in `every_turn_rules`, firing at zero. No dedicated fuse/timer
  primitive, but the behavior is covered (consistent with the daemon call).
- [Done] **NEW — moving NPCs (wanderers).** "The hacker wanders over…" (L169); "The
  urchin saunters nonchalantly into the room, notices you, and beats a hasty
  retreat." (L792). Authorable: an `every_turn_rules` rule that `move`s an NPC between rooms
  with arrival/departure messages. No dedicated wanderer primitive, but covered.
- [Done] **NEW — escalating, scripted scene sequences.** The summoning ritual prints a
  new escalating paragraph every turn regardless of input (L2509+). Authorable: a stage
  counter in `every_turn_rules` printing the next paragraph each turn (and firing an ending).
  No dedicated scene/cutscene abstraction, but covered.
- [Done] **NEW — environmental damage over time.** Blizzard cold each turn on the roof:
  "Bitter, bone-cracking cold assaults you continuously." (L701). Ambient-message half
  authorable on `every_turn_rules`; the actual damage→death mechanic rides the §5 health
  model + end-game path (decided there).

---

## 5. The player character as a modeled object

- [Done] **NEW — fatigue / health state with daemons.** "You are beginning to tire."
  (L1184) → "You are feeling tired." (L2369) → "You are getting more and more
  tired." escalating; sleeping or caffeine resets it. Authorable: a fatigue global
  incremented in `every_turn_rules`, escalating messages at thresholds, reset by SLEEP/caffeine.
  No built-in health model; the thresholds/resets are game content.
- [Will do] **NEW — `sleep` and dream sequences.** "sleep" → narrated rest / nightmare
  (L2523). Add a base fail-by-default `sleep` verb ("You aren't feeling especially drowsy.")
  that games override, like the other stock IF verbs. The dream sequence itself is game
  content (a scripted scene on `every_turn_rules`).
- [Done] **NEW — death state + endgame menu.** "**** You have died ****" then "Would you
  like to restart… (Type RESTART, RESTORE, or QUIT):" (L1844-L1851). Built: a death = `story =
  lost`; `end_story_rules` prints the banner (globals.lamp; LH's "died" is a re-themed
  `story_lost`/`ending_override`); the end-of-story loop (startup.lamp) shows the constrained
  RESTART/RESTORE/QUIT prompt. (Multiple death messages = separate §8 item.)

---

## 6. Interesting generated / dynamic text

- [Done] **NEW — nested container-contents rendering.** "The microwave oven contains a
  cardboard carton. The cardboard carton contains Chinese food." (L490). Inventory/examine
  render contents recursively, one indent per nesting level; `contents_of` hides a closed
  box's contents (actions.lamp).
- [Done] **NEW — room description that mutates with world state.** Dead Storage gains "A
  narrow path winds eastward through the junk." after the forklift clears it
  (L1096 vs L842). Room-level twin of object-state-changes-description (Done): a text template
  with `[if …]` or a rule appending after `describe_room` (override-friendly). Authorable.
- [Will do] **NEW — implicit-action announcements.** "(Taking the pair of rubber boots
  first)" (L2096); "(first taking off X)". Player-facing cases already work per-verb
  (`put_on`/`put_in`/`wear`/`drop` each hand-code "(first …)" + `try`). This item is the
  **general facility**: factor the pattern into one reusable implicit-action helper (Inform's
  "implicitly taking") so any action can require+announce+try+bail uniformly. Internal
  refactor/convenience, not a new player capability.
- [Done] **NEW — varied object-presence sentences.** "Sitting at a terminal is a hacker…"
  / "Nearby is one of those ugly molded plastic chairs." / "A really whiz-bang pc
  is right inside the door." — per-object custom presence text instead of "There
  is X here." (L223-L227). Same `initial_appearance` facility as the §3 "initial vs moved"
  item (Done); NPCs/scenery that never get `handled` keep their custom line.
- [Done] **NEW — second-person conditional flavor based on worn/held gear.** "Wearing the
  heavy gloves, you confidently smash the glass…" (gloves change the outcome)
  (L1656). Authorable: an `instead`/`report` rule guarded on `wears player gloves` / holder
  checks (both exist). Capability there; the gloves-change-the-smash is game content.

---

## 7. New refusal / error / success messages (flavor catalog)

A grab-bag of player-facing one-liners worth stealing for tone. Most attach to a
verb's failure path or a default "you can't do that" handler.

**Pure tone — [Done] as a group.** Each is a re-theme of an existing failure path
(`take_refusal`, `eat`/`push`/`touch` defaults, etc.) — authorable message overrides, no
mechanism needed:
- [Done] "The food here is terrible, but this is ridiculous!" — eat inedible (L149) → `eat` `not_edible`.
- [Done] "That would never work!" — take snow (L699) → `take_refusal`/scenery.
- [Done] "That would be a waste of time." — pointless action (L954, L1299) → per-verb failure.
- [Done] "You can't be serious." — get the wires (L1499) → `take_refusal`.
- [Done] "Talking to yourself is a sign of impending mental collapse." — say to self (L633) → `instead say` self-address.
- [Done] "Pushing the X has no effect." / "Fiddling with the X has no effect." — default
  push/touch (L1348, L326) → re-theme `push_inert`/`touch_nothing`.
- [Done] "You can't get a good grip on the new brick with your fingers." — needs a tool (L1345) → `take_refusal`.

**Rides an already-decided item:**
- [Will do] "Cheery, aren't you?" — "hello" (L616): the message is content once the `hello`/greeting
  verb lands (§1 talk-to, Will do, separate doc).
- [Will do] "Please use compass directions instead." — `exit`/`out` where invalid (L1059): part of
  the enter/exit cluster (§1, Will do) — the `exit`-as-direction vs leave-object tension.

**Actually a new verb (not just tone) — needs a decision:**
- [Won't do] **COMPARE (two-noun verb).** "You can only compare two things." (L1046) / "Allowing for
  the different media…, they are identical." (L1049). A real `compare X to/with Y` verb with
  arity checking and a success path. (A game that needs it adds its own two-noun action.)
- [Won't do] **YES / NO handling.** "That was a rhetorical question." — yes/no when nothing asked
  (L1252). New YES/NO verbs plus a "was a question pending?" state. (Games handle yes/no via
  their own `say`/`instead` rules.)
- [Won't do] **contextual HELP hint.** "I notice that one file is marked as urgent…" (L54). A HELP
  verb that emits context-sensitive hints. (Left entirely to games.)

(See also the structural parse-error catalog in §2.)

---

## 8. Scoring & endgame

- [Done] **NEW — score + move counter.** "Your score is 30 of a possible 100, in 352
  moves." (L1848). Built: `scoring.lamp` (`max_score`, point-award hook, SCORE verb) + turn/move
  counter in the status line.
- [Won't do] **NEW — score→rank table.** "Graded on the curve, you are in the class of Senior."
  (L1848). A threshold→label lookup composed into the readout — not built, and declined.
- [Done] **NEW — multiple distinct death messages / causes**, all routing to the same
  endgame menu (the "gnawing on your toes / fingertips / ears" variants, L1846+). Authorable
  on the existing end-game path: each cause sets its own banner (`ending_override`/`story_lost`)
  before the shared RESTART/RESTORE/QUIT menu. Different message per cause = game content.

---

## Suggested high-leverage clusters (my read)

If you want bang-for-buck, these clusters unlock the most of the transcript at
once and align with existing TODO direction:

1. **Openable/lockable + keys + portable light + doors** — turns the static world
   into a navigable one; many verbs (`open`, `unlock`, `turn on`) share it.
2. **`put X in Y` containment + `take X from Y`** — the container half of the
   world model (we only have supporters).
3. **Turn cycle + daemons + `wait`/`again`** — already TODO item 4; unlocks
   timers, wanderers, fatigue, ambient text.
4. **NPC `ask/tell/give/show` dialogue subsystem** — the biggest *new* surface,
   and the most characterful.
5. **`ALL`/multi-object + one-word disambiguation answers + the parse-error
   catalog** — parser depth (TODO Parser v1/v2), makes everything else feel like
   a real IF parser. (Multi-word nouns ride the token bag — adjectives are a
   non-goal.)
