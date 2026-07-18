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
  diff against `sample/phobos`); the pod enter/open refusals also merge into two
  `is sleeping_pods` rules. `sample/phobos` keeps the repeated per-object form —
  that's the faithful port.

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

- **List predicates** (hacking.lamp, linguistics.lamp): the keypad goal checks
  and scan-tier counts use lib/sys's `includes`/`count_of`/`all_true`/`any_true`
  instead of hand-rolled index loops (`nine_solved` is `all_true(nine_buttons)`;
  `in_control_parts` is gone in favor of `includes(control_parts, n)`).
  Behavior verified identical against `sample/phobos` by a keypad/RESET
  transcript diff; the frozen port keeps its loops.

The full `test endgame` walkthrough is a golden (`phobos_ex` in
tests/golden/expected/), so EX must stay winnable as enhancements land.
