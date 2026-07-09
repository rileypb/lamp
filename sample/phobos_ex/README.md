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

- **`lib/phobos/windows.lamp`** — the mission-status text window
  (devdocs/text-windows.md step 4): score/rank/scan progress, plus the
  doom-clock once Galaxy is inside the base (Siriusian digits, plain numerals
  with the Cyberhelmet — mirroring the PA announcements). Docks right on the
  web shell; re-docks to a compact 3-row top pane on the CLI TUI via the
  capability handshake (the refresh rule composes dock-aware: one field per
  row on the right dock, two per row on the row-precious top dock); on a
  windowless host it never renders and the SCORE verb remains the
  authoritative fallback.

- **`lib/phobos/map.lamp`** — the deck-plan canvas pane
  (devdocs/freestyle-windows.md step 4): a right-docked freestyle window
  drawing the base's rooms as a grid of rects with corridor lines, rooms
  Galaxy has seen filled brighter (a `seen` field marked as she moves;
  snapshot-covered, so UNDO forgets a room again), a marker on her current
  room, and labels rendered through the Siriusian glyph cipher — plain
  English while the Cyberhelmet is worn, the mission pane's countdown
  convention. Shown only where `window_kind_available("canvas")` is true
  (the web shell); on the TUI and plain hosts it stays hidden and the text
  panes above remain the experience.

The full `test endgame` walkthrough is a golden (`phobos_ex` in
tests/golden/expected/), so EX must stay winnable as enhancements land.
