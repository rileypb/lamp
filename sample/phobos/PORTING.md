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
| autopower down rule listed last (L95) | every-turn rule ordering | **Done** — advent now has `every_turn_rules` (run_command returns turn-spent); `suit.lamp` wires the auto-power-down as an every-turn rule (skips the power-up turn via a flag) |
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

**Ported (in `base.lamp`):** the room declarations and the door-free connections,
and now **every room description** (Base.i7x). Siriusian signage uses the static cipher
`[siriusian("…")]` (always alien, like the Passage End door label) and door-state shows
via `[if <door>.closed]…[end if]`; both render correctly in play (verified open↔closed
across the green/yellow doors). The North Barracks `cabinet` was added (a scenery `box`)
so its `[if cabinet.closed]` resolves. Door-gated rooms (Reactor Room, armory,
Commander's Quarters via their puzzles; Control Room + Flight Deck still gated behind the
unported purple door) all have descriptions in place.

**Deferred (room-description follow-ups):** **scan-aware Siriusian labels** — today the
labels are static-alien and never translate; making them respond to scan level (like the
diary content) needs a string-returning translate function and would also convert the
Passage End door label off `siriusian()`. The in-prose **sub-objects** (door/west/store
signs, the sign-out form, the poster, the reactor levers, the control panel + launch/
self-destruct buttons, the cabinet's Cyberhelmet) are mentioned in description text but
not yet declared as examinable objects.

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
   **Deferred on the log:** the actual control-code value appended after "...is" — generated
   by the (unported) purple-door control-code system; the sentence ends at "is" for now.
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
4. **`feels` property + FEEL/TOUCH action** — nearly every object has a `feels`
   string. From `Can't Touch This.i7x`.
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
   random start shuffle dogfooded a **new general `random(n)` native** (lib/sys,
   reusing the engine's seeded/save-captured RNG); the shuffle is a forward
   Fisher-Yates in Lamp (the `for` loop is ascending-only). Under the fixed test
   seed the start is `[4,2,7,9,5,3,6,8,1]`, solved by pressing 1 9 3 6 4 9 6 7.
   The **locker** (in South Barracks, the one room ported in full — its description
   has no Siriusian markup) is a four-button toggle (each press flips only itself;
   start `{red,blue,blue,red}`, goal all-blue → press 1 and 4). Unlike the doors it
   opens a **container** and reveals the **diary** sealed inside — which dogfooded a
   general advent feature: a **closed container hides + seals its contents** (the
   `contents_of` closed-check for listings + a core **scope-barrier seam**
   `registerScopeBarrier` so closed contents are out of scope; golden `closedbox1`).
   Chosen (author): the KIM.i7x 4-button puzzle, not Base.i7x's simple bypass.
   **Remaining doors:** purple (pick-5-of-16, needs the scan/control-code system —
   deferred). `read` is now a synonym for `examine` (advent), so reading the diary
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
   **all five textual documents** (form/diary/notebook/manual/log, tiers 1-5).
   Remaining is only the deferreds noted in item 3 (the `obscure`/`revealed` swap; the log's
   control-code tail with the purple-door system).
8. **Open/close actions** for containers (cabinet, locker); advent's `box` has
   `closed`/`closable` fields but no open/close *actions*.
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
