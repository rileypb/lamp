# World Model Contract (design note)

Status: **partially implemented.** Captures the decisions behind
architecture-review issue **C** ("Lamplighter embeds the advent world model").
Source-of-truth order still applies: `devdocs/specs.md` and
`devdocs/architecture.md` outrank this note; if they disagree, they win and this
note is updated.

## Purpose

Lamplighter's command core (`scopeOf`, `resolvePool`, `canBeAntecedent`,
`runAction`, `formatListValue` in `src/lamplighter/index.js`) was written partly
in terms of one library's world model, and `lib/sys` (the always-loaded base
library) reached up into `lib/advent` for a global. This note records what the
runtime↔library contract actually is, what stays hardcoded, what got fixed, and
what presentation work remains.

## Decision D1 — Lamplighter is an IF runtime, names owned by the runtime

Lamp's purpose is "designing and playing parser interactive fiction"
(`devdocs/architecture.md`). We keep the Game Parser, a containment hierarchy,
physical scope, and an action pipeline **in the runtime**. The structural names
those depend on are **owned by the runtime and hardcoded** — they are part of
what it means to be a Lamp IF game, not configuration:

| Concept | Name (hardcoded) | Used by |
|---|---|---|
| containment field | `holder` | `scopeOf` (reachability over `inst.holder`) |
| scope-root type | `physical` | `resolvePool`, `canBeAntecedent` |
| action outcomes | `succeeded` / `failed` | `runAction` (the `failed` value triggers the `report failed` band) |

We considered and **rejected** two alternatives:

- **Making these configurable** (`configureWorld({ containmentField, ... })`).
  Under D1 there is exactly one world model, so configurability is speculative
  generality — and the runtime already hardcodes these names. The fix is to
  *document* the contract, not parameterize it.
- **Making Lamplighter world-agnostic** (extract the parser/scope into a plugin
  layer). Out of scope; the runtime is an IF runtime by design.

A world library (and any program that drives `run_command` itself) must define a
`physical` type and a `holder` field, and its `outcome` kind
(`lib/sys/kinds.lamp`) must use the labels `succeeded`/`failed` to match the
runtime. These are the contract.

## Decision on library structure — keep `lib/sys` and the IF library split

The split is **justified** and is kept (an earlier idea to merge them was
investigated and rejected):

- `lib/sys` is the **universal base**, always loaded for every compiled program:
  the runtime-bridge natives (`readline`, `prompt`, `write`, `split`, `to_lower`,
  `run_command`), the `game` type, and the base kinds (`outcome`, `reltype`,
  `color`). It is world-model-agnostic.
- `lib/advent` is **one opt-in IF world model** (`lib advent`): the type
  hierarchy (`thing`/`physical`/`room`/`item`/`person`/`direction`), the standard
  actions, the world objects, and the game loop.

Evidence the boundary is real: ~45 test fixtures use the base with **no** world
library, and the parser/interactive fixtures (`parser1`, `parser_it`,
`interactive1/2`) build their **own** minimal world on the base — `parser1`
defines its own `type physical`/`room`/`person` and its own `player`. Merging the
IF model into the always-loaded base would force advent's types and `on startup`
command loop onto all of them, colliding with their own `type room`/`direction`
declarations (`Type already defined`) and breaking deterministic output. So the
distinction earns its keep: **base vs. opt-in world model.**

## Resolved — `run_command` no longer names a world-specific global (D5)

The only genuine instance of issue C was that `lib/sys`'s `run_command` read
`getGlobal("player")` — a soft contract requiring *some* world to define a
`player` global. It was not a hard dependency on advent (the parser fixtures
supply their own `player`), but it meant the base named a world concept.

**Fix (done):** the commanding actor is now passed in.

```
# lib/sys/functions.lamp
native function void run_command(string line, object actor)
```

```js
// lib/sys/index.js
function run_command(line, actor) {
    lamplighter.runCommand(line, actor);
}
```

Callers pass their own actor: `run_command(input, player)` in advent's loop and
in each parser fixture. The actor parameter is typed `object` (the runtime root)
because each world defines its own `person` type with no shared supertype; the
runtime only needs an object with a `holder`. `lib/sys` now references no
world-defined name (verified) and is self-contained. Output is byte-identical
(golden + encode corpus).

## Remaining — presentation should be extensible, not a magic global (open)

`formatListValue` reads the string-keyed global `USE OXFORD COMMA`. Oxford comma
is just the first of an open-ended set of presentation options (list separators,
the empty-list string, capitalization, number words, pronoun tables…). The fix is
**not** a fixed-shape config object — that would put a new option on a runtime
signature every time. Two complementary directions, neither implemented yet:

- **Open settings store** — `getSetting(name, default)` over a plain map (or
  plain author-set globals), so new options are just new keys; the runtime never
  changes shape.
- **Library-owned formatting** — `formatListValue` is presentation *policy* living
  in the engine. Move it into the world/base library (the runtime keeps a thin
  default, or exposes a `setListFormatter`-style hook), so the runtime holds no
  presentation policy and the library reads whatever settings it wants.

Recommended: do both — formatting owned by the library, reading an open settings
store — so presentation is fully extensible without touching the runtime.

## Outcome labels — runtime-owned, documented not configured

`succeeded`/`failed` stay runtime-owned (the pipeline inherently has them and
`runAction` must know which means failure). Document in `runAction` and
`devdocs/rulebooks.md` that `lib/sys`'s `outcome` enum mirrors the runtime, not
the reverse. (Not yet written.)

## Status / remaining work

1. **Done:** `run_command(line, actor)` — `lib/sys` self-contained (D5).
2. **Open:** presentation — move list formatting library-side over an open
   settings store; retire the `USE OXFORD COMMA` magic global.
3. **Open (docs):** comment the `holder`/`physical`/`succeeded`/`failed` contract
   at the runtime sites and in `devdocs/rulebooks.md`.

## Assumptions

- One containment field (`holder`) and one scope-root type (`physical`) per game.
- One commanding actor per `run_command` call.
- One world model active at a time (single game per runtime instance).

## Non-goals

- Making Lamplighter world-agnostic / extracting the Game Parser into a plugin.
- Merging `lib/sys` and the IF library (investigated, rejected — see above).
- Configurable containment/scope names (rejected under D1).
- Supporting multiple simultaneous world models.

## Open questions

- **Settings store vs. plain globals** for presentation options — a dedicated
  `get/setSetting` API, or just documented author-settable globals that the
  library's formatter reads? Decide when implementing step 2.
- **Keep an author-facing `USE_OXFORD_COMMA`** that forwards into the new
  mechanism, or drop it?
- **Does the `actor` parameter want a real base type** rather than `object`?
  Would need a shared in-world root (e.g. making user-type roots descend from
  `object`, or a base `thing`); not worth it until stricter object-type checking
  makes `object` here inconvenient.
