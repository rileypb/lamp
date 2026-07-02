# Lamp Code Review — 2026-07-01

Scope: `src/lantern`, `src/lamplighter`, `src/lighthouse`, and `lib/` (sys, en-US,
fr-FR, advent, conversation). Tests were consulted only for context. Per the review
brief: no style findings; the focus is design/layering, duplication, code that
should be Lamp rather than JS, and missing features — especially features that
would let more code move from JS into Lamp.

Findings already recorded as resolved in `devdocs/architecture.md` (issues A–G) are
not rehashed. Where the architecture doc explicitly *accepts* a coupling (the IF
action model in the compiler, the runtime-owned Game Parser), this review flags
only deviations from that documented position, not the position itself.

Severity: **[H]** worth fixing soon, **[M]** worth scheduling, **[L]** note/opportunistic.

---

## 1. Layering and separation of concerns

### 1.1 [H] The Game Parser reads the `player` global, violating the documented contract
`resolveCandidates` resolves the self-words "me"/"myself" via
`getGlobal("player")` (`src/lamplighter/index.js:859`). The world-model contract
block at the top of that same file — and architecture.md issue C — states the
engine assumes **no** library-specific name and that "the commanding actor is
passed into run_command, not read from a player global." The actor *is* already
threaded through `runCommand → resolveSlots`; it just isn't passed one level
further into `resolveCandidates`. Besides the contract drift, it's a behavior bug
in waiting: if an NPC actor ever runs a command, "me" resolves to the player, not
the acting NPC. Fix: thread `actor` into `resolveCandidates` and resolve
`SELF_WORDS` to it. (The comment at `index.js:786` argues "me" should follow a
reassigned protagonist — that is exactly what resolving to the actor gives, since
the library passes `player` as the actor.)

### 1.2 [H] Parser prose and vocabulary sit below the locale layer, inconsistently
The runtime routes two parser failures through the overridable message registry
(`parser_cant_see`, `parser_no_understand`) but hardcodes the rest as English:

- `"I don't know what \"X\" refers to."` — two sites (`index.js:1012`, `index.js:1077`), not `message()`-routed.
- The disambiguation prompt `Which do you mean: the A or the B?`
  (`printDisambiguationPrompt`, `index.js:894`) — hardcoded English article
  ("the "), list phrasing, and its own proper-name logic.
- The vocabulary sets `ARTICLES` (a/an/the/some, `index.js:747`), `PRONOUNS`
  ("it", `index.js:752`), `SELF_WORDS` (me/myself, `index.js:786`).

A fr-FR game currently gets French action messages but English disambiguation
prompts, and its players cannot type "le manteau". The clean shape already exists
in this codebase: `setListFormatter` is a locale-installed seam. The same pattern
fits here — a locale-installed "parser prose" hook (definite-article rendering for
the prompt) and locale-registered article/pronoun/self-word sets. Until then, at
minimum route the two hardcoded failure strings through `message()` like their
siblings.

### 1.3 [M] The documented runtime↔world contract understates the real surface
The contract block (`index.js:46-70`) lists four names (`contains`, `physical`,
`succeeded`/`failed`, `startup`). The runtime actually also hardcodes, each
documented only at its use site:

- object fields: `understand`, `private_name` (`buildVocabIndex`, `index.js:804`),
  `printed_name` (`objectDisplayName`, `formatValue`), `proper` and the
  `article.name === "proper"` enum convention (`isProperNamed`, `index.js:890`)
- globals: `player` (1.1 above), `undo limit` (`undoLimit`, `index.js:2151`),
  `act` (`runAction`, `index.js:537`; also skipped by the globals state provider)
- types/fields: `game` + its `author` field (`gameInfo`, `index.js:2194`)

None of these is necessarily *wrong* (they follow the D1 "IF runtime by design"
decision), but the contract section is the place a world-library author looks, and
it's incomplete. Either extend the contract block to enumerate them, or move the
ones that are presentation policy (1.2's vocabulary, `isProperNamed`) behind
locale/library seams so they stop being contract at all.

### 1.4 [M] The compiler validates lib/advent's door model — and the check is duplicated at runtime
`checker.js:529-563` hardcodes advent's ten direction field names
(`DOOR_DIRECTION_FIELDS`) and enforces "exactly two sides" at compile time. This
is a *library* invariant living in the *compiler* — the one place where the
accepted IF coupling reaches past the action/band machinery into a specific
library's world model. Moreover `wire_doors` in `lib/advent/index.js:54-70`
already re-checks the same invariant defensively at startup, so the rule is
implemented twice in two layers. The doc comment acknowledges this as the
"option A trade-off" pending a general library-contributed consistency pass
(TODO item 7 / door follow-up B). Recommendation: raise the priority of that
consistency-pass seam; when it lands, this is the first check to move out, and
`wire_doors`' runtime guard becomes the single library-owned fallback.

### 1.5 [M] Lighthouse re-derives game identity by scanning source — and gets it wrong
`extractGameMeta` (`src/lighthouse/index.js:53-81`) tokenizes the user file and
scans for `game NAME:` and `author "..."`. This is a third, independent
game-identity mechanism (alongside the compiler's `hasGameObject` and the
runtime's `gameInfo`), and it has already drifted: it reads only the game's
*identifier*, not the `title` display field that `lib/sys/types.lamp:8` defines
precisely because identifiers can't hold spaces/punctuation — so a game with
`title "Phobos - A Galaxy Jones Story"` gets the identifier in its page
`<title>` unless it also has no `title`. (The Phobos TODO entry says the banner
title works — that's the in-game banner; the HTML title path is this separate
scan.) Fix: have Lantern emit a small metadata sidecar (name/title/author,
already parsed correctly) that Lighthouse reads, instead of re-scanning source
with a lossy line heuristic. That also removes Lighthouse's dependency on the
Lantern tokenizer internals.

### 1.6 [M] Two mechanisms for meta-verbs: grammar actions vs. string-compares in the loop
UNDO/SAVE/RESTORE/SCRIPT are proper `out_of_world` Lamp actions resolving through
the one grammar path (the 2026-06-30 unification, done well). But QUIT, RESTART,
and the end-of-story RESTORE are recognized by `to_lower(line) == "…"`
string-compares in `lib/advent/startup.lamp:1-33` — a second, parallel
recognition mechanism with its own synonym handling (`q` but not `exit`;
`is_restore_command` duplicates the restore action's verb word, so renaming one
silently strands the other). The session-control rationale (they unwind the loop)
is real, but the *recognition* could still go through the grammar: an
out-of-world `quit`/`restart` action that sets a session flag the loop reads,
keeping one vocabulary path and making the words overridable/localizable like
every other verb. (The fr-FR pack currently cannot translate QUIT/RESTART at all.)

### 1.7 [L] Two parallel proper/plural mechanisms, one of them triple-implemented
Objects can be marked proper/plural either by boolean fields (`proper`,
`plural` — what the locales document as the contract) or by advent's
`article` enum objects (`article proper`, `lib/advent/globals.lamp:13-16`).
Both are honored, by *three* separate implementations: `isProperNamed` in the
runtime (`index.js:890`), `is_proper`/`is_plural` in `lib/en-US/index.js:35-41`,
and again in `lib/fr-FR/index.js:34-40`. Pick one canonical representation
(the boolean fields look like the intended one), migrate advent's `article`
enum to it, and delete the back-compat branches. The runtime copy disappears
entirely if 1.2's locale seam takes over the disambiguation prompt.

### 1.8 [M] The `gender` field has two incompatible vocabularies
advent declares `physical.gender` with default `"masculine"` and documents
masculine/feminine (`lib/advent/types.lamp:27-30`, aimed at fr-FR articles).
en-US's `gender_of` (`lib/en-US/index.js:121`) recognizes only
`"male"/"female"/"neuter"`; fr-FR's `is_feminine` accepts
`"feminine"/"female"/"f"`. Consequence: `gender "feminine"` yields "la" in French
but "it" in English; `gender "female"` happens to work in both only because
fr-FR added an alias. The world-model→locale contract needs one canonical value
set (accept both spellings in both locales, or standardize and document one).

---

## 2. Duplication of functionality

### 2.1 [M] Action-selector resolution: checker and emitter each have a full copy — DONE (2026-07-02)
`resolveSelectorActions` (checker) and `resolveSelector` (emitter) implemented the
identical set algebra over the identical schemas, acknowledged as "kept separate" —
but they could drift, and the checker's copy existed only to report before emission.
**Extracted** to one `src/lantern/selector.js` `resolveSelector(node, actionNames,
tagMembers, makeError)`; both passes call it with their own universe/tag maps and an
error factory (checker's `typeError`, emitter's bare `emitSelectorError`), so each
keeps its diagnostic format while the algebra lives once. Suite byte-invariant (209).

### 2.2 [L] The `[slot]`/literal template splitter exists in both compiler and runtime
`parseTemplateParts` (`src/lantern/index.js:310-315`) and `parseGrammarTemplate`
(`src/lamplighter/index.js:581-586`) are the same function (the runtime one adds
`toLowerCase`). They parse the same template language (relation syntax vs. action
grammar). Not shareable across the compile/runtime boundary as-is, but worth
noting as the same mini-grammar defined twice — if the template syntax ever grows
(optional words, alternations), both must change in lockstep.

### 2.3 [L] Vocabulary derivation written twice in the runtime
`buildVocabIndex` (`index.js:804-829`) and `objectVocab` (`index.js:871-881`)
duplicate the name-token + `understand`-token derivation (including the
`private_name` rule). `buildVocabIndex` should iterate `objectVocab(obj)`.
Today a change to tokenization (say, hyphen handling) must be made twice or
disambiguation answers stop matching what the index matched.

### 2.4 [L] `runCommand` duplicates the "commit an action" sequence
The checkpoint/advance/run/return-`!oow` block plus the direct-slot antecedent
update appears twice — once in the disambiguation continuation
(`index.js:1000-1008`) and once in the main grammar loop (`index.js:1057-1064`).
Extract a `commitAction(actionName, instance)` helper; the undo/turn policy then
has one home.

### 2.5 [L] The sandbox broker protocol is implemented twice per side
`worker.js` and `worker-browser.js` duplicate the Atomics input/save/transcript
channel installs almost verbatim (the only real difference is
`parentPort.postMessage` vs `self.postMessage` and the browser's two extra picker
methods); `host.js` and `shell.js` likewise duplicate `deliverLine`/`replySave`.
A shared channel module parameterized on `postMessage` would keep the wire
protocol defined once. Low urgency, but this is the protocol most likely to grow
(the TODO already plans `-1`/`-2` sentinels — a change that today lands in four
files).

### 2.6 [L] Two idioms for `report failed` reason dispatch in lib/advent
`actions.lamp` uses `if self.reason == X: … stop` ladders for take/drop/wear/…
but `when self.reason == X:` rule guards for attack/push/pull/give/show/enter.
Both work; having both means a contributor learns two patterns and games copy
whichever they saw first. The guard form composes better with author overrides
(an author rule with the same guard runs first and can suppress). Worth picking
one in the library so it reads as the blessed pattern.

---

## 3. Code that can be Lamp today (rule 3)

### 3.1 [M] `wire_parts` is expressible in pure Lamp now
`lib/advent/index.js:75-87` loops `physical.all`, queries
`part_of part ?all`, and asserts `contains whole part` — every step exists in the
language (`for x in physical.all`, relation value-queries, custom-syntax
assertions with locals in statement position). This can move to
`lib/advent/parts.lamp` as:

```
on started:          # or called from startup
    for p in physical.all:
        for w in part_of p ?all:
            contains w p
```

(modulo where startup ordering hooks it — the current call site is the `on
startup` handler, which is Lamp already). This is exactly the "prefer Lamp,
let gaps drive features" policy; here there is no gap.

### 3.2 [L] `holder()` could be a Lamp one-liner
The parser fixtures already do `function physical holder(physical x): return
contains ?only x`. advent instead declares a native backed by `containerOf`
(`lib/advent/index.js:4-6`). The native is defensible (single containment seam
shared with the engine's `scopeOf`), but if the goal is maximizing Lamp, this is
free. Keep whichever, but record the decision — right now the fixture idiom and
the library idiom differ for no stated reason.

### 3.3 [L] Locale prose assembled in JS could be locale `.lamp`
`contained_phrase` and `supporter_phrase` (`lib/en-US/index.js:276-289`) are pure
prose assembly ("On [the s] [are …] …") with no capability the template language
lacks (`the()`, `are(n)`, `format_list` are all callable from Lamp). Moving them
to `lib/en-US/functions.lamp` as Lamp functions would make the locale's prose
directly readable/editable by authors and shrink the native surface. The
irregular tables (plurals, verbs, numbers) stay JS until Lamp has a map type
(see 4.1d).

### 3.4 [L] The rest of `lib/advent/index.js` is blocked on §4 features — by design
`contents_of`, `listable_contents`, `is_container`, `describe_supporters`,
`wire_doors`, and the debug dumps are natives because Lamp lacks list filtering,
a type-membership test, and dynamic field access. That's the intended
gap-driven-features loop working; §4.1 lists the unblocks. The debug
introspection natives (`describe_object`, `world_tree`) legitimately need
runtime reflection and should stay native.

---

## 4. Missing features (rule 4)

### 4.1 Features that would move JS → Lamp
These four unblock nearly everything left in `lib/advent/index.js`:

- **(a) List filtering / building.** There is `map_strings` and a list literal,
  but no filter and no append — so any "the items in r that aren't scenery"
  computation must be native. Either a `filter`-style native taking a predicate
  function (cheap, mirrors `map_strings`) or, better, list `append`
  (then filters are plain Lamp loops). Unblocks `contents_of`,
  `listable_contents`, `describe_supporters`, and most future world queries.
  Note: the comment at `lib/sys/functions.lamp:24-25` ("Lamp has no list
  literal") is stale — the parser has `ListLiteral` — but *append* is still
  genuinely missing.
- **(b) Type-membership test.** `x is container` (or `is_a(x, container)`)
  exists only as the runtime's `isTypeOrSubtype`. Its absence forced the
  `is_container` native and forces games to mirror type knowledge in booleans.
  This is a small checker/emitter feature with outsized library payoff.
- **(c) Dynamic field access.** `wire_doors` exists in JS because it reads
  `door[dirName]` over ten direction names. Indexed field access
  (`x[fieldNameString]`, checked loosely) or an idiomatic alternative
  (iterating a relation instead of ten fields) would let the door wiring be
  Lamp.
- **(d) A map/dictionary value type.** The locale packs' irregular tables
  (plurals, verb forms, ordinals, number names) are the main remaining JS
  data. With a map kind these become Lamp data files a translator can edit
  without touching JS.

Also: **string helpers** — only `length`/`char_at`/`code_at`/`substring` exist;
no `index_of`/`contains`/`starts_with`/`replace`. Games doing free-text `say`
handling (lib/conversation) will re-implement these in loops.

### 4.2 i18n features
- **(a) Parameterized named messages.** The rule that a named message may
  reference only `act`/globals forces the fragment splits —
  `room_contents_intro` / plain print / `room_contents_outro`
  (`lib/advent/rooms.lamp:69-71`), the inventory `(worn)` split, and the
  door-closed message that can't be named at all
  (`lib/advent/doors.lamp:46-52`, acknowledged in-file as an i18n gap). Worse
  than wording, the *order* of fragments is fixed in code, so a language that
  needs a different word order around the interpolated list cannot express it.
  Messages that accept arguments (`room_contents: "…[the list]…"` with the list
  passed in) would fix wording, order, and the door gap in one feature.
- **(b) Locale-owned parser vocabulary + prompt seam** — see 1.2.
- **(c) Localizable session-control words** (QUIT/RESTART) — see 1.6.

### 4.3 Validation gaps (compile-time checks that are missing)
- **(a) Unknown function calls compile.** `checkCallStatement`/`checkExprCalls`
  return silently when the name isn't in the schema (`checker.js:702`,
  `checker.js:772-776`). Since natives must be declared, the full callable set
  *is* known at compile time; a typo'd call should be a compile error, not a
  sandbox `ReferenceError` at runtime (the same class of failure issue B fixed
  for native declarations).
- **(b) `text` is missing from the emitter's primitive set — likely latent bug.**
  Checker `PRIMITIVE_TYPES` includes `"text"` (`checker.js:3`); emitter
  `PRIMITIVE_TYPES` does not (`emitter.js:432`). So `valueIsObjectRef`
  (`emitter.js:478`) classifies a plain string assigned to a `text`-typed
  field/param/slot as an *object reference* → `checkedGetObject` → spurious
  "unknown object" compile error (or a wrong object lookup if the prose matches
  an object name). Nothing in lib/ declares a `text` field yet, which is why it
  hasn't bitten. Same family: runtime `PRIMITIVE_ZEROS` (`index.js:116`) lacks
  `text`, so an unset declared `text` field would print `undefined` rather than
  "". Align all three sets.
- **(c) `checkExprCalls` doesn't recurse everywhere.** Its key list
  (`checker.js:786`) omits `object` (MemberAccess) and `elements`
  (ListLiteral), and TemplateLiteral parts are never walked — so
  `let xs = [f(1,2,3)]` and calls inside `(g(x)).field` or `"[f(1,2)]"` skip
  arg-count checking. A generic child walk (like `collectPropertyAccess`'s)
  would close the class.
- **(d) Global types aren't used in inference.** `inferExprType` returns `null`
  for `GlobalExpr` (`checker.js:958`) even though `buildGlobalTypeSchema` has
  the declared types. Threading globals into inference would catch a whole tier
  of errors (`score + "x"`, wrong-typed args from globals) that currently pass.
- **(e) Cross-namespace name collisions are unchecked.** Objects, types, kinds,
  relations, and functions each emit a top-level `const`/`function` with the
  raw identifier (`emitter.js:608`, `emitter.js:259`); an object named the same
  as a type (or function) produces a generated-JS `SyntaxError` at load with no
  Lamp-level diagnostic. Cheap compile-time check.

### 4.4 Language/library gaps already implicitly acknowledged in comments
Consolidating scattered in-code notes so they're tracked as features:

- **Type emission is source-order with no dependency sort** — the reason `door`
  and `backdrop` must live in `types.lamp` rather than their subsystem files
  (`lib/advent/types.lamp:68-70`, `:96-99`). A topological sort by parent in
  `emitProgram` removes a real authoring constraint on library file layout.
- **No `void` rulebook** — `every_turn_rules` is `bool` with an inert
  `default false` workaround (`lib/advent/globals.lamp:112-117`).
- **Library `lib` imports are silently inert.** `extractLibImports` scans only
  the user file (`src/lantern/index.js:281`), so the `lib advent` at
  `lib/conversation/conversation.lamp:1` does nothing — it *looks* like a
  dependency declaration and parses to a node the emitter ignores. Either make
  library-declared imports resolve transitively (dedup + order), or reject
  `lib` outside the main file so the file stops lying to readers.
- **LOCK/UNLOCK verbs** (noted in `actions.lamp` and the OPEN/CLOSE TODO),
  **enterable supporters/vehicles** (`enter` fails by default), and the
  **half-modeled light system** — `physical.lit` exists but has no illumination
  effect (`types.lamp:47-50`); darkness is room-level only, so a lit lantern in
  a dark room still prints "pitch dark". Fine as staging, but `lit` shipping
  with no semantics is the kind of half-feature that surprises game authors.

---

## 5. Runtime design notes

### 5.1 [M] Scope computation is re-done per grammar candidate and is quadratic — DONE (2026-07-02)
`scopeOf(actor)` was recomputed for every structurally-matching grammar entry in
`runCommand`'s loop, and each `scopeOf` scanned all `contains` edges per instance
(via `queryRelation`) inside a fixpoint — worst-case O(instances² × edges) per
command. **Fixed (both landed):** (1) `runCommand` computes the actor's scope once
and memoizes it across candidates (`actorScope()`), sound because no action runs —
so the world can't change — until a candidate resolves and returns; world-scope
actions keep their own pool. (2) `scopeOf` builds a `target → container` Map once
(`buildContainmentIndex`; the `contained` endpoint's `unique` invariant makes the
Map exact) and `containerOf(inst, index)` answers O(1) from it, dropping the ×edges
factor. The index is built fresh from the edge list each scope computation rather
than maintained in `addRelation`/`removeRelation`, so it can't drift from the edges
(and doesn't couple to the direct-manipulation snapshot-restore path); one-off
`containerOf` callers omit the index and keep the query path. **Still optional:** the
fixpoint remains O(instances) passes (no ×edges now) — a BFS over a container→contents
index would make it linear, but it's invisible at Phobos scale. Suite byte-invariant.

### 5.2 [L] `encodeValue` can't snapshot a relation edge held in a value
An anonymous edge (from a query result) stored in a global or field throws
"cannot snapshot value" at the next checkpoint (`index.js:1786-1789`) — i.e. a
legal Lamp program (`global object exit_edge`, assigned from `connects … ?first`
… of a *named* edge is fine, an anonymous one isn't) breaks UNDO. Either give
edges a serialization ($edge by type+fields) or document the restriction in
state.md and fail with a message naming the global/field.

### 5.3 [L] `formatValue` can return non-strings into the stream layer
`formatValue` returns numbers (and `undefined` for unset reference fields)
verbatim; `streamWrite`/`streamEmitRun` then rely on JS coercion quirks
(`run.length` on a number is `undefined`, which happens to behave). It works,
but the stream layer's invariants ("run is a string") are maintained by
accident. `return String(value)` at `formatValue`'s tail makes it deliberate.

---

## 6. Reviewed and found sound (no action)

- **Compiler pipeline shape** (tokenize-once → token prescan → RD parse →
  check → emit) is clean; the prescan/parser name-set handshake is well
  contained and the A–G fixes hold.
- **Mechanism/policy split** for save/undo/restore/transcript/status —
  runtime primitives + lib-owned verbs/wording — is consistently executed and
  is the right pattern; the state-provider and scope-provider/barrier
  registries keep the engine extensible without edits.
- **Sandbox model** (vm context / browser Worker, brokered capabilities over
  SharedArrayBuffer, denied-by-default globals) is coherent across dev and web,
  and Lighthouse correctly packages rather than reimplements it.
- **Three-layer text split** (engine mechanism / lib/sys stream / locale data)
  holds up well in the code, modulo the §1.2 parser-prose leak and §3.3.
- **strcodec** is honest about being obfuscation, used consistently for both
  prose encoding and save blobs.

---

## Suggested order of attack

1. §1.1 actor threading (small, fixes a contract violation and a latent bug).
2. §4.3b `text` primitive-set alignment (three one-line set edits; latent compile bug).
3. §1.2 message-routing for the two hardcoded parser strings (small), then the
   locale prompt/vocabulary seam (larger, schedule).
4. §4.3a unknown-function compile error + §4.3c walker completeness (checker hardening).
5. §3.1 port `wire_parts` to Lamp; decide §3.2 (`holder`).
6. §4.1a/b (list filter/append + `is` type test) — the biggest JS→Lamp unblock.
7. §2.1/§2.3/§2.4 duplication extractions, opportunistically.
