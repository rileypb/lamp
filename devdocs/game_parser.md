# Game Parser

> Status: design; **v0 implemented** (see Staged roadmap). This document defines
> the intended design for the Lamp **Game Parser** — the component that turns a
> player's typed command into a resolved in-game action and drives it through
> the action-processing pipeline. It is the runtime counterpart to the
> "Game Parser" term defined in `devdocs/architecture.md`.
>
> The target is feature parity with the Inform 7/10 parser, adapted to Lamp's
> object/type/relation model and built so authors can replace or extend
> individual stages rather than rewrite the whole thing.

This proposal does not change the Lamp surface language as specified in
`devdocs/specs.md`; where the parser needs a capability the language does not
yet have, it is called out explicitly under **Required language/runtime
support** and **Open questions** rather than assumed.

## Purpose

Given a line of player text (e.g. `put the brass lamp in the wicker basket`)
and the current world state, the Game Parser must:

1. Tokenize and normalize the input.
2. Match it against the game's **grammar** (the set of understood command
   patterns) to identify a candidate **action** and its noun phrases.
3. Resolve each noun phrase to a concrete game object (or objects), using
   **scope** (what the player can currently see/reach), pronouns, adjectives,
   and **disambiguation** when a phrase is ambiguous.
4. Produce a fully-bound **action** and run it through the **action-processing
   pipeline** (the rulebooks), which decides what actually happens and what is
   printed.
5. Report failures the way an IF parser does — `You can't see any such thing.`,
   `Which do you mean, the red door or the blue door?`, `You can't go that way.`

## Boundaries

- **In scope:** the parse → resolve → act pipeline, its data model (verbs,
  grammar lines, actions, scope, rulebooks), how each stage maps onto Lamp
  constructs, and the native helpers required to support stages the current
  language cannot express.
- **Out of scope:** authoring the world model itself (rooms, items — already
  covered by types and relations), the sandbox input transport (covered by
  `devdocs/sandbox.md`; the parser consumes `readline()` and is agnostic to how
  the line arrives), and end-user player documentation.
- **Non-goals (initially):** full natural-language understanding, multiplayer
  command routing, and a save/undo system. Undo interacts with the parser (I7's
  `again`/`undo`) and is noted under Open questions but not specified here.

## Inputs and Outputs

- **Input:** one line of text from `readline()`; the current world state
  (objects, their fields, and relation instances such as `connects` and
  containment via `item.holder`); and the game's declared grammar/vocabulary.
- **Output:** either (a) a resolved action that has been run through the
  pipeline (with its side effects and printed output), or (b) a parser error
  message, or (c) a disambiguation prompt that consumes the next input line.

## Design principles

- **Stage isolation.** The parser is a fixed sequence of stages with documented
  inputs and outputs. An author can replace one stage (e.g. swap the scope
  algorithm, or add a tokenizer pre-pass) without touching the others.
- **Declarative grammar in Lamp, mechanism in native JS.** Authors describe
  vocabulary, grammar lines, and rules in Lamp. The text-crunching that Lamp
  cannot currently express (string normalization, token matching, building the
  vocabulary index, list iteration) lives in a parser support library's
  `index.js`, exposed through `native function` declarations. This keeps the
  authoring surface in Lamp while not blocking on language features.
- **Rules as data, ordered and overridable.** Action behavior is expressed as
  rulebooks (ordered lists of rules), so a library can insert, replace, or
  remove a rule. This is the extension model that makes the parser modular at
  the behavior level, not just the stage level.

## Engine architecture: one generic engine, per-game data

A foundational decision: there is **one shared, generic parser engine**, written
in **native JavaScript** and shipped in the parser library's `index.js`. There is
**not** a bespoke parser generated per game, and the engine is not (initially)
written in Lamp.

The decision separates two independent axes that are easy to conflate:

- **Engine language** — native JS vs. Lamp.
- **Engine form** — *generic* (interprets the grammar as runtime data) vs.
  *bespoke* (Lantern emits specialized parsing code per game).

### Generic engine, not per-game generation

Each game's grammar, vocabulary, and rules are authored in Lamp and **compiled
by Lantern into per-game data** that the one shared engine consumes at runtime.
Games therefore get fully tailored parsing — but the tailoring lives in the
*data*, not in forked engine code. This mirrors how the system already works:
the relation `syntax` templates and vocabulary are Lamp-declared and compiled,
while the relation *engine* in Lamplighter is a single shared implementation.

Bespoke per-game generation is rejected because the expensive, interesting work
in an IF parser — scope, noun resolution, adjective matching, disambiguation,
and the rulebooks — is driven by **runtime world state, not grammar shape**.
Lantern cannot know at compile time where objects are, what is open, or what the
player holds this turn. The only thing specializable from the grammar is the
verb/pattern lookup, which is the cheapest part. So generation would buy almost
nothing on the hot path while turning Lantern into a parser generator (large
ongoing complexity), producing hard-to-debug emitted code, and baking the grammar
in — which defeats runtime-added grammar and rules.

### Native JS now, with a migration path toward Lamp

The engine is native JS because Lamp cannot express the core today (no
element-wise list iteration, no string operations, no keyed maps — see Required
support) and because word/character-level text crunching is a poor fit for the
language regardless. This also matches the established architecture: heavy
mechanism in Lamplighter, declarative surface in Lamp.

A pure-Lamp engine is the **long-term direction for the layer authors actually
touch** (scope, rulebooks, disambiguation policy), not a v0 requirement. The
practical shape is a gradient, stage by stage:

| Stage | Where it lives | Rationale |
|---|---|---|
| Lexer, vocabulary index | Native JS (permanent) | text/perf; opaque mechanism, not authored content |
| Grammar match | Native JS, fed by Lamp-declared, Lantern-compiled grammar data | reuses the template/match machinery |
| Scope, noun resolution | Native helper now → movable into Lamp as iteration/strings land | authors commonly override this |
| Disambiguation, rulebooks | Lamp (with a native rulebook driver for stop/continue) | this is authored behavior |

The stage-isolation principle is what makes the gradient possible: each stage
has one entry point, so a stage can migrate from JS to Lamp without disturbing
its neighbors.

## Inform feature inventory (parity target)

The design targets these Inform 7/10 parser capabilities, grouped by stage:

**Grammar / understanding**
- Verbs with multiple synonyms (`take`/`get`/`pick up`).
- Grammar lines with noun slots, prepositions, and literals
  (`put [something] in/into [something]`).
- Token kinds: `[something]` (any in-scope object), `[things]` (multiple),
  typed slots (`[a direction]`, `[a number]`, `[text]`), and `[anything]`
  (object outside scope, for meta/debug verbs).
- `Understand "..." as ...` for object names, synonyms, and adjectives.
- Noun phrases with articles, adjective stacks, and multi-object lists
  (`all`, `take all but the sword`, `the red and the blue ball`).
- Pronouns (`it`, `them`, `him`, `her`) bound to the last-referenced object(s).

**Scope & resolution**
- Scope: the set of objects the player can currently refer to (room contents,
  carried items, contents of open/transparent containers, recursively).
- Disambiguation prompts and "deciding which one" rules.
- Reachability/visibility distinction (you can *see* through a window but not
  *take* through it) — modeled as accessibility checks in the action rules.

**Action processing (rulebooks)**
- Action representation as a typed object with named, typed slots and an
  implicit actor (in place of Inform's positional noun/second noun).
- The rule sequence: **before → instead → check → do → after → report**, with
  the ability for a rule to stop the action (success/failure).
- Before/after/instead rules scoped by object, by action, or by condition.
- Out-of-world actions (`save`, `score`, `quit`) that bypass turn machinery.
- The turn cycle: every-turn rules and time passing.

**Parser feedback**
- Standard responses for unknown words, out-of-scope nouns, ambiguity, and
  inapplicable actions.

## Action model and declarations

An **action** is a typed object. `action NAME:` declares an **action type** — a
subtype of a built-in `action` type — whose fields are its **slots** and whose
body carries the surface `syntax` that invokes it. The parser constructs one
action **instance** per recognized command, fills its slots with the resolved
objects, and dispatches it through the pipeline with that instance bound to
`self`.

```lamp
action take:
    item taken
    syntax:
        "take [taken]"
        "get [taken]"
        "pick up [taken]"
        "pick [taken] up"

do take:
    self.taken.holder = self.actor
```

### Slots

- Each slot is a typed field (`item taken`, `container destination`). The slot
  **type does double duty**: it filters grammar matches (a `[taken]` slot only
  binds an `item`) and it statically types `self.taken`, so `self.taken.holder`
  type-checks like any field access.
- Every action has an **implicit `person actor` slot**, defaulting to the
  player. Handlers use `self.actor`, never a hardcoded `player`, so
  NPC-directed commands (`bob, take the lamp`) work without redesign.
- A second noun is just another named slot — there is no privileged `second`
  role. Named slots are this model's answer to Inform's positional
  `noun`/`second noun`:

  ```lamp
  action insert:
      item taken
      container destination
      syntax:
          "put [taken] in [destination]"
          "insert [taken] into [destination]"
  ```

- A `list<T>` slot expresses a **multiple-object** slot (Inform's `[things]`):
  `list<item> taken` lets `take all` bind many objects to one slot. (How a
  multiple slot interacts with the turn clock is an Open question.)

### Syntax templates

The `syntax` block lists surface forms, one quoted template per line (no commas
— consistent with Lamp's newline-delimited blocks). In a template, `[slot]` is
filled by the value matched at that position and every other token is a literal
that must appear verbatim — the same `[slot]`/literal convention as relation
`syntax` templates (`devdocs/specs.md`, Relations), so the existing template
engine is reused. Discontinuous forms (`pick [taken] up`) are just literals on
both sides of a slot. Verb synonyms (`take`/`get`/`grab`) are expressed as
parallel templates rather than a separate verb-word list.

Slot *type* (`item`), *scope* (can the player refer to it right now), and
*accessibility* (can they reach it) are three distinct filters: the type lives
in the declaration, scope is applied by Stage 3 resolution, and accessibility
belongs in `check` rules. They must not collapse into one.

### Phase rules

Behavior is attached with **phase rules**: a leading phase keyword, the action
name, and a block. Each phase keyword introduces a distinct rulebook:

```lamp
check take:
    if self.taken.scenery:
        print "That's hardly portable."
        stop failed                         # stop ends the action with failure

do take:
    self.taken.holder = self.actor

report take:
    print "Taken."
```

The six phase keywords run in pipeline order: **before → instead → check → do →
after → report**. (`do` is the perform phase — Inform's "carry out".) Leading
with the phase keyword reads naturally and signals that these are *rulebook*
rules, not `on`-style event handlers: events fire all handlers reactively, while
phase rules run in order and can short-circuit. Within a phase, multiple rules
run in registration order (as change handlers already do).

- The phase keywords are **contextual keywords**, special only in the leading
  `PHASE ACTIONNAME [when …]:` position (like `syntax`/`source`/`target` inside a
  relation body); they remain usable as ordinary identifiers elsewhere. A phase
  rule naming something that is not a declared action is a compile error.
- There is no bare/sugar form — a phase keyword is always required (Inform has no
  bare form either), which keeps the leading token unambiguous.
- `stop succeeded` / `stop failed` ends the action immediately with that
  outcome; without `stop`, control falls through to the next rule/phase.
  Refusal text is `print`ed, then `stop failed` — `stop` carries an outcome
  value, never a message. The full rule/rulebook model (typed outcomes, the
  unified `stop`, ordering, rule identity) is specified in
  `devdocs/rulebooks.md`; the action phases here are its built-in per-action
  instance.

**Object- and condition-specific rules** (Inform's *instead*) reuse the `when`
guard and specificity already defined for function overloads
(`devdocs/specs.md`, Conditional overloads; `devdocs/specificity.md`):

```lamp
instead take when self.taken == excalibur:
    print "The sword will not yield to the unworthy."
    stop failed
```

When several guarded rules in a phase match, the most specific wins ties as
specified in `devdocs/specificity.md`.

The word `do` is reserved for the perform phase only. A future imperative
"perform this action now" form (Inform's `try taking`) should use a separate
keyword (`try`) to avoid overloading `do`.

### Why action-as-object rather than ambient globals

Modeling the live command as an action *instance* (not a set of `noun`/`actor`
globals) is what makes **nested and implicit actions** safe: "try silently
opening the box, then taking the lamp" creates two action instances that do not
clobber each other's slots, whereas ambient globals would stomp on reentrancy.
The cost — Lamp has no surface syntax for runtime object construction — does not
fall on the author: the **native engine** constructs the instance and binds
`self`; the author only declares the action type and writes handlers.

## Architecture: the pipeline

The parser is six stages. Each stage names its input and output so it can be
replaced independently.

```
line of text
   │  Stage 1: Lexer        normalize + tokenize
   ▼
token list
   │  Stage 2: Grammar match  match action template, split noun phrases
   ▼
parse candidate(s): action name + raw noun phrases
   │  Stage 3: Noun resolution  phrases → objects, via vocabulary + scope
   ▼
bound action instance (slots filled) — possibly ambiguous
   │  Stage 4: Disambiguation   resolve ambiguity / prompt
   ▼
fully bound action
   │  Stage 5: Action processing  run the rulebooks
   ▼
world mutated + output printed
   │  Stage 6: Turn cycle       every-turn rules, advance time, re-prompt
   ▼
next line
```

### Stage 1 — Lexer (native)

Lowercases, strips punctuation that is not significant, expands a few
contractions, and splits into tokens. Extends the existing `split()`
(`lib/sys/index.js`). Output: `list<string>`.

Authors rarely override this; it is native for speed and because Lamp lacks
string manipulation. It is still a swappable module: the parser calls a single
`tokenize_command` native function.

### Stage 2 — Grammar match

The game's grammar is the union of every action's `syntax` templates (see Action
model and declarations). A template is a pattern of literal tokens (`put`, `in`,
`up`) and `[slot]` markers; matching a line selects an action type and binds each
matched span to the named slot for that position.

Lantern compiles all templates into a per-game grammar table, and the native
matcher consults it (consistent with the Engine architecture decision). The
matcher reuses the relation `[slot]`/literal template convention.

Output of this stage: zero or more **parse candidates**, each an action type plus
the raw token spans for each slot. Multiple candidates (e.g. `put X in Y` vs. a
one-slot `put`) are ranked; Inform prefers the line that consumes the most input
and leaves the fewest words unaccounted for.

The remaining authoring-surface choice — whether `syntax` blocks desugar onto the
relation template mechanism or a first-class construct, and whether templates
need alternation (`in/into`) and optional tokens — is tracked under Open
questions.

### Stage 3 — Noun resolution

Each object contributes **vocabulary**: nouns (its name words) and adjectives.
Proposed declaration, again leaning on relations/fields:

```lamp
item brass_lamp:
    understand "lamp lantern"        # extra nouns
    adjectives "brass shiny"
```

A native **vocabulary index** maps each word to the set of objects that word can
name, built once at startup (and refreshed when names change). Resolution of a
noun phrase:

1. Drop leading articles (`the`, `a`, `an`).
2. Collect adjectives, then the head noun.
3. Candidate set = objects in **scope** whose vocabulary matches the noun and
   all adjectives.
4. `all` / `everything` expands to all matching in-scope objects (minus
   `... but ...` exclusions). Conjunctions (`X and Y`) produce multiple nouns.
5. Pronouns resolve against the saved "last referenced" object(s).

**Scope** is computed by a `scope_of(person)` function: start from the actor's
location, add the room's contents, the actor's possessions, and recursively the
contents of open or transparent containers. This is exactly a relation traversal
over containment (`item.holder`) plus the actor's room — expressible in Lamp
once element-wise iteration exists; until then provided as a native helper that
walks the relation index. Scope is the canonical place authors extend ("the
wizard can always refer to the distant tower").

Output: the action instance with its slots bound to object(s), flagged ambiguous
if any phrase matched more than one object.

### Stage 4 — Disambiguation

If a phrase matched several objects, apply "deciding which one" rules (author
hooks that pick a preferred object by condition), then narrow by recently/most
salient. If still ambiguous, print `Which do you mean, the X or the Y?` and
consume the next input line as the answer. This stage owns the only place the
parser reads a *second* line mid-command.

### Stage 5 — Action processing (rulebooks)

The resolved command is realized as an **action instance** (see Action model and
declarations) and run through its rulebook phases in order:

1. **before** — early intervention; may `stop`.
2. **instead** — replace the action; `stop`s by default once matched.
3. **check** — validate preconditions (accessibility, state); may `stop` with
   failure.
4. **do** — perform the world change (`self.taken.holder = self.actor`).
5. **after** — react to a successful change; may `stop` before reporting.
6. **report** — print the result.

Rules are registered with the leading-phase form `PHASE ACTIONNAME [when …]:`
(see Phase rules); object- or condition-specific overrides use `when` guards,
resolved by specificity. The only mechanism beyond what the language already
provides is the **rulebook driver** that runs each phase's rules in registration
order and honors `stop` — native at first (see Required support).

### Stage 6 — Turn cycle

After a successful action (that took time), run **every-turn** rules, advance
the clock, fire timed/daemon events, and re-prompt. Out-of-world actions
(`quit`, `score`) skip the clock. This replaces the placeholder
`while true: input = readline()` loop in `lib/tinyadvent/startup.lamp`.

## Required language/runtime support

The parser needs capabilities the current language (`devdocs/specs.md`) and
runtime do not yet provide. Each is listed with the lightest option that
unblocks it.

1. **Element-wise iteration over lists.** Scope, vocabulary matching, and
   multi-object actions all iterate object collections; today `for` only counts
   integers. *Options:* add `for X in LIST:` to the language (preferred,
   broadly useful) **or** provide native iteration helpers as a stopgap.
2. **Rulebook control flow (`stop`).** Phase rules (before/instead/check/after)
   must be able to halt the pipeline. *Options:* a native rulebook driver the
   parser library ships (lower risk), **or** a `stop`-aware ordered dispatch in
   the language. `stop`/`stop OUTCOME` is the surface concept either way; the
   full model is specified in `devdocs/rulebooks.md`.
3. **String operations.** lowercasing, prefix/suffix tests, and equality on
   word tokens. *Option:* native helpers (`to_lower`, `starts_with`,
   `word_at`) — no language change needed.
4. **A keyed lookup / map** for the vocabulary index. *Option:* keep it entirely
   inside the native support library; expose only `objects_named(word)` to Lamp.
5. **Standard direction/inverse data.** `connects` already supports `inverted`
   directions, but the sample direction objects do not yet set `inverse`
   (`lib/tinyadvent/globals.lamp`). Going via a direction depends on this being
   populated. *Note:* this is library data, not a language change.
6. **Runtime construction of action instances.** The engine creates one
   action-type instance per command and binds it as `self`. Lamp has no surface
   syntax for runtime object construction and does not need one — this is a
   native-engine responsibility built on the runtime's existing `createObject`.
   Action instances are transient (not registered for name lookup).

None of these require touching `lib/` or `sample/` to design; they are
prerequisites to implementation and are surfaced here so they can be scheduled.

## Modularity & extension model

The two axes of extension:

- **Stage replacement** — swap a stage by providing an alternative
  implementation of its single entry point (`tokenize_command`,
  `match_grammar`, `resolve_noun`, `scope_of`, `disambiguate`, `run_action`).
  The default parser library wires these together; an author library imported
  *after* it can override any one.
- **Rule insertion/removal** — add or replace phase rules (`check take:`,
  `do take:`, …, including `when`-guarded overrides), add `syntax` templates, or
  add vocabulary, all without editing the parser library. This is the everyday
  authoring path and mirrors how I7 authors work.

Packaging: ship the parser as an importable library (e.g. `lib/parse/` or
folded into `lib/vanilla/`, currently empty) with a `.lamp` grammar/rule layer
plus an `index.js` providing the native helpers above. The empty `lib/vanilla/`
directory looks intended as exactly this "standard rules" home; confirm before
populating it.

## Staged roadmap

- **v0 — minimal viable parser. (Implemented.)** Single verb + single noun.
  Native lexer (lowercase + split) and grammar matcher in the Lamplighter
  runtime; actions declare a `syntax:` block of `[slot]` templates; scope = the
  actor's location contents + inventory via `holder`; first in-scope name match
  wins. Entry point: the native `run_command(line)` (actor = the `player`
  global), driven by a `readline` loop. Standard responses "You can't see any
  such thing." / "I don't understand that." Demo + golden:
  `tests/fixtures/parser1.lamp`. No adjectives, pronouns, disambiguation, or
  multiple objects yet.
- **v1 — resolution depth.** Adjectives, articles, nested/transparent container
  scope, pronouns (`it`), disambiguation prompts, richer parser error messages.
- **v2 — rulebooks.** The action-rulebook bands are implemented
  (`devdocs/rulebooks.md`); remaining: every-turn and timed rules, and
  out-of-world actions.
- **v3 — Inform-parity grammar.** `[things]`/`all`/`but`, multi-object actions,
  typed tokens (`[number]`, `[text]`, `[a direction]`), `Understand` synonym
  generality, topic/conversation tokens.

## Worked example (target behavior)

```
> put the brass lamp in the basket
```

1. **Lex:** `["put","the","brass","lamp","in","the","basket"]`.
2. **Grammar:** matches the `insert` template `"put [taken] in [destination]"` →
   action type `insert`, `[taken]` span = `brass lamp`, `[destination]` span =
   `basket`.
3. **Resolve:** `[taken]` → drop `the`, adjective `brass`, noun `lamp` → in
   scope: `brass_lamp`. `[destination]` → `basket` (a `box`). Bind slots
   `taken = brass_lamp`, `destination = basket`.
4. **Disambiguate:** both unambiguous; skip.
5. **Act:** construct an `insert` instance (`taken=brass_lamp,
   destination=basket, actor=player`). before(no-op) → instead(none) → check
   (`is the destination open? is the item held?`) → do
   (`self.taken.holder = self.destination`) → report (`You put the brass lamp
   into the basket.`).
6. **Turn:** every-turn rules; advance clock; re-prompt.

## Assumptions

- The world model stays as in `lib/tinyadvent`/`lib/advent`: containment via
  `item.holder` (a `container`), room graph via the `connects` relation, a
  `player` global. The parser builds on these rather than introducing a parallel
  model.
- Input continues to arrive one line at a time via `readline()`; the parser does
  not care whether that line came from a terminal or the sandbox transport.
- The relation `syntax` template engine is reusable for grammar-line matching.
  If it turns out too restrictive (e.g. no alternation `in/into`), grammar moves
  to a dedicated native matcher (Stage 2 option b).

## Non-goals

- No change to the Lamp surface language is proposed here; needed language
  features are listed as prerequisites for separate decision.
- No NLP/ML parsing; matching stays deterministic and table-driven, as in I7.
- Save/restore/undo are out of scope (noted in Open questions).

## Open questions

- **Grammar authoring surface:** the engine decision settles that grammar
  *matching* is native and consumes per-game grammar data compiled by Lantern
  (see Engine architecture); what remains open is the *authoring* surface —
  reuse the relation `syntax` mechanism (no language change) or add a first-class
  `verb`/`understand` construct to Lantern — and whether the template form needs
  alternation (`in/into`) and optional tokens.
- **Rulebook driver:** a native driver vs. teaching the language a `stop`-aware
  ordered dispatch. Leading-phase `PHASE ACTIONNAME:` rules and `stop` are the
  surface either way; the open part is where the ordering/short-circuit logic
  lives.
- **Action instance lifetime & identity:** the action-as-object model is settled
  (see Action model and declarations) — the live command is an engine-built
  action-type instance with named slots, not ambient globals, and no author-
  facing `new` is required. What remains open is whether instances are ever
  persisted/queryable (e.g. for `again` or rule tracing) or strictly transient.
- **Multiple objects & time:** how does a multi-object action (`take all`)
  interact with the turn clock — one turn total or one per object (I7 treats it
  as one action iterated)?
- **`again`/`undo`/save:** these require the parser to retain the last command
  and the runtime to support state snapshots. Where does that boundary sit
  relative to `devdocs/sandbox.md`'s persistence capability?
- **Where does the standard parser live** — populate the empty `lib/vanilla/`,
  or a new `lib/parse/`? (Requires user direction; both `lib/` dirs are
  author-owned.)
