# Phobos EX

A copy of `sample/phobos/` that carries **Lamp-native enhancements** beyond the
Inform 7 original. The split exists because the original Phobos is a **frozen
1:1 fidelity artifact** — the proof that Lamp can reproduce a real I7 game
byte-for-byte (see `sample/phobos/PORTING.md`) — so anything that would diverge
from the I7 source lives here instead. Never add non-parity features to
`sample/phobos/`.

Header comment aside, `phobos_ex.lamp` and `lib/phobos/` start as a verbatim
copy (game object renamed `Phobos_EX`, title "Phobos EX", so builds and saves
never collide with the original). Enhancements so far:

- **`lib/phobos/map.lamp`** — the DECK PLAN feed (devdocs/custom-shells.md): a
  fog-of-war deck map rendered by the custom shell as a bottom strip. Only
  rooms Galaxy has seen are sent with labels (Siriusian cipher; plain English
  with the Cyberhelmet); rooms adjacent to her ride along as label-less "?"
  frontier cells. Every cell adjacent to her is clickable — the click
  synthesizes that direction's command, so a closed door refuses exactly as
  if typed. The whole visible plan re-sends each turn (declarative recompute:
  UNDO makes the map forget rooms again). The `seen`/grid fields live on a
  `type room` reopen. (History: this began as a freestyle canvas pane —
  devdocs/freestyle-windows.md step 4 — and moved to the custom shell for a
  responsive layout; a mission-status text pane also lived here once and was
  removed as spoiler-y — score stays on the SCORE verb.)

- **`lib/phobos/kim_shell.lamp` + `phobos_ex.shell/`** — the KIM hacking
  simulator (devdocs/custom-shells.md; the first real custom-shell consumer):
  on the web, the KIM renders as a bottom-strip alien slab — glowing red/blue
  buttons, Siriusian glyph faces, a solve pulse, a shake on the purple door's
  wrong-five beep — that appears under the map when the KIM adheres and
  retracts when it detaches. While it is open the map collapses to a slim
  header bar (tap to peek); the transcript contracts/expands to make room
  (mobile-friendly).
  Clicking a button synthesizes the same PRESS command the player could type,
  so the real puzzle rules adjudicate every click and the transcript stays a
  complete record; the game streams the whole board state each turn
  (declarative recompute — UNDO/RESTORE repaint the device), and the ASCII
  keypad art is suppressed while the simulator is live
  (`shell_available()` gates in hacking.lamp). CLI/plain hosts keep the ASCII
  keypads exactly as ported.

- **Declaration dedup via subtypes + declaration-site `self`** (base.lamp,
  scenery.lamp): the six coloured doors, seven wall signs, six handprint
  scanners, and two sleeping pods each collapse onto a shared subtype
  (`scanner_door`, `wall_sign`, `handprint_scanner`, `sleeping_pods`) that
  re-declares inherited fields with new defaults; the shared refusal/description
  prose names the owning object and reads its live state through `self`
  (`[the self]`, `[if self.closed]…` — specs.md "Declaration-site `self`").
  Player-visible behavior is unchanged from the original (verified by transcript
  diff against `sample/phobos`). `sample/phobos` keeps the repeated per-object
  form — that's the faithful port. (The pod enter/open refusals, first merged
  via `is` guards, now live in the type body — see Body-nested rules below.)

- **Scenes** (hacking.lamp, guard_endgame.lamp, guard_persuasion.lamp,
  control_room.lamp): three of the game's dramatic modes are `scene`s
  (devdocs/scenes.md) — `kim_hacking` (the five compound adhered-and-in-room
  guards became one declared scene; the implicit KIM retrieve is a
  `before go during kim_hacking` rule), `commando_fight` (the burst-in is the
  begin hook, the distracted→shot rule is `during`, and the `commando_started`
  latch dissolved into `.happened`), and `guard_meeting` (the button spy-death
  overrides are `during`). The interjection roll and the arrival greeting
  deliberately keep live guards — their timing is observed mid-turn, ahead of
  the scene pass (see scenes.md "Adoption findings"). Behavior verified
  identical: byte-identical endgame golden plus seven hand-test transcript
  diffs against `sample/phobos`.

- **Body-nested rules** (guard_endgame.lamp, scenery.lamp): the commando
  type body carries the shared combat behavior — attack/shoot/touch/take/drop,
  each implicitly scoped to "the direct slot is a commando", merging the
  per-object rule pairs via `self.taken`/`self.dropped` — and the
  sleeping_pods type body carries the enter/open refusals. Combat-variant
  transcripts diff-identical to `sample/phobos`. (One knowing deviation, from
  the scenes work: the original re-fires the mid-fight distracted→shot rule on
  QUIT after Galaxy has already died there — a post-mortem double-death the
  scene's story-end sweep correctly prevents; see scenes.md "Adoption
  findings".)

- **Regions** (base.lamp, backdrops.lamp, scenery.lamp, countdown.lamp,
  pa_broadcasts.lamp): `the_base` ⊃ `base_interior` ⊃ `labs` — the
  countdown/PA "inside the base" guards read `in_region`, the gray-tile
  wall/floor/ceiling defaults live on `base_interior` (rooms override;
  the armory keeps its self-naming prose per-room), and the PA System
  backdrop is region-scoped to the indoor base. That last one **corrects
  the port's documented over-reach** (scenery.lamp had noted it "until
  region-scoped backdrops land"): X PA at the passage end / flight deck /
  ship now answers "There is nothing there.", as the I7 original did — a
  knowing deviation from `sample/phobos`. Everything else verified
  identical (materials transcript across every room; endgame golden
  byte-identical).

- **Route-driven NPC movement** (guard_endgame.lamp): the guard-leading
  sequences are `try go: actor guard, way route_to(here, goal)` — one step
  per co-located turn through the ordinary go pipeline (doors adjudicated,
  Galaxy-only go rules kept away by the actor default), with advent's
  witnessed-movement report reproducing the hand-written narration
  byte-for-byte. Eight move-and-print branches became two route steps.

- **Data tables** (hacking.lamp, scoring.lamp, pa_broadcasts.lamp,
  interjections.lamp, linguistics.lamp): the static tables are list-literal
  globals instead of if-chain functions — the two hidden keypad flip-sets are
  `list<list<int>>` tables (the puzzle rules readable at a glance), the score
  ranks and the twelve PA broadcasts and seven interjections are indexed
  string tables (their lookup functions deleted), and
  `pa_order`/`interj_order`/`scan_levels` initialize at their declarations
  (the startup_rules fills dropped; startup only shuffles). The KIM's
  per-target data is four `map<physical, …>` tables
  (`kim_surfaces`/`kim_blurbs`/`kim_show`/`kim_ranges` — the last a
  function-valued map whose entries are the keypad renderers), replacing the
  three parallel five-way if-chains in
  `kim_surface_name`/`kim_state`/`press_bad_digit`. The genuinely-static
  tables and cipher strings are `const` — immutable and exempt from the
  per-turn undo/save snapshot; the shuffled order lists stay `global`.
  Behavior verified
  identical against `sample/phobos` — endgame golden byte-identical plus the
  nine-transcript battery.

- **List predicates** (hacking.lamp, linguistics.lamp): the keypad goal checks
  and scan-tier counts use lib/sys's `includes`/`count_of`/`all_true`/`any_true`
  instead of hand-rolled index loops (`nine_solved` is `all_true(nine_buttons)`;
  `in_control_parts` is gone in favor of `includes(control_parts, n)`).
  Behavior verified identical against `sample/phobos` by a keypad/RESET
  transcript diff; the frozen port keeps its loops.

The full `test endgame` walkthrough is a golden (`phobos_ex` in
tests/golden/expected/), so EX must stay winnable as enhancements land.
