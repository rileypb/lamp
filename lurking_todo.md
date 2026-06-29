# Lurking Horror — Candidate Features

A menu of features observed in `lurkinghorror.txt` (a real Infocom game) that
Lamp / the advent library **does not yet have**, for you to pick from. Sourced by
reading the whole transcript against the current feature set
(`lib/advent/*.lamp`, `devdocs/game_parser.md`).

Legend:
- **NEW** — nothing comparable exists yet.
- **PARTIAL** — we have a related primitive; this is an extension or sibling.

Line numbers (`L###`) point into `lurkinghorror.txt` for the example.

Already in Lamp (excluded below): `look`, `take`/`get`, `drop`, `inventory`,
`wear`, `take off`/`doff`, `examine`/`x`, `go` + compass directions, `put X on Y`
(supporters), open/closed boxes, darkness (`lighted`), the "Which X do you mean…"
disambiguation, the `it` pronoun, `"You can't go that way."`, and
`"There is X here."` room listing.

---

## 1. Verbs we don't have

### Object manipulation
- **NEW — `open`/`close` as a general openable trait, with `reveals`.** Beyond
  boxes: fridge, microwave, flask, manhole, door, access panel, plate.
  "Opening the refrigerator reveals a two liter bottle of Classic Coke and a
  cardboard carton." (L257); "The microwave oven is now open." (L276)
- **NEW — `put X in Y` (containment) verb.** We only have `put X on Y`
  (supporters). "put carton in microwave" → "Done." (L278); refused when closed:
  "Inspection reveals that the microwave oven isn't open." (L273)
- **NEW — `take X from Y` / `take X out of Y`.** "take stone from professor" (L2049)
- **NEW — `turn on` / `turn off` (switchable devices).** pc, flashlight,
  forklift, computer. "The flashlight clicks on." (L839); "The forklift sputters
  to life." (L774)
- **NEW — `unlock X with Y` / `lock X with Y`.** Lock+key as world state.
  "The lock, though rusty and unwilling, opens, releasing the hatch." (L1229);
  "The master key doesn't work on this lock." (L1964)
- **NEW — `push`/`press` (buttons, movable objects).** "push call button",
  "press start", "push bench" → "It's heavy, but it moves, revealing a hinged
  metal trapdoor beneath." (L2701)
- **NEW — `pull` / `move` / `pry … with` / `break … with` / `cut … with`.**
  Tool-mediated actions. "remove cover with crowbar" (L896); "cut cord with ax"
  (L1810); "break glass" → "Wearing the heavy gloves, you confidently smash the
  glass…" (L1656)
- **NEW — `hit`/`attack X with Y`.** Combat-ish. "cut man with axe" (L1821)
- **NEW — `pour X on Y` / `pour X`.** "pour liquid" → "It pours out and spreads
  like ants at a picnic." (L1884)
- **NEW — `search X`.** "search junk" → "You find many worthless items… but
  nothing of any use or value." (L848)
- **NEW — `dig` / `dig in X`.** "dig in dirt" → "…you encounter something hard."
  (L2159)
- **NEW — `touch`/`fiddle with`.** "Fiddling with the cardboard carton has no
  effect." (L326)
- **NEW — `set X to Y`.** Setting a value/dial. "set timer to 4:20" (L510)

### Movement variants
- **NEW — `enter`/`exit`/`get in`/`get out`/`get on`/`get off` (vehicles &
  enterable objects).** "You are now in the forklift." (L768); reach limits while
  riding: "You can't reach the urchin from within the forklift." (L783)
- **PARTIAL — `up`/`down`/`in`/`out` already exist as directions, but `climb X`,
  `climb up/down`, and verb-form `enter`/`exit` mapping to movement do not.**
  "climb rope" (L2325)
- **NEW — vehicle-constrained movement.** A ride blocks some exits: "The forklift
  won't fit into the stairwell." (L786)

### Sensory / examine extensions
- **NEW — `read X` distinct from `examine`.** Text objects render their writing.
  "read sign" → "It says 'NO ADMITTANCE!'…" (L2118)
- **NEW — `listen` / `smell` / sensory verbs.** "listen" → "You hear the
  chittering of rats." (L1247) — and the answer *changes over turns*.
- **NEW — `look through X` / `look in X` / `look under X` / `look down X`.**
  "look through trapdoor" → "…you can see part of a workroom or lab." (L924)
- **NEW — `examine me` / self-description.** "x me" → "You are wide awake, and are
  in good health." (L663)

### Eating / drinking / consumables
- **NEW — `eat X` / `drink X`, with edible/potable traits.** "drink coke" →
  "Delicious! …You feel much more alert and awake now." (L1192); non-food: "The
  food here is terrible, but this is ridiculous!" (L149)
- **NEW — consumable depletion.** A drink empties its container: "The bottle is
  empty." (L2242)

### NPC interaction (a whole subsystem)
- **NEW — `talk to X` / `X, hello`.** "talk to hacker" → "Hmmm … the hacker waits
  for you to say something." (L12)
- **NEW — `ask X about TOPIC`.** Topic-based dialogue. "ask hacker about keys" →
  a paragraph of lore (L196). Unknown topic: "I don't know the word 'hacking.'"
  (L18)
- **NEW — `ask X for Y` / `give X to Y` / `show X to Y` / `feed`.** The give/show
  economy with per-NPC reactions: "give chinese food to hacker" → "'Yuck! This
  isn't warm enough!'" (L393); "show stone to creature" → "The thing is
  uninterested." (L154)
- **NEW — `X, COMMAND` (ordering an NPC).** "urchin, boo" (L761); enforced
  addressing: "You must address the urchin directly." (L759)

### Meta / out-of-world
- **DONE — `wait` / `z`.** "Time passes." — a core advent action (lib/advent/actions.lamp),
  a normal in-world turn so every-turn rules fire; message `wait_report`; golden `wait1`; specs.md.
- **PARTIAL — `again` / `g`.** Repeat last command. "again" (L1280) — needs
  last-command memory (related to TODO Parser v2).
- **NEW — `save` / `restore` / `restart`.** "Okay." (L65); end-of-game menu
  (RESTART already tracked separately as TODO item 2; SAVE/RESTORE is its own).
- **NEW — `score`.** Implied by the endgame readout (L1848).
- **NEW — `verbose` / `brief` / `superbrief` display modes.** "Verbose
  descriptions." (L593) — controls whether room text reprints on re-entry.

---

## 2. Grammar & parser features

- **NEW — `ALL` / `EVERYTHING` with per-item reporting.** "take all" →
  ```
  two liter bottle of Classic Coke: Taken.
  cardboard carton: Taken.
  ```
  (L260); also `drop all` (L1714).
- **NEW — multiple objects & `EXCEPT`.** "take all except…", comma lists. The
  selector machinery for multi-object resolution.
- **WON'T MODEL (by design) — adjectives as a part of speech.** "smooth stone",
  "carved symbol" vs "incised symbol", "new brick" vs "broken brick" (L1335).
  These are handled by the **token bag** (AND-matched name tokens), not POS
  tagging — a decided non-goal (`game_parser.md` → Non-goals). The disambiguation
  behavior is wanted; the *mechanism* is token-bag, so this lands under the
  `ALL`/multi-object + disambiguation work, not a separate adjective feature.
- **PARTIAL — disambiguation answered by a bare distinguishing word.** After
  "Which brick…", the player types just "new" (L1337). We prompt, but resolving
  the one-word reply (a token-bag query within the candidate set — no adjectives
  needed) isn't wired yet.
- **NEW — multiple commands per line (`.` separator).** "take off gloves. wear
  hyrax. put on gloves." (L2786)
- **NEW — richer prepositional grammar tokens.** `with`, `in`, `on`, `to`,
  `from`, `about`, `into`, `through`, `down`, `for`. Many map to two-noun verbs.
- **NEW — parser comment lines (`;…`).** Lines beginning with `;` are ignored
  (Infocom convention) (L629).
- **NEW — distinct structural parse errors.** A catalog we don't yet emit:
  - empty input → "I beg your pardon?" (L232)
  - no verb → "There was no verb in that sentence!" (L780)
  - missing noun → "There seems to be a noun missing in that sentence." (L39)
  - unparseable → "That sentence isn't one I recognize." (L2695)
  - bad preposition → "You used the word 'of' in a way that I don't understand."
    (L830)
  - verb/noun mismatch → "How do you do that with a banners?" (L238)

---

## 3. World-model / object capabilities

- **NEW — openable + lockable + key, as composable traits.** open/closed/locked
  state; a key object that fits a lock; "open" refused when locked.
- **NEW — a portable light source.** A `flashlight` you carry that provides light
  in dark rooms (we have `lighted` rooms but no carryable light that flips it).
  Inventory even annotates it: "a flashlight (providing light)" (L930).
- **NEW — doors as shared, stateful connectors between two rooms.** A door/glass
  wall/plate that is itself an object and blocks the exit until opened/unlocked.
  "There is a glass wall in the way." (L679); "The Alchemy Department door is
  closed." (L2060)
- **NEW — custom blocked-exit messages (per exit).** "Impenetrable snow drifts
  block the street." (L1172); "You can't walk off with that! It's Tech
  property!" (NPC blocks an exit, L606)
- **NEW — carry capacity / weight limits.** "Your load is too heavy." (L570);
  "You're holding too many things and can't quite get them all arranged…" (L1551)
- **NEW — bulk / squeeze constraints on movement.** "It's too tight a fit
  carrying the metal flask." (L1216)
- **NEW — wear-layer conflicts.** "The brass hyrax won't go on over the gloves."
  (L2784)
- **NEW — liquids as a substance kind.** Not takeable; drinkable; pourable. "You
  can't take it, it's a liquid." (L2760)
- **NEW — enterable / ride-able objects (vehicles) with their own location
  semantics.** Room headers gain ", on the forklift" / ", in the forklift"
  (L789, L795).
- **NEW — object state that changes description & reactions.** Szechuan shrimp is
  cold → warm → hot → overcooked depending on microwave time, and the hacker
  reacts differently to each (L332, L371, L396, L478, L560).
- **NEW — "initial" vs "moved" object descriptions.** Before first touched, an
  object gets a bespoke presence sentence ("Sitting on the kitchen counter is a
  package of Funny Bones.", L248); after, the generic "There is X here." We have
  only the generic form.
- **PARTIAL — group/plural objects.** "There are urchins here." / "rats" treated
  as a swarm (L1471). We pluralize lists but have no collective-object concept.

---

## 4. Turn cycle, daemons & timed events

(Overlaps with TODO item 4 "Parser v2 — every-turn & timed rules.")

- **NEW — the turn clock / `wait` advancing time.** "Time passes…" (L355)
- **NEW — daemons (per-turn background messages on an object/room).** The pit:
  "A low, guttural, groaning and snarling issues from the opening." repeats each
  turn (L998–L1028); the professor's escalating "continues to gaze at you with
  malign intent." (L2007+)
- **NEW — countdown timers / fuses.** The microwave counts down over turns and
  fires an event at zero: "The microwave stops." (L317)
- **NEW — moving NPCs (wanderers).** "The hacker wanders over…" (L169); "The
  urchin saunters nonchalantly into the room, notices you, and beats a hasty
  retreat." (L792)
- **NEW — escalating, scripted scene sequences.** The summoning ritual prints a
  new escalating paragraph every turn regardless of input (L2509+).
- **NEW — environmental damage over time.** Blizzard cold each turn on the roof:
  "Bitter, bone-cracking cold assaults you continuously." (L701)

---

## 5. The player character as a modeled object

- **NEW — fatigue / health state with daemons.** "You are beginning to tire."
  (L1184) → "You are feeling tired." (L2369) → "You are getting more and more
  tired." escalating; sleeping or caffeine resets it.
- **NEW — `sleep` and dream sequences.** "sleep" → narrated rest / nightmare
  (L2523).
- **NEW — death state + endgame menu.** "**** You have died ****" then "Would you
  like to restart… (Type RESTART, RESTORE, or QUIT):" (L1844-L1851).

---

## 6. Interesting generated / dynamic text

- **NEW — nested container-contents rendering.** "The microwave oven contains a
  cardboard carton. The cardboard carton contains Chinese food." (L490)
- **NEW — room description that mutates with world state.** Dead Storage gains "A
  narrow path winds eastward through the junk." after the forklift clears it
  (L1096 vs L842).
- **NEW — implicit-action announcements.** "(Taking the pair of rubber boots
  first)" (L2096); "(first taking off X)" (we do this for put_on/drop, but not as
  a general "implicit action" facility).
- **NEW — varied object-presence sentences.** "Sitting at a terminal is a hacker…"
  / "Nearby is one of those ugly molded plastic chairs." / "A really whiz-bang pc
  is right inside the door." — per-object custom presence text instead of "There
  is X here." (L223-L227).
- **NEW — second-person conditional flavor based on worn/held gear.** "Wearing the
  heavy gloves, you confidently smash the glass…" (gloves change the outcome)
  (L1656).

---

## 7. New refusal / error / success messages (flavor catalog)

A grab-bag of player-facing one-liners worth stealing for tone. Most attach to a
verb's failure path or a default "you can't do that" handler.

- "The food here is terrible, but this is ridiculous!" — eat inedible (L149)
- "That would never work!" — take snow (L699)
- "That would be a waste of time." — pointless action (L954, L1299)
- "You can't be serious." — get the wires (L1499)
- "Talking to yourself is a sign of impending mental collapse." — say to self (L633)
- "Cheery, aren't you?" — "hello" (L616)
- "That was a rhetorical question." — yes/no when nothing asked (L1252)
- "You can only compare two things." — compare misuse (L1046)
- "Allowing for the different media…, they are identical." — successful compare (L1049)
- "Please use compass directions instead." — `exit`/`out` where invalid (L1059)
- "Pushing the X has no effect." / "Fiddling with the X has no effect." — default
  push/touch (L1348, L326)
- "You can't get a good grip on the new brick with your fingers." — needs a tool (L1345)
- "I notice that one file is marked as urgent…" — contextual HELP hint (L54)

(See also the structural parse-error catalog in §2.)

---

## 8. Scoring & endgame

- **NEW — score + move counter + rank table.** "Your score is 30 of a possible
  100, in 352 moves. Graded on the curve, you are in the class of Senior." (L1848)
  — needs a score global, a per-action/event award hook, a move counter, and a
  score→rank lookup.
- **NEW — multiple distinct death messages / causes**, all routing to the same
  endgame menu (the "gnawing on your toes / fingertips / ears" variants, L1846+).

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
