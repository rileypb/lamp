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
| containment relation | `contains` (`from` = container, `to` = contained, `unique`) | `scopeOf`/`containerOf` (reachability over `contains`); `moveObject` (`move X to Y`) |
| scope-root type | `physical` | `resolvePool`, `canBeAntecedent` |
| action outcomes | `succeeded` / `failed` | `runAction` (the `failed` value triggers the `report failed` band) |

**Containment is the `contains` relation, not a field (revised).** Containment was
originally the `holder` *field*, with `scopeOf` walking `inst.holder`. It is now a
one-to-many `contains` **relation** (the source endpoint is the container; the `to`
endpoint is `unique`, so an object is in at most one place). `scopeOf` reads
containment through `containerOf`, and the `move X to Y` statement asserts a
`contains` edge (evicting the prior one via `unique`). The runtime owns the
**relation name `contains`** and reads its endpoint field names from the registry,
so a world library may name the endpoints freely; `lib/advent` exposes the read side
to authors as the `holder(x)` helper. The `holder`-field representation and the
migration's transitional bridge (a `containerOf` fallback plus an advent
field-sync handler) have been removed — `contains` is the sole containment
representation. (A self-contained game that never drives `run_command`/scope is
free to model location however it likes; the contract binds only the parser/scope
path.)

We considered and **rejected** two alternatives:

- **Making these configurable** (`configureWorld({ containmentField, ... })`).
  Under D1 there is exactly one world model, so configurability is speculative
  generality — and the runtime already hardcodes these names. The fix is to
  *document* the contract, not parameterize it.
- **Making Lamplighter world-agnostic** (extract the parser/scope into a plugin
  layer). Out of scope; the runtime is an IF runtime by design.

A world library (and any program that drives `run_command` itself) must define a
`physical` type and a `contains` relation (the containment representation
`scopeOf`/`containerOf` read), and its `outcome` kind (`lib/sys/kinds.lamp`) must
use the labels `succeeded`/`failed` to match the runtime. These are the contract.

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

## Resolved — presentation is library-owned, settings are plain globals

Presentation policy no longer lives in the runtime. The decisions:

**Author-facing form — settings are plain declared globals.** An author tunes
presentation with an ordinary top-level assignment; the names are declared (typed,
compile-checked), never string keys:

```lamp
oxford_comma = true
```

The base library declares each setting global with a default
(`global bool oxford_comma = false` in `lib/sys/globals.lamp`). New presentation
options are just new declared globals — no runtime signature changes. Authors
never write stringly-typed calls like `set_setting("oxford_comma", true)`; that
shape is rejected. (If presentation ever grows past a handful of knobs, these can
be promoted to fields on the `game` object or a dedicated `style` singleton
without changing this principle.)

**Implementation — formatting moved out of the runtime.** `formatListValue` in
the runtime is now a thin call into a `listFormatter` that a library installs via
`setListFormatter`; the runtime's only fallback is a bare comma join, so it holds
no English-prose policy. `lib/sys/index.js` installs the real formatter (empty →
`nothing`, two → `a and b`, the serial comma) and reads the `oxford_comma`
setting. The runtime reads no presentation global.

**Known cost.** Because the formatter is a native (inlined verbatim, not encoded),
its `getGlobal("oxford comma")` makes the setting name appear plaintext in
`--encode-strings` builds — the documented native-literal leak (the same class as
the old `getGlobal("player")`). The name is a formatting flag, not a spoiler, so
this is acceptable; the encode corpus no longer asserts it is hidden.

## Outcome labels — runtime-owned, documented not configured

`succeeded`/`failed` stay runtime-owned (the pipeline inherently has them and
`runAction` must know which means failure). Document in `runAction` and
`devdocs/rulebooks.md` that `lib/sys`'s `outcome` enum mirrors the runtime, not
the reverse. (Not yet written.)

## Status / remaining work

1. **Done:** `run_command(line, actor)` — `lib/sys` self-contained (D5).
2. **Done:** presentation moved library-side (`setListFormatter` + `lib/sys`
   formatter); the `USE OXFORD COMMA` magic global is renamed `oxford_comma` and
   read only by the library. The runtime reads no presentation global.
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

- **Does the `actor` parameter want a real base type** rather than `object`?
  Would need a shared in-world root (e.g. making user-type roots descend from
  `object`, or a base `thing`); not worth it until stricter object-type checking
  makes `object` here inconvenient.
