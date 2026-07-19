# Phobos Ergonomics Audit — Language-Feature Candidates

> Status: analysis, 2026-07-16. A pattern audit of the complete Phobos port
> (`sample/phobos`, all 21 `.lamp` files, ~3,600 lines) against the current
> language surface (`devdocs/specs.md`), looking for recurring IF authoring
> patterns the game codes by hand that Lamp could internalize. Findings are
> ranked by how much duplication each feature would remove. Summarized in
> `TODO.md` → "Design (not scheduled)" → "Phobos ergonomics audit".

## Purpose and framing

The prompt for the audit was "would rulebooks obviate long if-chains?" — and the
headline finding is that the rulebook/band system has **already absorbed** most
of what Inform uses rulebooks for. Phobos's remaining if-chains are mostly not
missing *rules* but missing **data structures**, **object-scoped dispatch**, and
**scenes**.

Scope note: the subject is `sample/phobos` (not `phobos_ex`), which is the
frozen 1:1 fidelity artifact. Some duplication there is deliberate faithfulness
to the I7 original; any feature adoption would land in advent/Lamp generally and
be exercised in `phobos_ex` or future games rather than churning the port.

Doc-drift caveat found along the way: `devdocs/rulebooks.md`'s status header
still says "not yet implemented" and "not yet described in specs.md", but
rulebooks, action rulebooks, `[one of]`/`pick` modes, and the `is` operator are
all implemented and specified. The stale headers should be updated.

## 1. Subtype field re-defaults + a "this object" reference in field templates

> **Status: BUILT (2026-07-16).** Both halves shipped and applied to phobos_ex.
> Subtype re-defaults turned out to already work end-to-end (the runtime's
> `collectAuthorDefaults` merges nearest-definition-wins; the checker only
> blocked same-type reopen redeclaration) — hardened with a same-type guard on
> re-declared inherited fields (`redefault_badtype` golden). Declaration-site
> `self` was the real gap: the emitter now emits a `selfTemplate(id)` marker for
> a self-capturing field template, and `createObject` binds it per instance
> (`selffield1` golden; persistence verified across undo/save). Docs: specs.md
> "Type inheritance" + "Declaration-site `self`", text-persistence.md.
> Applied in `sample/phobos_ex` only (`scanner_door`, `wall_sign`,
> `handprint_scanner`, `sleeping_pods` subtypes) — behavior verified identical
> to `sample/phobos` by transcript diff; the frozen port keeps the duplication.

**The single biggest source of duplication.** `lib/phobos/scenery.lamp:14`
states the gap outright: *"advent type bodies can't default inherited fields,
so the shared sign fields are repeated per object."* Consequences:

- Six doors (`base.lamp:140-199`), each repeating the same four text fields
  (`description`, `feels`, `take_refusal`, `attack_refusal`) verbatim except
  for a color word.
- Seven signs, six handprint scanners, and two sleeping pods
  (`scenery.lamp`) with identical `feels`/`take_refusal`/`description` bodies.

Two features are needed **together**:

1. Let a subtype re-default inherited fields:

   ```lamp
   type scanner_door < door:
       feels = "The door is smooth cold metal."
       ...
   ```

2. A way for shared default text to refer to the instance — e.g.
   `[if self.closed]closed[else]open[end]` or `[the self]`. Shared default
   prose today has no way to name "whichever object I'm on", which is exactly
   why each door spells out `[if green_door.closed]…` by name.

   **`self` is the right word, not a new `this`.** Type bodies and rule bodies
   are disjoint contexts, and the language already binds `self`
   context-polymorphically to "the instance the enclosing declaration is
   about": the action instance in phase rules, the changed instance in change
   handlers, and the relation edge in add/remove handlers
   (`src/lantern/checker.js` binds each). A field-default template binding
   `self` to the owning object is a fourth instance of the same convention —
   no new reserved word (`self` isn't globally reserved; it's injected per
   scope). The one real design constraint is rendering scope, not parsing:
   templates render lazily, so when a rule prints `[self.target.description]`
   and that description template itself contains `[if self.closed]`, each
   template must bind its **own** `self` (the inner one to the owning object,
   not inherited dynamically from the enclosing render). The persistable-
   template model (`{$tmpl:id,env}`, captured environment per template)
   already provides exactly this — the field template captures its owner in
   `env`.

This pair would collapse roughly 200 lines of Phobos into four short type
declarations.

## 2. Object-scoped rules

> **Status: BUILT (2026-07-18) — body-nested form.** The author chose
> body-nesting over header sugar (the recorded open question): a phase rule
> inside a type/object body is implicitly guarded on the action's `direct`
> slot (`is` the type / `==` the object), composing with `during`/`when`;
> selectors stay top-level; an action without a direct slot is a compile
> error. Goldens `scoped1`/`scoped_nodirect`; surface in specs.md
> "Body-nested rules". Applied in phobos_ex: the commando type body absorbed
> the attack/shoot/touch/take/drop rule pairs (per-object bodies merged via
> `self.taken`/`self.dropped`), the sleeping_pods type body the enter/open
> refusals — combat-variant transcripts diff-identical to sample/phobos.
> Header sugar (object lists / typed bindings) deferred until a real need.

About 60 rules in the port have the shape
`instead VERB when self.target == some_object`. Workable, but it forces pure
duplication whenever two objects need the same behavior:

- Commando pairs in `guard_endgame.lamp` — take/attack/shoot/touch/drop each
  written twice, once per commando (e.g. lines 158-169, 188-199, 229-234,
  243-268, 270-281).
- The two sleeping pods' four identical refusal rules
  (`scenery.lamp:115-126`).
- The doff pair (`guard_persuasion.lamp:267-274`).
- The five-door disjunction (`guard_endgame.lamp:210`:
  `when self.target == green_door or self.target == yellow_door or …`).

Two complementary ideas, both consistent with Lamp's explicit-ordering
philosophy:

- **Phase rules inside an object or type body**, with the target guard
  implied — `instead attack:` inside `commando`'s type body meaning
  `when self.target is commando`. Matches how IF authors think ("the locker's
  behavior lives with the locker") and would let `hacking.lamp`'s five
  per-door `instead hack` rules move into the door declarations.
- **Richer rule-header targets** as sugar for the equality/`is` guard:
  `instead shoot green_door, yellow_door, …:` or
  `instead attack (commando c):`.

## 3. Static data tables / map literals

> **Status: list + map tiers BUILT (2026-07-18); `const` remains.** List
> literals (nested included) are now legal global initializers, with implicit
> line joining inside brackets for multi-line tables and object-name elements
> resolved against the declared element type (golden `listglobal1`; specs.md
> "List-literal initializers"). Applied in phobos_ex: the keypad flip-sets
> (two `list<list<int>>` tables replacing the twin nine-branch if-chains),
> `ranks`, `pa_messages`, the interjection narration/speech tables (the
> `pa_message`/`interjection` functions deleted), and the
> `pa_order`/`interj_order`/`scan_levels` initializers (their startup_rules
> fills dropped) — endgame golden byte-identical, eight hand-test transcripts
> identical. **Map tier** (same day): `map<K, V>` globals with `{key: value}`
> literals — object/string/number keys typed against K, function-typed values
> emitting the (compile-checked) functions themselves, shared list/map
> index-read/write runtime path, missing key → none, undo/save capture
> (golden `mapglobal1`; specs.md "Map-literal initializers"). Applied in
> phobos_ex: the KIM's four per-target tables (`kim_surfaces`/`kim_blurbs`/
> `kim_show`/`kim_ranges`) replaced the three parallel five-way if-chains in
> `kim_surface_name`/`kim_state`/`press_bad_digit` — nine-transcript battery
> identical. Remaining from this item: **`const`** (snapshot exemption +
> immutability enforcement), on demand.

The closest thing to Inform's Tables that Phobos actually misses. Lookup tables
are encoded as if-chains throughout:

- Keypad flip-sets — `if self.n == 1: flip = [1]`, nine branches, twice
  (`hacking.lamp:379-397` and `419-438`). Begging to be a list-of-lists
  constant: `let flips = [[1], [2,3], [3,4], …]`.
- `kim_surface_name` (`hacking.lamp:39-50`), `kim_state` (`97-112`), and
  `reset_keypad` (`293-324`) — three parallel if-chains keyed on the same five
  hack targets. This is a per-target record (surface name, keypad renderer,
  reset state) split across three functions; a map — or fields on the target
  objects — would unify it.
- `pa_message` (`pa_broadcasts.lamp:26-51`), `interjection`
  (`interjections.lamp:28-49`), and `rank_name` (`scoring.lamp:37-56`) — pure
  int→string tables written as functions.

The conversation library deliberately avoided a table primitive (subjects carry
their own reply data — object fields worked there). The minimal version here is
not Inform tables: it is **const list/map literals legal at global scope**.
Today every list global is `= none` and filled in `startup_rules`, which is why
static data gravitates into function if-chains.

## 4. List predicates in lib/sys

> **Status: BUILT (2026-07-16).** `includes(xs, v)`, `count_of(xs, v)`,
> `all_true(xs)`, `any_true(xs)` — pure Lamp in `lib/sys/functions.lamp` over
> the open `list<object>`/`object` generics (golden `listpred1`; specs.md lists
> them with the other sys functions). Two naming forced deviations from the
> sketch below: `contains` is the world-model containment relation (hence
> `includes`), and lib/sys locals are `sys_`-prefixed because the no-shadowing
> rule would otherwise fail any game declaring a global `n`/`x` (four fixtures
> do). Known caveat: a bare string literal as the sought value reads as an
> object name (the language-wide object-position dispatch) — let-bind it first.
> Applied in `sample/phobos_ex` (hacking.lamp, linguistics.lamp): the eight
> hand-rolled predicates below became one-liners (`in_control_parts` deleted
> outright in favor of `includes`); behavior verified identical against
> `sample/phobos` by a keypad/RESET transcript diff, endgame golden
> byte-invariant. The frozen port keeps its loops.

`lib/sys` has `append`, `shuffle`, and `map_strings`, but no `contains`, `any`,
`all`, or `count`. So `hacking.lamp` hand-rolls seven index-loop predicates —
`nine_solved`, `nine_all_red`, `nine_at_red_start`, `four_solved`,
`purple_solved`, `lit_count`, `in_control_parts` — plus `fully_scanned` in
`linguistics.lamp`. With helpers these become `all(nine_buttons)`,
`count(sixteen_buttons, true) == 5`, `contains(control_parts, n)`.

Cheap to add (they can be pure Lamp in lib/sys, per the established JS→Lamp
direction), and high-frequency in any puzzle-heavy game.

## 5. Scenes

> **Status: ALL SLICES BUILT (2026-07-17).** Full design in
> **`devdocs/scenes.md`**: a scene is a singleton object of a built-in `scene`
> type (`active`/`happened`/`recurring` fields — persistence free via the
> instances provider), declared `begins when`/`ends when` conditions evaluated
> at one turn-cycle point (fixpoint, ends-before-begins), name-based
> `<scene>_begins`/`<scene>_ends` events as hooks, imperative
> `begin_scene`/`end_scene` for action-anchored modes (the KIM), and a
> `during SCENE` rule-header guard. Includes the worked Phobos guard-arc
> mapping and a three-slice roadmap ending in phobos_ex adoption. Slice 1 (the
> core mechanism), Slice 2 (`during SCENE` on every hook form), and Slice 3
> (phobos_ex adoption: kim_hacking, commando_fight, guard_meeting) all shipped
> 2026-07-17. Goldens `scene1`-`scene4` + error goldens; surface in specs.md
> "Scenes"; adoption findings (which consumers kept live guards, and why) in
> scenes.md. Endgame golden byte-identical; hand-test transcripts identical.

The strongest **structural** candidate. Phobos's dramatic arc is a chain of
modes — KIM-adhered, guard meeting, guard leading (out and back), commando
fight — each represented as a lattice of global bools (`kim_adhered_to`,
`met_guard`, `guard_pleased`, `guard_allied`, `self_destruct_pushed`,
`self_destruct_in_progress`, `commando_started`) whose *combinations* are
re-derived in every participating rule. The same compound guard appears again
and again:

- `kim_adhered_to == none or not (holder(player) == kim_hack_room)` — five
  times in `hacking.lamp` (72, 89, 263, 294, 365).
- `met_guard and not guard_allied and holder(player) == Control_Room and
  holder(guard) == Control_Room` — the meeting scene, spelled out in
  `interjections.lamp:54`, `guard_persuasion.lamp:134`,
  `control_room.lamp:24-31`, and elsewhere.

An Inform-style `scene` — declared begin/end conditions, a `during SCENE` guard
usable on any rule, and entry/exit rule hooks — would name each mode once and
turn the twelve-way conjunctions into `during guard_meeting`. It composes
naturally with the existing machinery: a scene is roughly a named,
auto-evaluated bool with every-turn transition hooks, so it can sit on
`every_turn_rules`. (Interaction to design for: scene state must be captured by
a state provider so it survives undo/save — same requirement text-substitution
cursors had.)

## 6. Timed events

Already tracked under Parser v2 ("timed/scheduled events"); the audit adds two
concrete motivating cases beyond the doom-clock:

- The loyalty question's **one-turn answer window**, hand-built as an
  `asked_about_loyalty` → `asked_about_loyalty_last_turn` shift register
  (`guard_persuasion.lamp:44-47`, `126-128`).
- The suit's `powered_this_turn` **skip-one-turn flag** for auto-power-down
  (`suit.lamp:16-17`, `73-79`).

Both are "this expires after N turns" — an
`in 1 turn: asked_about_loyalty = false` scheduler would delete both idioms.

## 7. Regions

Per-room wall/floor/ceiling material text repeats across room groups in
`backdrops.lamp:33-53` (rough stone ×3 rooms, white tile ×2), and
`scenery.lamp:147` already notes the PA backdrop over-reaches "until
region-scoped backdrops land". Regions (named room groups) would provide:

- Region-scoped backdrops (the PA system, and I7's original indoor-only
  confinement).
- Per-region field defaults (the material-text table shrinks to one entry per
  region).
- A region test replacing the recurring `not (holder(player) == Passage_End)`
  "inside the base" guard in `countdown.lamp` and `pa_broadcasts.lamp`.

## 8. Optional action slots

`fly` and `fly_thing` (`flight_deck.lamp:63-108`) are two separate actions
purely because an unfilled slot can't read as `none` — the file's own comment
(63-66) says so. An optional-slot marker (bare syntax leaves the slot `none`)
would merge them, and generalizes to any verb with an implied noun.

## 9. NPC movement helper (+ route-finding)

The guard-leading sequences hand-move the guard room by room and hand-write
each "The Siriusian guard goes south." line (`guard_endgame.lamp:44-100`, two
rules of four branches each). An advent `npc_go(npc, direction)` that consults
the map, moves the NPC, and prints the locale movement message (visible only
when witnessed) is the classic IF facility; a `route_to(npc, room)` pathfinder
(Inform's "best route") is the natural follow-on that would reduce each leading
rule to one line.

## 10. Once-only shuffled deck

`pa_broadcasts.lamp:15-24` and `interjections.lamp:16-24` each maintain an
`order`/`next`/`tick` global triple to deal messages at most once in random
order. The `pick(list, …)` substitution modes already implement cursor
semantics internally; exposing a "shuffled, exhausting" mode (deal each element
once, then report exhaustion) over author-owned lists would absorb both — the
1-in-N chance gating and the debug-determinism switch stay game code.

## Honorable mentions

- **Free-text topic patterns for SAY** — `is_human_claim`'s eight equality
  tests (`guard_persuasion.lamp:52-67`) could reuse `understand`-style
  alternation syntax against string topics
  (`topic "i am human/i'm human/human/…"`).
- **Auto-created singletons beyond stop reasons** — `pleased_by` is a
  stringly-typed enum (`"pistol"`, `"log"`, `"chocolate"`,
  `"pistol_dropped"`) branched on in `guard_ally`
  (`guard_persuasion.lamp:241-248`); the compile-checked auto-created-object
  mechanism `stop_reason` already has would catch typos and compare by
  identity.
- **Derived predicates in guards** — the disguise conjunction
  `wears player cyberhelmet and wears player cybercarapace` is repeated ~6
  times (`hacking.lamp:204`, `guard_persuasion.lamp:107/135`,
  `cyborg.lamp:37-59`, `countdown.lamp:56`). Functions already work in `when`
  guards, so this is authoring style, but an Inform-style "Definition:"
  adjective (`define disguised: …`) would encourage naming it.

## What Lamp already covers well

For contrast, patterns the audit found **fully served** by existing features:
the six-band action pipeline with typed stop reasons (the scan/check chains in
`linguistics.lamp` are clean); action selectors (`before any except attack
except shoot`, `guard_endgame.lamp:123`, maps Inform's "doing something other
than" directly); contributed rules ordering (author file preempts library —
used deliberately in `phobos.lamp` for headings/endings); `[first time]…[only]`
and the `pick` variation modes; relations (`wears`, `part_of`); and the `is`
type test.

## Recommended order

1. ~~**Subtype field re-defaults + `self` in field templates** (§1)~~ —
   **DONE (2026-07-16)**, see §1's status note.
2. ~~**Object-scoped rules** (§2)~~ — **BUILT (2026-07-18)**, body-nested
   form; see §2's status note.
3. **Static data tables** (§3) — **list + map tiers BUILT (2026-07-18)**;
   `const` remains, on demand.
3. ~~**lib/sys list predicates** (§4)~~ — **DONE (2026-07-16)**, see §4's
   status note.
4. ~~**Scenes** (§5)~~ — designed & **ALL SLICES BUILT (2026-07-17)**:
   `devdocs/scenes.md` (incl. the Slice 3 adoption findings).

## Open Questions

- Should object-scoped rules (§2) be body-nested phase rules, header sugar, or
  both? Body-nesting changes rule-collection order semantics (what "author
  order" means for a rule declared inside a library object).
- Const list/map literals (§3): full `map<K,V>` type, or just allow list
  literals as global initializers plus a lightweight record-per-object idiom?
- Scenes (§5): are they sugar over `every_turn_rules` + a state-provider-backed
  bool, or a first-class construct with compile-time `during` validation?
- Deck mode (§10): expose the substitution cursor state over author lists, or
  a separate stdlib type?
