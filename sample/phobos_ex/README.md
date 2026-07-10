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

The full `test endgame` walkthrough is a golden (`phobos_ex` in
tests/golden/expected/), so EX must stay winnable as enhancements land.
