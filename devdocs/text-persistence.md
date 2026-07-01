# Persisting `text` values across save/undo/restore (design spec)

**Status:** **Phase 1 built (2026-07-01)**; Phase 2 (`self`-capture) not yet. This
specifies "Option C" — a template-ID registry that lets a stored `text` field survive
snapshot/restore as a *live* template, matching I7. It supersedes the "Option A" stopgap
(skip/preserve text fields), whose limits are recorded at the end.

**Phase 1 as built.** Emitter (`src/lantern/emitter.js`): each no-capture `TemplateLiteral`
gets an id (`templateIdCounter`); its factory is collected into a `registerTemplate(...)`
batch spliced in at module top (before construction); the use site emits
`instantiateTemplate(id)`. A template that captures a lexical (`templatePartsCaptureLexical`
/ `exprCapturesLexical` — conservative: anything not provably capture-free is treated as a
capture) is emitted inline as before. Runtime (`src/lamplighter/index.js`):
`templateRegistry` + `registerTemplate`/`instantiateTemplate` (brands the text with
`__tmplId`); `encodeValue` emits `{$tmpl:id}` for a branded text (else freezes);
`decodeValue` rebuilds via `instantiateTemplate`. **Phase 1.5 + 2a also built:** a template
that reads a **named instance** (`[clock.hour]`) persists — in a construction default *or* a
rule body — because a named instance is a module `const`; the emitter tracks lexical scope
(`localScope`, maintained by `emitStatementList`, consulted in `capturesName`) so this is
allowed *unless* a local shadows the name. Regression goldens: `textlive1` (construction
templates over a global + a named instance, undo *and* save/restore) and `textlive2` (a
rule-*assigned* template over a named instance). Fixes `bump.lamp`, `clock.lamp`, and the
`[FOO]` reassignment.

## Problem

A `text` value is a lazily-rendered template — a branded JS thunk
(`makeText(() => renderTemplate([...]))`, `index.js`), re-evaluated on each render so its
substitutions read live state. `captureState` cannot serialize a closure, so `encodeValue`
**freezes** a `text`-valued field to its current rendered string. On restore the field
becomes that dead string and no longer tracks the state it read. Undo, save, and restore
share this one codepath, so all three exhibit it (repro: `bump.lamp`; see
`devdocs/state.md` → "Known limitation — snapshot freezes live templates").

The freeze also fails a natural authoring pattern (I7):

```
FOO is a number that varies.
The lab is a room. "static description.."
instead of jumping:      increment FOO; try looking;
instead of examining something:  now the description of the lab is "I said [FOO].";
```

After examining, `lab.description` is the runtime-assigned template `"I said [FOO]."`.
Save → quit → relaunch → restore restores `"static description.."` (freezing loses the
live template; the stopgap Option A loses the reassignment because a fresh process only
runs construction). This spec makes that case faithful.

## Key insight (why this is tractable — and how I7 does it)

Every `text` template in the source is a **compile-time literal**: the emitter visits each
`TemplateLiteral` node and emits one `makeText(() => renderTemplate([frags]))`. There is a
fixed, finite set of them, known at build time — including the ones that appear *inside
rule bodies*. The template is compile-time even when the *assignment* is runtime.

This is exactly I7's model: text-with-substitutions compiles to a routine in the static
story image, and a text property holds a serializable **pointer** to that routine. Save
writes the pointer; restore reads it back; it still points at the same routine. We
replicate that with a **template-ID registry**.

Two more facts from the current emitter that shrink the problem:

- **Construction-time field templates have no `self`/local scope**
  (`emitter.js:604` — "a default template has no local/`self` scope, so referencing `self`
  there is unsupported by design"). So *every* description/`feels`/refusal set at
  construction references only **globals and literals** → captures nothing lexical → is
  trivially serializable by ID alone.
- **Rule-body templates** run with `(self) => {…}` scope. A rule that assigns a template
  may reference `self` (a **named instance** — serializable) or a `let` local / the action
  context (not serializable). The user's `"I said [FOO]."` references only a global, so it
  too captures nothing.

So the only templates needing a *captured environment* are rule-assigned templates that
reference `self`; everything else is ID-only.

## Design

### Runtime: a template registry + branded text values

- A module-level `templateRegistry: Map<id, factory>`. A **factory** is a function of the
  template's captured environment that returns a fresh branded `text` thunk:
  - no-capture template → `() => makeText(() => renderTemplate([...]))`
  - `self`-capturing template → `(self) => makeText(() => renderTemplate([... self ...]))`
- `registerTemplate(id, factory)` populates the registry **at module load**, once per
  literal — so template `N` exists after boot *whether or not the rule that assigns it has
  run*. This is the property cross-process restore needs.
- `instantiateTemplate(id, env)` calls `templateRegistry.get(id)(...env)` and **brands the
  result** with its `id` and `env` (`t.__tmplId = id; t.__tmplEnv = env`), so
  `encodeValue` can serialize it. The text value is otherwise an ordinary callable thunk —
  the render context, `formatValue`, `[cycling]`/`[first time]`, etc. are all unchanged.

### Emitter: ID assignment, hoisting, use-site instantiation

1. **ID assignment.** A build-scoped counter assigns each `TemplateLiteral` a stable `id`
   in deterministic AST-traversal order. Stability across a save (process P1) and a restore
   (process P2) is guaranteed by the **`buildId` gate** (a save only loads into the identical
   build → identical source → identical IDs).
2. **Hoist the factory.** For each template literal, emit one top-level
   `registerTemplate(id, factory)` into a template table emitted **before** construction and
   rule registration. The factory body references only its parameters (captured env) and
   module globals *by name* (`getGlobal(...)`), never the rule's ambient runtime scope — so
   it is valid at module-load time.
3. **Rewrite the use site.** Where the literal is used (a field default, an assignment, a
   `return`, a `print` argument), emit `instantiateTemplate(id, env)` instead of the inline
   `makeText(...)`. `env` is built from the template's **free lexical variables**:
   - references only globals/literals → `env = {}`
   - references `self` → `env = { self }`
   - references a `let` local, or the transient action context → **fallback** (below).
4. **Free-variable analysis.** The emitter already tracks `globalNames`; it additionally
   needs to know which identifiers in a template are *lexical* (`self`, function params,
   `let`s) vs global. For the pragmatic subset the saveable lexical set is exactly
   `{ self }` (a named instance); any other lexical capture routes to fallback.

### Serialization

- `encodeValue(t)` where `t` is a **branded** text → `{ $tmpl: id, env: encodeEnv(env) }`.
  `encodeEnv` encodes each captured value with `encodeValue` (so `self` → `{$ref: name}`);
  globals are not in `env` (read by name at render).
- `decodeValue({$tmpl, env})` → `instantiateTemplate(id, decodeEnv(env))` — the registered
  factory applied to the restored env, yielding a **fresh live thunk**. On a
  runtime-recreated instance this works too, because the factory (not the object) is the
  source of the thunk.
- A plain string still decodes to a string, so **old/frozen saves keep working** and
  fallback-frozen fields (below) round-trip unchanged.

### Faithful vs. fallback

| Stored `text` field holds…                                      | Handling            | Faithful? |
| --------------------------------------------------------------- | ------------------- | --------- |
| Construction template reading globals/literals (`[reveal]`)     | `{$tmpl:id}`        | ✅ live (Phase 1) |
| Construction template reading a **named instance** (`[clock.hour]`) | `{$tmpl:id}`    | ✅ live (Phase 1.5) |
| Rule-assigned template reading only globals (`[FOO]`)           | `{$tmpl:id}`        | ✅ live (Phase 1) |
| Rule-assigned template reading a **named instance** (not shadowed) | `{$tmpl:id}`     | ✅ live (Phase 2a, built) |
| Rule-assigned template reading `self` fields                    | `{$tmpl:id, env:{self}}` | ⚠️ Phase 2b (not built) |
| Template composed at runtime (`textA + textB`, concat)          | freeze → string     | ⚠️ frozen |
| Template capturing a `let` local / action context / shadowed name | freeze → string   | ⚠️ frozen |

**Phase 1.5 + 2a (named instances) are built.** A named instance compiles to a
module-level `const`, so a template reading `[clock.hour]` is persistable by id alone — no
env needed — **as long as no local shadows the name at that point**. The emitter tracks
lexical scope for exactly this: a module-level `localScope` set, maintained block-precisely
by `emitStatementList` (seeded with a rule/function's named params, extended by each `let`
and loop var), consulted in `capturesName`. So a bare object name is a persistable const
**unless** a `let`/param/loop var of the same name is in scope — in which case it's a
capture and the template falls back to freezing. Conservative: `capturesName`'s
fallthrough treats any unrecognized name as a capture. **Not** enforced via a no-shadow
rule (tried and reverted — object names are too numerous to reserve against locals, e.g. a
common `let count` collides with an object `count`).

The remaining fallbacks are essentially what **I7 also cannot persist** (runtime-composed
text, and `[the noun]`-style context that isn't saved state).

### Fallbacks in detail

- **Composed text** (`+`/`concat` producing a `text`, `emitter.js:1055`). The result is not
  a single template literal, so it has no `id`. It is emitted unbranded; `encodeValue`
  freezes it as today. Representing composition as a serializable tree is possible but
  over-engineered for how rarely a *stored field* holds runtime-composed text. Freeze +
  document.
- **Unsaveable capture** (a template referencing a `let` local, or the action context). The
  emitter emits it unbranded (as today) → `encodeValue` freezes it. This is correct for the
  common use (such templates are almost always *printed transiently*, never stored). When
  such a template is **assigned to a field**, the emitter should emit a **compile-time
  warning** ("this text is frozen when saved; it won't track later changes") so the
  restriction is loud rather than silent.

## Interactions

- **Undo, save, and restore unify.** All three route through `encodeValue`/`decodeValue`, so
  all three become faithful (no divergence — the Option A asymmetry disappears).
- **Read-only-render side-effect fixed for free.** Capturing no longer *renders* templates,
  so it no longer advances `[first time]`/`[cycling]` cursors at checkpoint/save time (the
  `devdocs/text.md` "read-only render flag" issue, for the capture path).
- **Render context untouched.** A branded text is still a plain thunk; the render-context
  stack, agreement/subject, and viewpoint globals are unaffected.
- **Build gate.** IDs are stable only within a build; the existing `buildId` refusal already
  prevents cross-build restores, so no format-version work is required.

## Phasing

- **Phase 1 — ID-only templates (no captured env).** Registry + `registerTemplate` /
  `instantiateTemplate`, emitter ID assignment + factory hoisting, `encodeValue`/
  `decodeValue` for `{$tmpl:id}`. The only emitter analysis needed is a **boolean**
  "does this template reference any *lexical* name (a bare identifier — `self`, a `let`, an
  action-context ref — as opposed to a `getGlobal(...)`/literal)?": **no** → brand + register
  (`env = {}`); **yes** → leave unbranded (today's freeze). No environment extraction yet.
  **This alone fixes `bump.lamp`, every construction description, and the `[FOO]`
  reassignment example** — i.e. the whole demo-blocking bug and the I7 counterexample,
  because none of them capture a lexical (construction defaults *can't*, and `[FOO]` reads a
  global). Composed/lexical templates fall back to today's freeze.
- **Phase 1.5 — named instances (built).** A construction-default template reading another
  object's field (`[clock.hour]`) persists by id alone (a named instance is a module const).
- **Phase 2a — named instances in rule bodies (built).** The emitter gained lexical-scope
  tracking (`localScope`), so a rule-assigned template reading a named instance persists too,
  *unless* a local shadows the name. This is what a no-shadow-on-objects rule would have
  given cheaply — but that rule was tried and **reverted** (object names are too numerous to
  reserve; `let count` collides with an object), so the emitter tracks scope instead.
- **Phase 2b — `self` capture (not built).** `env:{self}` plumbing + the `{$ref}` round-trip
  + the runtime freeze-on-unserializable-capture fallback. Adds rule-assigned templates that
  read `self` fields (change-handler `self` persists; action/relation `self` freezes, since
  it isn't a serializable named instance). Reaches full I7 parity.
- **The compile warning** for a field assigned an unpersistable (frozen) template is still a
  follow-up (freeze is already the behavior; the warning would just make it loud).

Phases 1–2a cover what real games store (descriptions, refusals, `feels` — over
globals/named-instance state); 2b is the last parity increment.

## Open questions

- **`self` in construction templates.** Today it's unsupported (`emitter.js:604`). If Phase
  2's factory mechanism makes `self` cheap, should construction templates gain `self` scope
  (env `{ self: <the object being built> }`)? Orthogonal, but the machinery would allow it.
- **Action-context templates** (`[the noun]` analogues) assigned to fields: freeze (matches
  I7) vs. reject at compile time. Leaning freeze + warn.
- **Overhead.** Branding every template literal (even transiently-printed ones) adds an `id`
  and an `env` object per `makeText`. Negligible, but note it.
- **`--encode-strings`.** Template literal prose still lives in the emitted factory bodies,
  so the encoder sees it exactly as before; the registry indirection doesn't change what is
  encodable. Confirm no regression.

## Relationship to Option A (the stopgap)

Option A (skip `text` fields on capture, preserve them on restore) is a smaller change that
fixes undo and same-process/relaunch restore **for games that never reassign a text field**
(all of advent + phobos). Its gaps — runtime reassignment (the `[FOO]` example) and
runtime-created text-fielded objects — are exactly what this spec closes. If the Phobos demo
must ship before this lands, Option A is a valid stopgap **provided** the compiler rejects
(or warns on) runtime text-field assignment, so the restriction is explicit. Otherwise this
(Phase 1) is the target.
