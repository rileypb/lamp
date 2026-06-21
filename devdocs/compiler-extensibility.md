# Core vs. plugin: actions, and an extensible compiler

> **Status: proposal / design note.** Nothing here is scheduled or implemented.
> This records two directions for resolving the "IF is baked into the compiler"
> coupling documented in `devdocs/architecture.md` ("Layer boundaries and IF
> coupling") and weighs them, with a staged, low-risk first step.

## The problem this addresses

Lamp's compiler and runtime bake in the IF action/turn model: the band keywords
(`before/instead/check/do/after/report` + `report failed`), `try`, `silently`,
selectors, the `outcome` result type, the auto `reason` slot, and the
`{actor, action, reason}` universal slots. The base `action` type is even
hardcoded in the runtime bootstrap (`defineType("action", …)`) *because* `action`
is a reserved word and so cannot be written as `type action` in a library
(`src/lamplighter/index.js`, see the comment there).

The architecture doc frames this as deliberate ("Lamp is an IF runtime by
design") but leaves open whether the action model should stay language-level or
become library-level. This note takes that open question seriously and proposes
an answer.

## The empirical fact that unlocks both ideas

**The action/band core is already world-model-free.** `runAction` only walks the
bands of an instance — it never references `holder`, `physical`, or `player`. All
the IF-world coupling lives in `runCommand`/`scopeOf` (the code that turns
*player text* into an action instance). The other producer of actions, `try
ACTION:`, is entirely world-agnostic.

So an action is already a general primitive in an IF costume. Concretely:

- **The bands are a general "interceptable transaction" lifecycle:** before =
  pre-hooks, instead = override/intercept, check = validate, do = execute, after
  = post-hooks, report / report_failed = present success / failure.
- **`actor` / `outcome` / `reason` are general action metadata** — any system with
  agents, success/failure, and failure causes wants them.

The only genuinely parochial parts are two band *names* (`instead`, `report` are
Inform/IF vocabulary; `before/check/do/after` are neutral) and the *command
parser* that is one of two ways to produce an action.

## Idea 1 — Promote actions to first-class Lamp

Stop treating actions+bands as leakage; declare them part of the core and
document the band set as a general lifecycle. Lamp's core becomes an
entity / relation / kind / rulebook / **action** VM; parser-IF (the Game Parser,
scope, save/undo) becomes **one front-end library** on top, not "the point."

**Why it's defensible:** the core is already general (above). Non-parser front
ends fall out naturally — e.g. **choice-based IF** would use the action core
*without* the Game Parser: a `choose` action dispatched by `try`/`run`, `check`
gating availability, `do` mutating, `report` rendering the passage. Other fits:
UI event handling (validate → execute → feedback), workflow/state-machine
transitions, command processors, rules engines.

**Cost:** mostly framing. The IF command parser stays a library; the docs stop
hedging.

**Wart:** promoting the band names blesses IF vocabulary (`instead`, `report`) as
universal for non-IF users. Liveable; renaming would break IF familiarity.

## Idea 2 — A modular / extensible compiler

First, a disambiguation, because "libraries contribute grammar" folds two
different things together:

- **(a) The Lamp-source grammar** — the compiler parsing `.lamp` files. This is
  what "lib/advent contributes action parsing" means.
- **(b) The player-command + prose grammar** — the runtime Game Parser + locale
  packs. This is what "different real-life grammars" actually needs.

**(b) does not want compiler plugins.** French *player input* and French *prose*
are a runtime-parser + data-driven locale problem (`lib/en-US` → `lib/fr-FR`:
conjugation tables, article rules, word order), already underway via the
three-layer text split (`devdocs/text.md`). Adding French to the *compiler's*
grammar would do nothing for a French player. So (b) is out of scope for compiler
modularization.

For **(a)**, Lamp is unusually well-suited, because the pipeline already has
clean, keyed phase boundaries:

| Stage | Today | Plugin hook |
|---|---|---|
| Tokenizer | fixed `KEYWORDS` set | plugin registers keywords |
| Prescan | regex collects name-sets (`actionNames`, …) | plugin contributes a name-collector |
| Parser | `switch` on leading keyword → `parseActionDecl` etc. | plugin registers a declaration parselet (+ statement/expr parselets) |
| Checker | dispatch on `node.kind` | plugin registers a node-kind checker |
| Emitter | dispatch on `node.kind` | plugin registers a node-kind emitter |

The template already exists: each library ships an `index.js` inlined into the
**runtime**. Add a compile-time analog — e.g. `lib/advent/lantern.js` — loaded
during the existing `lib` scan (which already runs *before* parsing and already
has ordering via `liborder.js`). Lantern becomes a small core
(types, kinds, globals, functions, expressions, control flow) + a plugin
registry; lib/advent's plugin contributes `action`/`try`/bands/selectors. This is
the established shape — Babel plugins, Racket `#lang`/reader, Rust proc-macros.

**Hard parts / risks:**

- **Composition & ambiguity.** New *declaration* keywords are trivial (unique
  leading token). New *infix operators* need coordinated Pratt binding powers.
  New *statement* forms are the worst for ambiguity. Open third-party grammar
  turns grammar conflicts into a user-facing failure mode.
- **Compile-time trust.** Runtime native JS is sandboxed *at runtime*; a compiler
  plugin runs arbitrary JS *in the build*. That is a real trust expansion.
- **Tooling & comprehension.** Error messages, editor support, and "what does this
  file even parse as" all get harder. This is exactly why most languages avoid
  open grammar extension and instead offer hygienic macros within a fixed surface,
  or just a rich core.

## Synthesis and recommendation

The two ideas are complementary: **the more of Idea 1 you do, the less Idea 2 has
to carry.** If actions are core, lib/advent no longer contributes action *syntax*
— only the world model, the command grammar (`syntax:` blocks), and locale. So:

- **Core (Idea 1):** entities, relations, kinds, rulebooks, **actions+bands** —
  promoted and documented as a general lifecycle, not IF jargon.
- **Extensible surface (Idea 2, scoped):** reserve plugin/data extensibility for
  the genuinely-variable bits — the player-command grammar and human-language
  locale — which are *already* going data-driven.

**Recommended first step (de-risks both):** refactor Lantern into *core + one
first-party plugin* that owns the action/IF constructs — **no third-party grammar
yet.** That single move:

1. proves the plugin seam is real;
2. makes Idea 1's "actions are core, IF is a layer" concrete and testable;
3. lets the base `action` type move from the runtime bootstrap into the plugin's
   library (the thing `index.js` apologizes for);
4. is the prerequisite for *ever* allowing outside plugins — without yet paying
   the trust/tooling costs.

If it feels good with one in-house plugin, open it up later; if it doesn't,
nothing is lost and there's a clean internal boundary to show for it.

## Open questions

- Should the band set be fixed by the core or declared by the plugin (i.e. is
  "the seven bands" core policy, or plugin data)? Declaring them as data is the
  purer split but complicates the checker's `outcome`/`reason` handling.
- Do compiler plugins run trusted, or do we want a capability boundary at compile
  time analogous to the runtime sandbox?
- Where does the `syntax:` command-grammar block live once `action` is a plugin
  construct — with the plugin, or shared with a future locale/grammar layer?
- Does promoting actions to core argue for neutral band names, or is IF-flavored
  vocabulary acceptable for a system whose primary domain is IF?

## See also

- `devdocs/architecture.md` — "Layer boundaries and IF coupling" (the coupling
  this note proposes to resolve) and issue C (runtime side).
- `devdocs/world-model.md` — the "IF runtime by design" decision (D1) and the
  runtime ↔ world-model contract.
- `devdocs/rulebooks.md` — the generic rulebook primitive the action model
  specializes.
- `devdocs/text.md` — the three-layer text split, the model for (b) locale
  grammar.
