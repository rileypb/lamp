# Scenes

> Status: **design finalized (2026-07-17), not yet implemented.** The four
> design questions were decided by the author — see "Resolved decisions" — so
> this is ready to build (roadmap below). This document designs the
> scene mechanism — named, latched spans of play time with begin/end hooks and a
> `during` rule guard. The motivating evidence is `devdocs/phobos_gaps.md` §5:
> Phobos's dramatic modes (the guard meeting, the guard-led arming, the commando
> fight, the KIM-adhered hack) are each a lattice of global bools whose
> combinations are re-derived, verbatim, in every participating rule.

## Purpose

A **scene** is a named period of play with a beginning and an end: a latched
boolean the engine maintains from declared conditions (or imperative calls),
with entry/exit hooks and a first-class way for any rule to say "only while
this is happening." Scenes give three things raw globals do not:

- **One name per mode.** `during guard_meeting` replaces
  `met_guard and not guard_allied and holder(player) == Control_Room and
  holder(guard) == Control_Room` — written once in the scene declaration
  instead of re-derived in every rule that participates
  (`interjections.lamp:54`, `guard_persuasion.lamp:134`,
  `control_room.lamp:24-31`, …).
- **Entry/exit as hooks, not rule bodies.** "The commandos burst in" stops
  being an `every_turn_rules` contribution guarding on
  `commando_started == false` + a latch write, and becomes the scene's begin
  hook.
- **Lifecycle bookkeeping for free.** "Has this already happened?"
  (`met_guard`, `commando_started`) is the scene's own `happened` field, not
  another hand-maintained global.

Scenes are Inform 7's scene construct re-based on Lamp's explicit, typed
character: transitions are evaluated at one declared point in the turn cycle,
scene state is ordinary object fields (so undo/save/restore need nothing new),
and hooks are ordinary events.

## Boundaries

- **In scope:** the `scene` declaration (begins/ends conditions, `recurring`),
  the scene object's fields, imperative `begin_scene`/`end_scene`, the
  begin/end events, the `during` guard on phase rules and rulebook
  contributions, the evaluation point in the turn cycle, and persistence.
- **Out of scope (non-goals below):** named endings ("ends happily"),
  scene-relative time ("when X has been happening for 3 turns"), derived
  always-computed scenes (`active when`), and any scene UI.

## Inputs and outputs

- **Input:** `scene` declarations in any file; `begin_scene`/`end_scene` calls
  from rule/function bodies; the world state the begins/ends conditions read.
- **Output:** per-scene `active`/`happened` fields readable anywhere; the
  `<scene>_begins`/`<scene>_ends` events; `during`-guarded rules activating and
  deactivating with the scene.

## The model

### A scene is a singleton object

`scene NAME:` declares a singleton object of the built-in type `scene`
(parallel to how `action NAME:` declares an action type). Its fields:

- `bool active` — the scene is happening now. Maintained by the engine;
  authors read it (directly, or via `during`).
- `bool happened` — the scene has begun at least once, ever. Replaces
  latch globals like `met_guard`/`commando_started`.
- `bool recurring` — default `false`. A non-recurring scene that has ended
  never begins again from its declared conditions (`begin_scene` can still
  restart it explicitly); a recurring one can.

**Scene fields are read-only to game code** (decided): assigning
`X.active`/`X.happened`/`X.recurring` is a **compile error** directing the
author to `begin_scene`/`end_scene` (`recurring` is fixed by the declaration).
A direct write would skip the begin/end events, so the checker closes that
door — the language's first field-level write restriction, scoped to the
built-in `scene` type's own fields (a subtype's *additional* fields, if scene
subtypes are ever allowed, would not be restricted).

Because these are ordinary instance fields on a named object, the existing
instances state provider captures them: **undo, save, restore, and RESTART need
no new machinery**, and a restore never re-evaluates transitions — scene state
is data and rides the snapshot.

### Declaration

```lamp
scene guard_meeting:
    begins when guard_meeting_conditions()
    ends when guard_allied or not (holder(guard) == Control_Room)

scene commando_fight:
    begins when self_destruct_in_progress and guard_allied and holder(player) == Control_Room and holder(guard) == Control_Room
    ends when commandos_down()

scene ambush:
    recurring
    begins when patrol_near() and not player_hidden
    ends when not patrol_near()
```

- `begins when CONDITION` / `ends when CONDITION` — each optional, each
  repeatable (several `begins when` lines OR together: any true condition
  triggers; likewise `ends when`). A scene with no `begins when` starts only
  via `begin_scene`; one with no `ends when` ends only via `end_scene` (or at
  story end, below).
- Conditions are ordinary `bool` expressions over globals, named objects, and
  function calls — the same scope as a conditional-overload guard (no
  parameters, no locals, no `self`). They should be **pure reads**: a
  condition may be evaluated several times per turn (the fixpoint pass below),
  so side effects in a condition are an authoring error the docs warn against.
- `begins`, `ends`, and `recurring` are contextual keywords inside a `scene`
  body only. `scene` itself is contextual at top level when followed by a name
  and `:` (or a bare name), like `action`.

### Transitions and the begin/end events

Declaring `scene NAME:` implicitly provides two **events**, `NAME_begins` and
`NAME_ends` (events in Lamp are name-based — `dispatch started` / `on started:`
— so this costs no declarations). Every transition, declared or imperative,
dispatches the matching event at the moment the `active` field flips:

```lamp
on commando_fight_begins:
    move tall_commando to Control_Room
    move short_commando to Control_Room
    flight_deck_door.closed = false
    flight_deck_door.locked = false
    print "[par]Without warning, a pair of Siriusian commandos -- one tall, one short -- burst into the control room from the flight deck above, weapons drawn. Galaxy and the guard spring into action."

on commando_fight_ends:
    commando_finale()
```

Multiple handlers run in registration order, as for any event. The begin hook
replaces the "fire once, set the latch" `every_turn_rules` idiom; the end hook
replaces the "last one down" check embedded in `down_commando`.

### Imperative transitions

```lamp
begin_scene(kim_hacking)
end_scene(kim_hacking)
```

Two lib functions taking a `scene`. They are the same choke point as declared
transitions: they flip `active`, update `happened`, and dispatch the event —
**immediately**, mid-turn, so rules later in the same turn observe the change.
`begin_scene` on an active scene and `end_scene` on an inactive one are no-ops
(no event). `begin_scene` ignores `recurring`/`happened` — an explicit call
always means it. Use imperative transitions for modes anchored to an action
(the KIM adheres inside `instead hack` — `adhere_kim` calls
`begin_scene(kim_hacking)`); use declared conditions for modes derived from
world state.

### Edge atoms — `SCENE begins` / `SCENE ends` (decided: in)

Inside a scene-body condition (only there), two boolean **edge atoms** are
valid: `SCENE ends` is true exactly when that scene ended **this turn**, and
`SCENE begins` when it began this turn. This is the anchoring form —
Inform's "begins when A ends" — and it composes as an ordinary boolean:

```lamp
scene escape_run:
    begins when commando_fight ends and story == ongoing
```

Semantics: every transition (declared or imperative, whichever fired first)
sets a transient per-scene **edge flag**; the evaluation pass reads the flags,
and they are cleared when the pass completes. So an imperative mid-turn
`end_scene(commando_fight)` is seen by that turn's pass, and a declared end in
fixpoint iteration *k* is seen from iteration *k+1* — the successor begins the
same turn. Edge flags are transient by construction (set and consumed within
one turn's pass; the pass is atomic — no checkpoint falls inside it), so they
are **not** part of the persisted state; a restore lands with all edges clear,
which is correct — the transition happened on the turn it happened, not on the
turn you restored.

Unlike the `a.happened and not a.active` idiom (which is level-triggered and
stays true forever after — wrong for a recurring predecessor), the edge atom is
true for one pass only, so it anchors correctly to *each* run of a recurring
scene. The atoms are contextual — `begins`/`ends` after a scene name, inside a
`scene` body's conditions — so neither word is reserved anywhere else.

### The `during` guard

**`during SCENE` is accepted on every hook form** (decided): phase rules,
rulebook contributions, event handlers, change handlers, and relation
add/remove handlers. It sits after the head (action/selector, rulebook name,
event name, or change/add/remove clause), before any `when` guard or the
colon:

```lamp
before any except attack except shoot during commando_fight:
    ...

instead push during guard_meeting when self.target == launch_button:
    ...

rule every_turn_rules during guard_meeting:
    # the interjections roll

on person.holder change during commando_fight:
    # movement mid-fight

on wears add during guard_meeting:
    # donning gear in front of the guard
```

`during SCENE` is sugar for gating the body on `SCENE.active` — for a rule, a
conjunct in its guard; for a handler, an implicit enclosing check — nothing
more. It buys compile-time checking of the scene name (collected in the
prescan, like rulebook names) and a declarative surface that reads as stage
direction, uniformly wherever behavior attaches. `SCENE.active` remains valid
in any expression for conditions that don't fit a hook head. The one exclusion
is conditional function **overloads**: their `when` guards are a
specificity-dispatch mechanism, not behavior hooks, and stay as they are.

### When transitions are evaluated

Declared conditions are evaluated at **one point in the turn cycle**: after
`every_turn_rules`, before `check_light_transition`, in advent's command loop —

```
run_command → every_turn_rules → evaluate_scenes → check_light_transition
```

— so daemons that latch state (the doom clock, the PA, `guard_allied = true`)
are seen the same turn. One additional evaluation runs at startup, after the
player is placed (with `dispatch started`), so a scene whose begins-condition
holds at the start of play is active before the first prompt.

The evaluation pass:

1. For each **active** scene: if any `ends when` condition is true, end it
   (flip, dispatch `_ends`).
2. For each **inactive** scene with declared begins-conditions, where
   `recurring or not happened`: if any `begins when` condition is true, begin
   it (flip, set `happened`, dispatch `_begins`).
3. If any transition fired, repeat — so a scene chained via an edge atom
   (`begins when A ends`) starts the same turn its predecessor ends. The loop
   is capped at a **fixed 16 iterations** (decided; not configurable) —
   exceeding it is a runtime error naming the scenes that were still flipping.
   A cycle of mutually-triggering scenes is an authoring bug surfaced loudly,
   not an infinite hang, and a legitimate same-turn chain 16 scenes deep does
   not plausibly exist.

Evaluation order within a pass is declaration order (author file first, then
libraries, like rule registration) — documented and stable.

**Story end:** when `story` leaves `ongoing`, every active scene is ended (end
events fire, in declaration order) before `end_story_rules` runs — a scene
never outlives the story, and an end hook may contribute to the closing text.

**Out-of-world verbs and parse failures** spend no turn, so no evaluation runs
— consistent with every_turn_rules.

### Bare-sys games

Scenes are engine machinery (registry + `evaluate_scenes`), not advent-specific
— a bare-sys game with its own loop calls `evaluate_scenes()` wherever its turn
boundary is. advent wires it in for the standard loop.

## Worked example — the Phobos guard arc

Today (guard_persuasion.lamp / guard_endgame.lamp / interjections.lamp /
control_room.lamp), the arc is carried by `met_guard`, `guard_allied`,
`commando_started`, and compound guards repeating in seven places. With scenes:

```lamp
scene guard_meeting:
    begins when disguised() and holder(player) == Control_Room and holder(guard) == Control_Room and not guard_allied
    ends when guard_allied or not (holder(guard) == Control_Room)

on guard_meeting_begins:
    print "[par]The guard looks up as Galaxy enters, and makes a gesture of greeting."
    g_say("Hey, !NB563FFAA, didn't expect to see you here. …")

rule every_turn_rules during guard_meeting:
    # interjections: the 1-in-3 roll over the unspoken deck
    ...

instead push during guard_meeting when self.target == launch_button:
    # reaching for a button mid-meeting blows Galaxy's cover
    ...

scene commando_fight:
    begins when self_destruct_in_progress and guard_allied and holder(player) == Control_Room and holder(guard) == Control_Room
    ends when commandos_down()

before any except attack except shoot during commando_fight:
    # distracted → shot
    ...
```

What falls away: `met_guard` (→ `guard_meeting.happened`), `commando_started`
(→ `commando_fight.happened`), the burst-in `every_turn_rules` contribution
(→ the begin hook), the finale call inside `down_commando` (→ the end hook),
and every re-derivation of the compound conditions (→ `during`). The
KIM-adhered mode uses the imperative form: `adhere_kim` calls
`begin_scene(kim_hacking)`, `detach_kim` calls `end_scene(kim_hacking)`, and
the five copies of `kim_adhered_to == none or not (holder(player) ==
kim_hack_room)` become `during kim_hacking` (leaving the room detaches the KIM
via the existing `before go` rule, which ends the scene in the same motion).

Timing check (fidelity matters for a phobos_ex adoption): the greeting today
prints from an `after go` rule, i.e. after the room description within the go
action's turn; as a begin hook it prints at the turn's scene pass — still after
the room description, before the next prompt. Same visible order. The burst-in
fires today from `every_turn_rules`; the begin hook fires in the pass right
after `every_turn_rules` — same turn, same position relative to the action's
output.

## Required language/runtime support

1. **Parser/AST:** the `scene NAME:` declaration (contextual `begins when` /
   `ends when` / `recurring` body lines, with the `SCENE begins`/`SCENE ends`
   edge atoms valid inside the conditions); `during SCENE` in every hook head —
   phase rules, `rule` contributions, `on EVENT`, `on TYPE.FIELD change`,
   `on REL add/remove` (position: after the head, before `when`/the colon).
   Prescan collects scene names for `during` and edge-atom validation.
2. **Checker:** scene-body conditions checked as global-scope bool expressions
   (no params/locals/self — the conditional-overload guard restrictions);
   unknown scene in `during` or an edge atom is a compile error; duplicate
   scene name likewise; **assignment to a `scene` built-in field
   (`active`/`happened`/`recurring`) is a compile error** naming
   `begin_scene`/`end_scene` as the intended surface.
3. **Emitter:** a scene declaration emits the singleton object (type `scene`)
   plus `registerScene(name, [beginsFns], [endsFns])` with the conditions
   compiled to thunks (edge atoms compile to runtime edge-flag reads);
   `during X` emits the `X.active` gate.
4. **Runtime:** the `scene` built-in type (bootstrapped like `action`); the
   scene registry; per-scene transient edge flags (set on any transition,
   cleared when the evaluation pass completes; never persisted);
   `evaluateScenes()` (the fixpoint pass, fixed cap 16, dispatching events);
   `beginScene`/`endScene`; story-end sweep. Exposed to Lamp via lib/sys
   natives `evaluate_scenes()`, `begin_scene(scene)`, `end_scene(scene)`.
5. **lib/advent:** call `evaluate_scenes()` after `follow every_turn_rules()`
   and once post-placement at startup; the story-end sweep before
   `end_story_rules`.
6. **Persistence:** nothing — `active`/`happened` are instance fields on a
   named singleton, captured by the instances provider today.

## Staged roadmap

- **Slice 1 — core:** type, declaration, declared transitions (including the
  edge atoms), events, `begin_scene`/`end_scene`, the field-write compile
  error, loop integration, startup evaluation, story-end sweep. Goldens: a
  condition-latched scene (begin/end hooks, `happened`, non-recurrence), a
  recurring scene, an imperative scene, an edge-chained scene (same-turn
  succession, correct against a recurring predecessor), undo-across-a-
  transition, and the write-forbid compile error.
- **Slice 2 — `during`:** the guard on every hook form (phase rules, `rule`
  contributions, event/change/relation handlers), with compile-checked names.
  Golden: `during`-guarded hooks activating/deactivating.
- **Slice 3 — phobos_ex adoption:** the worked example above (guard_meeting,
  commando_fight, kim_hacking), keeping the endgame golden byte-identical.
  This is the fidelity proof, as with §1 and §4 of the gaps audit.
- **Deferred:** everything under Non-goals, revisited on demand.

## Assumptions

- Scene conditions are cheap, pure reads; the fixpoint pass may evaluate them
  several times per turn.
- One evaluation point per turn is enough. Mid-turn mode flips that rules in
  the *same* turn must observe use the imperative form (which is immediate) —
  the KIM case; Phobos needed nothing finer.
- Event handlers (`on NAME_begins:`) print into the normal output stream at the
  point they fire; no special output buffering.
- The `scene` type name is claimable as a built-in without breaking existing
  code (no repo game declares a `scene` type or object today — verified).

## Non-goals

- **Named endings** (I7's "ends happily / ends in disgrace"): Phobos carries
  ending flavor in `ending_override`; a game can branch its end hook on world
  state. Add only when a real port needs the dispatch.
- **Scene-relative time** ("has been happening for N turns"): expressible as a
  turn-counter global incremented by a `rule every_turn_rules during X:`; a
  built-in `turns_active` field can come later without design impact.
- **Derived (`active when`) scenes** — continuously-computed, unlatched
  activity: that is a named predicate, not a period with entry/exit; use a
  function. Revisit if edge-triggered hooks on derived conditions turn out to
  be wanted.
- **Exclusivity/priorities** between scenes: scenes are independent; any set
  may be active at once.

## Resolved decisions (2026-07-17)

Four questions were put to the author and decided; the design body above
incorporates them:

1. **Direct assignment to scene fields is a compile error** (not convention) —
   see "Scene fields are read-only to game code".
2. **The edge-event form is in** — the `SCENE begins`/`SCENE ends` condition
   atoms, see "Edge atoms".
3. **`during` is accepted everywhere** behavior attaches — phase rules,
   rulebook contributions, and event/change/relation handlers; only
   conditional-overload guards are excluded.
4. **The fixpoint cap is a fixed 16**, not configurable.

## Open Questions

- Where exactly do scene end-events land relative to `end_story_rules` output
  when the story ends mid-action (e.g. the doom clock) — before the `[par]`
  separator or after? Decide during implementation against the countdown
  golden.
