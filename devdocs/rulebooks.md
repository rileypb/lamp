# Rules and Rulebooks

> Status: design proposal. Not yet implemented. This document defines the
> rule/rulebook mechanism that underlies action processing and other ordered,
> decision-making pipelines in Lamp. The action pipeline in
> `devdocs/game_parser.md` is the primary client and motivating use case.

Source-of-truth note: rulebooks are not yet described in `devdocs/specs.md`; this
document proposes them. The design builds on existing language features — kinds
and enums, events, conditional overloads and specificity (`devdocs/specs.md`,
`devdocs/specificity.md`), and the `stop` statement introduced for the parser —
and calls out the new language/runtime support each part needs rather than
assuming it.

The design deliberately diverges from Inform 7's rulebooks in three places —
explicit ordering instead of inferred specificity, typed outcomes instead of a
success/failure side-channel, and compile-time-static assembly instead of runtime
mutation. Each divergence is justified inline. The motivation for them is the
critique recorded in the parser discussion: Inform's implicit ordering and
overloaded "rule succeeds/fails" are its least predictable features, and Lamp's
explicit, typed character lets it do better.

## Purpose

A **rulebook** is an ordered, typed, short-circuiting decision pipeline: an
ordered set of **rules**, each with an optional applicability guard, that runs in
sequence until a rule decides the outcome. Rulebooks provide three things a plain
function does not:

- **Extend-without-modify.** A library adds a rule to an existing rulebook
  without editing it — the basis for a parser/standard-rules ecosystem.
- **Typed outcomes.** A rulebook yields a value of a declared type; "the action
  failed" is just one such value, not a special mechanism.
- **Predictable ordering.** Rule order is explicit and resolved at compile time,
  so behavior does not depend on hidden heuristics or load order.

## Boundaries

- **In scope:** the rule/rulebook model, outcomes and `stop`, applicability,
  ordering, rule identity, the relationship to events and overloads, and the
  built-in action rulebook.
- **Out of scope:** the parser stages that build an action
  (`devdocs/game_parser.md`), the turn cycle and time, and the content of any
  particular standard rule set.
- **Non-goals:** runtime mutation of rulebooks (deliberately omitted — see
  *Static assembly* below), and a general aspect/advice system beyond ordered
  rules.

## Inputs and outputs

- **Input:** a rulebook's declared result type and default, its rules (each with
  an optional `when` guard, optional name, and optional ordering metadata), and,
  for parameterised rulebooks, the basis value(s) the rulebook runs against.
- **Output:** a single value of the rulebook's result type — the value carried by
  the first rule to `stop`, or the declared default if every applicable rule
  falls through.

## The unified model

A **rule** runs its body and then either:

- **falls through** — control passes to the next rule (this is the default, and
  the safe one: doing work never implicitly ends the rulebook); or
- **stops** — `stop` (no value) or `stop EXPR` ends the rulebook immediately,
  yielding `EXPR` as its value.

A **rulebook** declares a **result type** `T` and an ordered set of rules.
Running it means: run each applicable rule in order until one `stop`s; the
rulebook's value is that rule's `stop` value, or the rulebook's **declared
default** if all applicable rules fall through.

```
rulebook T NAME(BASIS):
    default DEFAULT_EXPR        # required unless T is void or a catch-all exists
```

- A rulebook is invoked with the `follow` keyword — `follow NAME(args)` — which
  marks the call as a rulebook invocation (never confused with a function call)
  and yields the result value. The concrete surface is specified in
  `devdocs/specs.md`, Rulebooks.
- `stop EXPR` is type-checked against `T`, exactly like a function `return`.
- A **non-void** rulebook must either declare a `default` or contain a catch-all
  rule (one with no guard that always stops). **Falling off the end of a non-void
  rulebook with no default is a compile-time error** — there is no implicit
  empty/zero value.
- A **void** rulebook (`T` = none) yields nothing; rules may use bare `stop` to
  halt remaining rules but carry no value.

### One mechanism, not two: success/failure *is* a return value

Inform conflates two axes onto one set of words: `rule succeeds` means both
"stop" and "outcome = success," and value-producing rulebooks use a separate
`decide on X`. Lamp keeps the two axes orthogonal — **continuation** (`stop` vs.
fall through) and **result** (the value `stop` carries, of the rulebook's
declared type) — so there is only one rule to learn.

Consequently, **action success/failure is not special**. It is the built-in kind

```lamp
kind outcome = enum(succeeded, failed)
```

An action phase rulebook simply has result type `outcome`, so `stop failed` is
`stop` carrying an `outcome` value. A rulebook that yields a `bool`, a `room`, or
any other type is the identical construct with a different `T`. There is no
"value-producing rulebook" as a separate concept.

**Messages are not outcomes.** Refusal text is printed, then the rule stops:

```lamp
check take:
    if self.taken.scenery:
        print "That's hardly portable."
        stop failed
```

Optional sugar `refuse "..."` may expand to exactly `print "..."` + `stop
failed`, but the primitive stays clean — `stop` never carries a string-as-message
(the overloading this design exists to avoid).

> **Refinement (implemented).** Printing refusal text *inside* the deciding rule
> glues the condition to the message, so retheming the message means restating the
> condition. The *Failure reasons and the `report failed` band* section below
> separates the two — `check` names a typed reason, a reporting band renders it —
> without weakening this principle: a reason is a typed value, not a string on
> `stop`.

### Applicability via `when`, not specificity

A rule may carry a `when` guard; it is applicable only when the guard is true.
Guards use the same condition forms as conditional overloads
(`devdocs/specs.md`, Conditional overloads).

**Rulebooks do not use specificity.** This is a deliberate divergence from both
Inform (which orders `instead`/`check` rules by inferred specificity) and from a
naive reuse of Lamp's overload-specificity. The reasons:

- Overload specificity picks **one** winner among definitions; a rulebook runs
  **all** applicable rules in order until one stops. The two are different jobs;
  reusing one number for both misleads.
- Lamp's specificity metric (`devdocs/specificity.md`) counts atomic conditions —
  a *syntactic* measure that does not track *semantic* targetedness. A
  single-object guard (`self.taken == lamp`, one atom) would rank as *less*
  specific than a two-atom environmental guard, inverting intuition.

So in a rulebook: **guards decide applicability, declared order decides sequence,
and `stop` decides who wins.** Three orthogonal, explicit things — no hidden
ordering. (Function overloads keep specificity unchanged; this rule is about
rulebooks only.)

### Rule identity

A rule may be **named**, and names are first-class — required for ordering,
override, and removal by other files. Anonymous rules cannot be referenced (so
they cannot be reordered or removed from elsewhere), which is fine for a game's
own rules but not for library extension points.

```lamp
check take (named cant_take_self):
    if self.taken.holder == self.actor:
        print "You already have that."
        stop failed
```

Rule names follow the object-name coercion convention (`cant_take_self` →
`cant take self`), consistent with named relation instances.

## Ordering

Rule order within a rulebook is resolved in three tiers, from least to most
ceremony. Most authoring never leaves tier 1.

1. **Source order (default).** Rules declared in one file run top-to-bottom.
   Intuitive, zero ceremony, and correct for the common case where an author
   keeps an action's rules together.
2. **Bands.** A rule may declare a coarse position — `first` / `last`, or a named
   sub-band — so libraries agree on *band names* rather than on each other's rule
   names. The action rulebook's six phases (below) are predefined bands.
3. **Group/anchor constraints.** A rule may carry a **group tag**, and a rulebook
   may declare ordering constraints between groups: `order ...: groupA before
   groupB`. Depending on a tag that many rules share is looser coupling than
   Inform's "listed before the *Bar* rule," which hard-references one rule in
   code you may not own. Inform-style ordering against a specific named rule
   remains available as a last-resort escape hatch.

Because rulebooks are assembled at compile time (below), ordering is a
compile-time computation:

- The compiler **topologically sorts** rules from the declared constraints and
  **errors on cycles** (`A before B before A`).
- Because order is never silently inferred from specificity, the compiler can
  **warn when two rules' relative order is observable but unspecified** — both
  applicable, order affects behavior, nothing pins it. Surfacing this (rather
  than hiding it under a heuristic, as Inform does) is the single biggest
  reliability win and protects the golden-test suite from churn.

Cross-file ordering (tiers 2–3) is an ecosystem feature; see Roadmap.

## Static assembly

Rulebooks are **assembled at compile time and fixed at runtime.** Inform shipped
runtime rulebook mutation (procedural rules: "ignore the X rule"), found it
unpredictable, and removed it. Lamp adopts the lesson up front: all rules,
guards, and ordering are known to Lantern, which emits a settled, ordered rule
list per rulebook. Runtime insertion/removal is a non-goal unless a concrete need
appears.

## The built-in action rulebook

Each action type (`action take:` — see `devdocs/game_parser.md`) has **one**
built-in rulebook with result type `outcome` and default `succeeded`, organised
into six predefined **bands** that run in order:

| Band | Convention | Typical `stop` |
|---|---|---|
| `before` | setup / side effects that precede everything | rarely stops |
| `instead` | replace the normal behaviour for specific cases | `stop failed` / `stop succeeded` |
| `check` | validate preconditions (accessibility, state) | `stop failed` on refusal |
| `do` | perform the world change | usually falls through |
| `after` | react to a successful change | `stop succeeded` to suppress report |
| `report` | print the result | rarely stops |

Authors add rules with the leading-band form `BAND ACTION [when …]:`. Inside a
rule, `self` is the action instance, with its slots (`self.taken`, `self.actor`)
available.

**Outcome semantics are uniform across bands** — this resolves the per-phase
ambiguity flagged in design discussion. The whole action is *one* rulebook; the
bands are organisational, not separate stop-scopes:

- Any rule's `stop failed` ends the entire action with `failed`; the `report
  failed` band then runs to print the reason. (See *Failure reasons and the
  `report failed` band*: the failing rule *names* a typed reason rather than
  printing inline.)
- Any rule's `stop succeeded` ends the entire action with `succeeded`, skipping
  all later bands (including `report`) — used by an `instead` rule that has fully
  handled and reported the case itself.
- Falling through every band ends the pipeline with the default `succeeded`. This
  is the normal path: `do` performs the change and falls through, `report`
  prints and falls through.

Two consequences worth noting because they fall out for free:

- `after`/`report` run only on a not-yet-failed action — because a `stop failed`
  in an earlier band exits before reaching them.
- There is **no implicit band-dependent auto-stop** (Inform stops the action by
  default when an `instead` or `after` rule fires). Here every stop is written.
  This is the explicitness-over-terseness trade the whole design makes: one extra
  line per replacing rule, in exchange for never wondering whether a rule fell
  through.

### Worked example

```lamp
action take:
    item taken
    syntax:
        "take [taken]"
        "get [taken]"

instead take when self.taken == excalibur:
    print "The sword will not yield to the unworthy."
    stop failed

check take:
    if self.taken.holder == self.actor:
        print "You already have that."
        stop failed

do take:
    self.taken.holder = self.actor

report take:
    print "Taken."
```

`> take excalibur` → `instead` rule applies, prints, `stop failed`; check/do/
report never run; action outcome `failed`.

`> take lamp` → `instead` no match (falls through) → `check` no match (falls
through) → `do` moves the lamp (falls through) → `report` prints "Taken." →
pipeline ends, outcome `succeeded`.

## Failure reasons and the `report failed` band

> Status: implemented. Typed reasons (`stop failed REASON`), the implicit
> `reason` slot, the `report failed` band, and **cross-rule override
> suppression** (an author rule shadowing a library one) all work — exercised by
> `sample/study.lamp`, `sample/study_advent.lamp`, and
> `tests/fixtures/advent6.lamp`/`advent7.lamp`. Within a band, author rules run
> before library rules and a bare `stop` halts the band (see *Cross-rule override
> suppression*).

### Problem

In the implemented model a `check` rule both *decides* a refusal and *prints* its
text inline:

```lamp
check take:
    if self.taken.scenery:
        print "That's not something you can take."
        stop failed
```

Condition and message are glued together. An author who wants to retheme only the
message must restate the condition in a higher-priority `check` rule — duplicated
logic that drifts out of sync with the library. Routing refusal text through
overridable rules (the point of the band system) requires separating the two.

Note this is a refusal-text problem specifically. *Context-dependent* responses —
text that varies by object, actor, or world state — are already handled by the
rulebook itself: an author adds a higher-priority rule that computes the text and
stops. The mechanism below is for the **standard, condition-keyed** refusal text
the library ships, so that it too becomes overridable without duplicating the
condition. Modelling such text as overridable *data* (global message variables or
a string-keyed map) was rejected: it cannot express context-dependence and pushes
authors toward mutating globals before each print — and a string-keyed map also
sacrifices the compile-time key checking enums give.

### Design: typed reasons, text in a reporting band

Split the two axes the way the rest of the model already splits continuation from
result:

- A `check` rule names *why* it refused — a typed **reason** — and stops. It
  prints nothing.
- A dedicated **`report failed` band** renders the reason to text. It is the
  failure-path mirror of `report`, overridable exactly like any other rule.

This stays faithful to **"messages are not outcomes"**: `stop` still carries only
the `outcome` value; the reason is a separate typed value, not a string on
`stop`. Text is still merely printed — it has only moved from the deciding rule
to a reporting rule.

#### Reasons are an open `type`, not a closed `enum`

Lamp names a fixed set of values two ways (`lib/sys/kinds.lamp`): a **closed**
`kind X = enum(a, b, c)` (exhaustive, instantiated as labels — e.g. `outcome`),
and an **open** `type X` with bare instance declarations (extensible — e.g.
`article`, `direction`). Reasons use the **open** form:

```lamp
type stop_reason
stop_reason already_held
stop_reason cant_take
stop_reason not_held
stop_reason cant_go
```

Extensibility is the deciding factor. A game routinely refuses an action for a
reason the library never anticipated; with an open type the game declares another
value in its own file — `stop_reason too_heavy` — and uses it in its own
`check`/`report failed` rules, with no change to the library. A closed `enum`
would have to be *reopened* to add a member, which Lamp does not support (and
which would muddy exhaustiveness elsewhere). `outcome` stays a closed enum
precisely because it must never grow a third case; reasons are the opposite.

This still gives compile-time checking: `stop failed cant_taek` fails to resolve
the value, exactly as a misspelled enum label would. The cost is that reason
values are bare globals — two reasons cannot share a name — the same namespacing
limitation `article`/`direction` already have; see Open questions.

#### `stop failed REASON` threads the reason via a slot

When the program defines the magic `stop_reason` type, each action instance gains
an implicit `reason` slot of that type (the same way `outcome` is the magic
phase-rule result kind; programs without reasons are unaffected). `stop failed
REASON` is sugar for

```
self.reason = REASON
stop failed
```

so `stop`'s value type stays `outcome` — the reason rides on the action instance,
not on `stop`. With no reason given, `stop failed` leaves `reason` unset (a
generic refusal that a `report failed` rule can render with a catch-all branch).

#### The driver dispatches reporting by outcome

The six-band pipeline runs as today and yields an `outcome`. Reporting is then
dispatched on that outcome:

- `succeeded` → the `report` band (as today, in-pipeline).
- `failed` → the new `report failed` band, with `self.reason` available.

For success the `report` band still runs in-pipeline as the implemented model
describes; `report failed` runs as a post-outcome pass because `stop failed` ends
the pipeline immediately. That asymmetry is an implementation detail of the
driver, not of the authoring surface — an author writes two mirror bands. In both
report bands, rules run author-before-library and a bare `stop` halts the band
(see *Cross-rule override suppression*).

### Worked example

Library:

```lamp
type stop_reason
stop_reason already_held
stop_reason cant_take

check take:
    if self.taken.holder == self.actor:
        stop failed already_held

check take:
    if self.taken.scenery:
        stop failed cant_take

do take:
    self.taken.holder = self.actor

report take:
    print "Taken."

report failed take:
    if self.reason == already_held:
        print "You're already carrying that."
        stop
    if self.reason == cant_take:
        print "That's not something you can take."
        stop
```

**Context-dependent failure** — expressible because the band is a rule, not data.
Branch on the situation *before* the generic case, within a single rule:

```lamp
report failed take:
    if self.reason == cant_take and self.taken == sun:
        print "The sun is rather too far away to pick up."
        stop
    if self.reason == cant_take:
        print "That's not something you can take."
        stop
```

**Game-defined reason** — a game adds a reason and renders it in its own
`report failed` rule, with no library edit (the library's rule handles its own
reasons, the game's handles `too_sacred`). This is `tests/fixtures/advent6.lamp`:

```lamp
stop_reason too_sacred

check take when self.taken == idol:
    stop failed too_sacred

report failed take:
    if self.reason == too_sacred:
        print "The idol is too sacred to disturb."
        stop
```

Retheming an *existing* library reason by adding a *separate* `report failed`
rule that shadows the library's **works**: author rules run before library rules
within a band, and the author rule prints and bare-`stop`s to halt the band, so
the library's rule never runs. (Before this, the band was fire-all and both rules
printed.)

```lamp
# in the game — overrides advent's "That's not something you can take."
report failed take:
    if self.reason == cant_take_that:
        print "It won't come loose."
        stop          # halts the band; advent's rule is suppressed
```

### Cross-rule override suppression

A downstream rule can suppress a library rule's output in a `report` /
`report_failed` band. Two mechanisms combine:

1. **Bare-`stop`-halt.** A bare `stop` halts the band (it no longer merely
   early-exits its own rule body). The runtime distinguishes three rule results:
   an outcome value (`stop EXPR`) ends the pipeline with that outcome; the `HALT`
   sentinel (bare `stop`) halts the band keeping the current outcome; `undefined`
   (fall through) continues to the next rule. The value a bare `stop` yields is
   **decided**: in a report band the settled `outcome` is kept (the band is
   post-decision); in a non-void value rulebook it resolves to the rulebook's
   declared `default`. This **preserves the continuation/result orthogonality**
   the rest of this document is built on — bare `stop` is pure continuation and
   carries no outcome. (It also fixed a spec/impl mismatch: bare `stop` is
   specified to halt remaining rules, but previously emitted `return;` →
   `undefined`, i.e. fall through.)
2. **Author-before-library ordering.** Within a band, rules from the author's
   game file run before rules from imported libraries; source order is preserved
   within each tier. So an author rule gets first chance to print and halt.

This was chosen over two alternatives:

**Rejected: a three-valued `outcome` (`succeeded`/`failed`/`undecided`).** A
principled model (it is Inform's succeed/fail/no-decision), but it **re-merges
continuation with result** — the value would decide whether the rulebook
continues — which is exactly the conflation *One mechanism, not two* rejects. It
is also an awkward fit for print bands, where "halt this band" would have to be
written as an outcome value (`stop succeeded`/`stop failed`).

**Deferred but complementary: named-rule replacement.** Letting a rule *replace*
a named library rule is surgical for overrides and fits *Rule identity* (Named
rules). Worth adding later for cases ordering alone cannot express (e.g. replacing
one rule out of several without depending on registration order).

### Relationship to `refuse` sugar

The `refuse "..."` sugar sketched earlier (print + `stop failed`) is superseded
on the action path: refusal text now lives in `report failed`, so a check rule
refuses with `stop failed REASON`. A thinner `refuse REASON` sugar (= `stop
failed REASON`) may stand in its place; the string-carrying form is dropped, as
it would reintroduce the message-on-stop overloading the model rejects.

## Relationship to events and conditional overloads

Lamp will then have three dispatch mechanisms; they are distinct **by purpose**
and should not be collapsed casually:

- **Events** (`on EVENT:`, `dispatch`) — fire-all, unordered (registration order
  only), reactive, no outcome. "Broadcast: everyone interested reacts."
- **Change handlers** (`on TYPE.FIELD change:`) — a specialised reactive hook on
  field writes; also fire-all, no outcome.
- **Rulebooks** — ordered, typed, short-circuiting decision pipelines. "Run a
  decision to a single outcome."

The dividing line: events *notify*; rulebooks *decide*. An event has no answer to
"what happened" and cannot be stopped; a rulebook exists precisely to produce one
answer and to stop. Whether events should eventually be re-described as a
degenerate rulebook (void result, unordered, cannot stop) is an Open question;
for now they remain separate to avoid forcing one model onto two purposes.

## Required language/runtime support

1. **`stop` statement.** `stop` and `stop EXPR`, valid inside rule bodies;
   `EXPR` type-checked against the rulebook's result type (like `return`).
2. **Rulebook declaration.** Result type, `default`, and parameter/basis list;
   plus the built-in per-action rulebook with its six bands.
3. **First-class rule identity, bands, and ordering constraints.** Optional rule
   names, band membership, group tags, and `order` constraints.
4. **Compile-time assembly.** Lantern collects all rules for each rulebook across
   the compiled file set, topologically sorts by constraints, errors on cycles,
   and warns on observable-but-unspecified order.
5. **Built-in `outcome` kind** (`enum(succeeded, failed)`) and a queryable action
   outcome for the turn cycle.
6. **A rulebook driver** (native at first; see `devdocs/game_parser.md`,
   Engine architecture) that runs an ordered rule list, evaluates guards, and
   honours `stop`.

## Staged roadmap

- **Implemented — general rulebooks.** `rulebook T NAME(params):` with `default`
  and `when` rules, `stop EXPR`, `follow NAME(args)` invocation. Each rulebook
  compiles to a hoisted JS function; no runtime driver needed.
- **Implemented — action bands.** `action NAME:` with typed slots, the six
  phase-rule bands (`before/instead/check/do/after/report`) with `when` guards
  and `stop succeeded`/`stop failed`, `try ACTION:` invocation, the built-in
  `outcome` kind, and a small native action driver (`runAction`). Source-order
  rules within a band, with a coarse author-before-library tier (see *Cross-rule
  override suppression*); finer group/anchor ordering is not built. The implicit
  `actor` slot and the `syntax` grammar block are deferred to the Game Parser.
- **Implemented — failure reasons & reporting.** The open `stop_reason` type, the
  implicit `reason` slot, `stop failed REASON`, and the `report failed` band with
  outcome-dispatched reporting (see *Failure reasons and the `report failed`
  band*). Converts `check` refusals from inline prints to reason + reporting;
  advent's standard actions and `tests/fixtures/advent6.lamp` use it.
- **Implemented — cross-rule override suppression.** Bare `stop` halts the band
  (the `HALT` sentinel, distinct from fall-through; bare `stop` in a value
  rulebook yields the declared `default`) and author rules run before library
  rules within a band, so a game rule can print and suppress a library one (see
  *Cross-rule override suppression*). `tests/fixtures/advent7.lamp` and
  `sample/study_advent.lamp` exercise it.
- **Next — identity & ergonomics.** Named rules; named-rule *replacement*
  (suppression beyond what author-before-library ordering can express); `refuse
  REASON` sugar; the implicit `actor` slot defaulting to the player; `void`
  rulebooks.
- **Later — ecosystem ordering.** Bands beyond the action set, group tags and
  `order` constraints, compile-time topo-sort with the unspecified-order warning.

## Assumptions

- Action processing is the first and primary client; the model is designed so the
  action rulebook is just the built-in instance of the general construct, not a
  parallel system.
- The native rulebook driver and Lamp-declared rules are split per the parser's
  Engine architecture decision (mechanism native, rules declarative).

## Non-goals

- Runtime mutation of rulebooks (static assembly is intentional).
- Specificity-based or otherwise inferred rule ordering.
- A separate value-producing-rulebook concept (subsumed by typed result + `stop`).

## Open questions

- **Events as degenerate rulebooks?** Unify the three dispatch mechanisms behind
  one model later, or keep them separate by purpose?
- **Surface syntax** for rulebook declaration, rule names, bands, and `order`
  constraints is sketched, not fixed.
- **`check` stopping with `succeeded`** — allow a check rule to force-pass
  remaining checks (`stop succeeded`), or restrict `check` to `failed`/fall
  through only?
- **Namespaced reasons.** `stop_reason` is an open `type`, so its values are bare
  globals (like `article`/`direction`) and cannot share a name across reasons.
  A general fix would be scoped values (`stop_reason.cant_take`), which would also
  retire the bare-global collision problem these declarations have today
  (`article person` colliding with `type person`). Defer until a second reason
  set actually needs a duplicate name. Note this is independent of *reopening* —
  an open type is already extensible across files; namespacing is only about name
  collisions.
- **Generic / unset reason.** Today a `stop failed` with no reason leaves
  `self.reason` unset, so a reason-keyed `report failed` rule prints nothing —
  silent failure. Should the engine require a catch-all branch, emit a built-in
  default line, or warn at compile time when an action can fail with no
  `report failed` coverage?
- **Override suppression for report bands** — *implemented* (see *Cross-rule
  override suppression*): bare `stop` halts the band and author rules run before
  library rules. Bare `stop` in a non-void value rulebook yields the declared
  `default`. Remaining: whether named-rule *replacement* is also needed for cases
  coarse author-before-library ordering can't express.
- **Reading an action's outcome.** A general rulebook's result is readable via
  `follow` in expression position, but `try ACTION:` is statement-only and
  discards the `outcome` (`runAction`'s return is dropped). So author code cannot
  branch on whether an action succeeded — the outcome only drives the engine
  (`report` vs `report failed`). Surface it via `try` in expression position, a
  queryable last-action-outcome, or both? (Listed under *Required language/runtime
  support* item 5 but not built.)
- **Turn cost.** Does a band need to declare whether the action "took a turn,"
  or is that derived from the outcome and owned by the turn cycle
  (`devdocs/game_parser.md`)?
- **Tracing.** A debug facility analogous to Inform's `RULES` (log which rules
  fired and what they decided) — useful given ordering is now explicit; where
  does it live?
