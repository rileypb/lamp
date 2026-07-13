# Slot Accessibility — visible vs. touchable

> Status: **implemented (2026-07-12).** `visible`/`touchable` slot markers
> (parser → `setVisibleSlot`), the runtime gate (`setReachGate` /
> `gateBlockedSlot` between `instead` and `check` in `runAction`), the library
> gate (`reach_gate`, rooms.lamp, installed via lib/sys `set_reach_gate` at
> startup), and the migration (8 `visible` markers in lib/advent + 2 in
> lib/conversation; the four `instead` reach rules and the TAKE/TOUCH/TASTE
> `reach_barrier` checks deleted). Goldens `transparent1`/`reach1` held
> **byte-identical** through the mechanism swap; `accessibility1` covers the
> spyglass example and per-object multi gating. One nuance beyond the design:
> a gate-blocked action also skips `report_failed` (a verb's own failure prose
> — e.g. a `take_refusal` — would double-report after the gate's message).
> Defines per-slot accessibility for actions — which noun slots
> require *reach* (touchable) and which need only *sight* (visible) — replacing
> the current per-verb enumeration of reach checks. Companion to the reach model
> in `lib/advent/rooms.lamp` (`reach_barrier`) and the transparent-box /
> visibility-ceiling sections of `devdocs/specs.md`.

## The motivating example

```
> GAZE AT moonstone THROUGH spyglass
```

The spyglass must be **touchable** (you hold it to your eye); the moonstone need
only be **visible** (that's the point of a spyglass). Reach is not a property of
the *verb* — it is a property of **each slot**. Any action-level mechanism (a
`contact` tag, the current selector rules) gets this wrong by construction.

## Current state (what this replaces)

Reach is enforced today by per-verb enumeration in `lib/advent/actions.lamp`:

- hand-written `check` rules on TAKE / TOUCH / TASTE calling
  `reach_barrier(self.actor, self.<slot>)`;
- four `instead` selector rules covering the other contact verbs — four because
  the slot *names* differ (`target` vs `destination` vs `food` vs `liquid`) and
  a multi-action rule may only read slots common to every targeted action
  (`src/lantern/checker.js`, the common-slot validation).

Weaknesses: a new contact verb must remember to join a list; mixed-accessibility
actions (the spyglass) are inexpressible; and the slot-name fragmentation is
accidental complexity. The **predicate** is right and stays —
`reach_barrier(p, x)` (rooms.lamp) is symmetric (a closed container enclosing
exactly one of {actor, object} blocks; one enclosing both never blocks; the
enclosure itself is reachable from within). Only the *wiring* changes.

## Design

### Per-slot accessibility markers

A physical slot in an action declaration carries an accessibility level, as a
slot-modifier keyword (alongside `direct`):

```lamp
action gaze_through:
	direct visible physical target    # sight is enough
	touchable item instrument         # reach-gated (the default — marker optional)

action examine:
	direct visible physical target    # relaxed: examining needs only sight

action take:
	direct item taken                 # touchable by default — no marker needed
	multi
```

**Levels** (Inform's terms):

| Level | Requirement | Enforced by |
|---|---|---|
| `touchable` | in scope AND `reach_barrier` clear | the new per-slot gate |
| `visible` | in scope | nothing extra — scope already is visibility |

**Resolved decision (a): `touchable` is the default** for physical slots, as in
Inform. Most verbs manipulate; the ones that only look are the minority and are
marked `visible` explicitly. (This inverts today's de-facto default, so the
migration below marks the sensory verbs.) Accessibility applies to
**physical-typed slots only** — a `direction`, `subject`, or primitive slot has
nothing to reach; markers there are a compile error. `world_scope` actions
(debug verbs) skip accessibility entirely, matching their scope exemption.
`out_of_world` actions have no physical slots in practice.

A future third level, **`carried`** (in hand, not merely reachable), would
subsume the hand-written `not_carrying` checks in `put_on`/`put_in`/`give` —
deliberately deferred (Open questions).

### Where enforcement runs

**Resolved decision (b): a failed accessibility test skips the `check` bands**
(and everything after). The action fails as a whole; the refusal is the gate's
message, not a verb-specific one.

Placement in the action sequence: **after `instead`, before `check`**, inside
`runAction` (so nested `try` — an NPC action, `wear`'s implicit take — is gated
too). Running after `instead` is a deliberate divergence from Inform (whose
accessibility precedes Instead): `instead` is Lamp's per-case override hatch, so
a game rule can still permit the magic gaze that works through glass —
`instead gaze_through when self.instrument == moonlens: … stop succeeded`.
Inform gets the same flexibility from its customizable reaching-inside rulebook;
Lamp gets it from the band it already has.

An accessibility failure behaves like a failed `check` for turn accounting: the
turn is spent, the undo checkpoint stands, every-turn rules fire.

### The engine/library seam

Following the `set_all_filter` / `setSlotScopedByContents` pattern, the engine
holds no reach policy:

1. **Compiler** (`src/lantern`): parse the marker in slot declarations; since
   `touchable` is the default, emit only the **relaxations** — per-action
   metadata naming its `visible` slots (mirror of how `direct`/`multi` flow
   through `ActionDecl` → emitted registration).
2. **Runtime** (`src/lamplighter`): before the `check` bands, for each
   physical slot NOT marked `visible`, call the installed gate with
   `(actor, value)`; if the gate reports blocked, abort the action as failed.
3. **Library** (`lib/advent`): installs the gate at startup
   (`wire_verb_scoping`-style): the gate calls `reach_barrier`, sets
   `beyond_reach`, prints `beyond_reach_msg`, and returns blocked. All prose
   stays locale-owned; the engine never prints.

### Multi-object actions

**Resolved decision (c): per-object gating.** A `multi` action's per-object
dispatch tests each object individually, inside its "name: " prefix, so a sweep
degrades gracefully:

```
> take all
coin: Taken.
moonstone: You can't reach that.
```

The unreachable object is refused, the rest proceed. (`all` still *includes*
visible-but-unreachable things — being listed and refused is more informative
than silently vanishing from `all`; a game that wants exclusion has `all_exempt`
and the `set_all_filter` policy.)

### NPC actors

**Resolved decision (d): gated the same way.** The gate receives the acting
`actor` (not the player), and `reach_barrier` is already actor-parametric — an
NPC shut in the booth can't reach the counter either. Nested `try` with an
`actor` override flows through `runAction`, so it is covered by the placement
above.

## Migration (library)

Mark `visible` on the sight-only slots; everything else gets `touchable` free:

- `examine.target`, `look_in.target`, `look_under.target`, `look_behind.target`,
  `search.target`, `listen_to.target`, `smell_thing.target` — sensory.
- `show.recipient` — you display across the glass; `show.shown` stays touchable
  (it's in your hands).
- `lib/conversation`: `ask.interlocutor`, `tell.interlocutor` — vocal.

Then delete the superseded wiring: the four `instead` reach rules and the
`reach_barrier` checks in TAKE/TOUCH/TASTE (`actions.lamp`). The trait checks
(`feelable`, `far_away`, `obstructed`, `edificial`) are a different mechanism
and **remain**. `reach_barrier`, `beyond_reach`, and `beyond_reach_msg` remain
as the gate's implementation.

Goldens expected to hold: `transparent1`, `reach1` (same behavior, new
mechanism); `interior1`/`enterable4` unaffected (barriers enclosing both ends
never block).

## Non-goals

- No separate visibility predicate — `visible` *is* "in scope" (the scope
  barrier and visibility ceiling already define sight).
- No per-object "reach exceptions" data (a long-armed robot); a game overrides
  per-case with `instead`, or wholesale by installing its own gate.
- No change to the trait-based refusals (`far_away`/`obstructed`/…).

## Open questions

- **The `carried` level.** Worth adding while touching the compiler, or as a
  follow-up? It would centralize `not_carrying` checks (and their implicit-take
  interplay — see the implicit-action facility item) but expands this feature's
  blast radius.
- **Marker syntax.** `touchable`/`visible` as bare slot-modifier keywords
  (proposed, matching `direct`), vs. a parenthesized annotation. Bare keywords
  need the parser to keep slot-modifier and type tokens unambiguous.
- **Gate result vs. printing.** The library gate printing its own refusal (as
  proposed) means the engine can't distinguish "blocked silently" from
  "blocked with message" — fine today; revisit if a silent-block use case
  appears.
- **`take_from.source`.** Touchable by default (you reach into it) — but note
  the FROM-scoping already bounds resolution to its contents; confirm the two
  compose rather than double-refuse.
