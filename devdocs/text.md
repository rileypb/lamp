# Text Substitution — Feature Catalog (candidates)

> Status: **in progress.** This file enumerates the text-substitution features
> modeled on Inform 7's "[bracketed]" text, plus additions specific to Lamp, and
> the triaged Action list that follows. **Slices 1–3 are DONE**: bracket
> substitution + the Inform quote convention + the lazy `text` type/`freeze`
> (Slice 1); the `lib/en-US` locale pack — articles, case, list prose, pluralizer
> (Slice 2); and the adaptive engine — render context, pronouns, verb conjugation,
> `[regarding]` (Slice 3). See "Action list → Slices 1–3". Slice 4 (variation &
> conditionals) is next. Later slices remain candidates. Items are grouped by
> category; each notes its Inform 7 parallel (chapter 5 of *Writing with Inform*,
> sections cited as `WI 5.x`) and Lamp-specific notes.
>
> Treating this as **greenfield** — `devdocs/specs.md` covers `print`/string
> literals but not interpolation. See "Current state" for the baseline this builds
> on. When items here are promoted to implemented behavior, fold the settled
> design into `specs.md` and reduce this file to the still-open candidates.

## Purpose

The `"[We] [drop] [the velvet_cloak]"` style is to be the **foundation** of all
generated, player-facing text in Lamp: a literal string carrying inline
substitutions that are resolved against the world model, the current action, and
the runtime at print time. Lamp aims for a *more mature* text-manipulation layer
than Inform, but this bracketed form is the base primitive everything else
composes from.

Reference: Inform 7 — *Writing with Inform*, chapter 5 ("Text"),
https://ganelson.github.io/inform-website/book/WI_5_1.html and the sections that
follow it.

## Current state (the baseline)

What exists today, that a substitution system must integrate with or supersede:

- `print EXPRESSION` is the only output statement; blank `print` prints a blank
  line (`devdocs/specs.md` → Statements).
- Text is built by **`+` concatenation** of strings and values
  (`print self.name + " moved to " + self.holder.name`).
- **Value→text rules already in the runtime:** objects print as their `name`;
  lists print as human-readable strings joined with `,` and `and`, honoring the
  author-settable `oxford_comma` global. These are the seeds of substitution
  semantics (article/agreement/serial-comma logic belongs in the same place).
- String literals support escapes `\\ \" \n \t \r` plus the `\_` literal
  underscore; any other `\X` is left verbatim (`src/lantern/tokenizer.js`).
- `--encode-strings` wraps prose literals (and several name kinds) as
  `lamplighter.decode("…")` at build time. **Any substitution syntax must survive
  encoding** — see "Cross-cutting concerns."
- `it`/`him`/`her`/`them` pronoun antecedents are tracked by the parser (the
  `direct` slot); a `[the noun]`/pronoun substitution should read the *same*
  antecedent state, not a parallel one.

There is no `[...]` interpolation in strings today. `[` and `]` are currently
ordinary literal characters inside a string — introducing bracket substitution is
a **syntax change** to string literals (escape hatch required; see below).

## Design principle: expressions, plus a natural-language sugar layer

There are two layers, and the **sugar layer is where the design work is** — the
bare-expression layer is mostly a given:

1. **Any Lamp expression** may appear in brackets, rendered by the runtime's
   existing value→text rules. `"[score]"`, `"[self.actor.holder.name]"`,
   `"[connects Foyer north ?only]"`, `"[(contains box ?all).size]"` all simply work
   because they are ordinary expressions printed in place. This needs no special
   vocabulary and is not worth calling out case by case.
2. **A curated natural-language sugar vocabulary** layered on top — the part
   actually modeled on Inform 7. These are the IF idioms worth importing because
   they read well in prose and would be clumsy written as raw calls: articles
   (`[the velvet_cloak]`, `[a apple]`), capitalized forms (`[The velvet_cloak]`),
   pronouns and adaptive verbs (`[We] [drop] [the velvet_cloak]`), and the inline
   control words (`[if …]…[else]…[end]`, `[one of]…[at random]`,
   `[first time]…[only]`). Each sugar form is shorthand for an ordinary library
   call — `[the velvet_cloak]` ≡ `the(velvet_cloak)` — so an author can always drop
   to the explicit function when the argument must be computed, but the natural
   form is the one to reach for.

We deliberately import only the parts of Inform's natural-language approach that
earn their keep; we do **not** emulate all of it. `[number of things in the box]`,
for instance, is just `[(contains box ?all).size]` — an expression, no sugar
needed. New sugar can be added later; because the expression layer is always
available, nothing is blocked on it. Each bullet below leads with the form to
reach for (natural sugar where one is proposed, a plain expression otherwise) and
notes the explicit-call fallback. The article/pronoun/verb tables live in `lib`,
not the engine. Where a proposed expression needs a primitive that doesn't exist
yet — e.g. list `.size`/`.count` (today a list value exposes only `.first`) — that
gap is **flagged as a new primitive**.

---

## A. Core substitution syntax (`WI 5.1`)

- **A1. Bracketed substitutions in string literals.** Inform: `"[score]"`.
  **Lamp:** identical surface, but the brackets hold a Lamp **expression** —
  `"[score]"`, `"[self.actor.holder.name]"`, `"[double(score)]"`. Splices the
  rendered value into the surrounding literal. The base primitive.
- **A2. Literal brackets.** A way to print a literal `[` and `]` (Inform: `[bracket]`
  / `[close bracket]`; Lamp could instead use `\[` / `\]` escapes — decide once).
  - Use `\[`/`\]`.
- **A3. Compile-time template parsing.** Parse each literal into a sequence of
  *literal segments* + *substitution calls* at compile time, not by scanning the
  string at runtime. Yields better error messages (unknown substitution caught by
  the checker) and lets `--encode-strings` encode only the literal segments.
- **A4. Whitespace/line handling inside brackets** — leading/trailing space rules,
  and whether a bracketed substitution may span lines.
- **A5. Quotation marks & apostrophes in prose** (`WI 5.2`). Inform's literal-quote
  conventions (`[']`, smart-quote substitution). Lamp may not need the apostrophe
  rule but should decide on smart vs. straight quotes.
  - use quote rules exactly as Inform does. i.e., `print "'fo[']o'"` prints `"fo'o"`.

## B. Naming values & objects (`WI 5.3`, `WI 5.5`)

- **B1. Value interpolation.** Inform: `"[score]"`. **Lamp:** `"[score]"`,
  `"[turn_count]"`, `"[self.noun.name]"` — any expression (global, local, field,
  call), rendered by the runtime's existing value→text rules.
- **B2. Object name.** Inform: `"[the noun]"` / `"[printed name of the noun]"`.
  **Lamp:** `"[velvet_cloak]"` / `"[self.noun]"` — a bare object expression prints
  its `name`, the same way `print` already renders an object. Overridden when a
  `printed_name` field is set on the object (the displayed-name escape hatch).
- **B3. Definite article.** Inform: `[the noun]`. **Lamp (sugar):** `[the
  velvet_cloak]` → "the velvet cloak" — `the` is an article word over a bare object
  reference, *not* a function call. Explicit fallback when the object is computed:
  `[the(self.noun)]`.
- **B4. Indefinite article.** Inform: `[a noun]` / `[an noun]`. **Lamp (sugar):**
  `[a apple]` → "an apple" — the single word `a` picks "a"/"an" by vowel sound (with
  a per-object override), so the author never writes `an`. Explicit fallback
  `[a(self.noun)]`.
- **B5. Capitalized articles.** Inform: `[The noun]` / `[A noun]`. **Lamp (sugar):**
  `[The velvet_cloak]` / `[A apple]` — the capitalized spelling of the article word
  is recognized by the template parser (shorthand for `cap(the(…))`, C1). Same
  capitalization mechanism as the capitalized pronoun forms in D.
- **B6. Proper-named objects.** Inform: proper-named things take no article.
  **Lamp:** `[the alice]` renders "Alice" unchanged — the article sugar consults a
  world-model proper-named flag and emits no article, never lowercasing. Parallels
  `lib/advent`'s `name`/room handling; the flag lives on the world model, not in
  prose.
- **B7. Plural-named objects.** Inform: "[the] scissors **are**". **Lamp:** a plural
  flag on the object that the article sugar and the agreement helpers (G3, D3) all
  read — `[the scissors] [are] here` (the verb `[are]` agreeing via the plural
  subject, §D3).

## C. Case control (`WI 5.4`)

Case is the clearest example of "no sugar needed" — plain Lamp functions beat
Inform's natural-language phrasing here (Inform's `[the apple in upper case]` is
just `[upper(apple)]`). The capitalized *article/pronoun* spellings (B5, D1) are
the one cased sugar, because they ride along with words that are already sugar.

- **C1. Capitalize first letter.** Inform: `[The noun]` and similar cased forms.
  **Lamp:** a `cap(EXPR)` function — `[cap(self.noun.name)]`; the capitalized
  article/pronoun sugar (B5, D1) is shorthand for `cap(…)`.
- ~~**C2. Sentence-initial auto-capitalization** — optionally capitalize the first
  printed glyph of a sentence automatically, so authors needn't pick the cased
  variant by hand.~~ CUT
- **C3. All-caps / lowercase.** Inform: `[the apple in upper case]`. **Lamp:** a
  plain function — `[upper(self.noun.name)]` / `[lower(x)]`. No sugar.
- **C4. Title case.** Inform: title-cased headings. **Lamp:** a plain function —
  `[title(here.name)]` for room banners. No sugar.

## D. Adaptive verbs & pronouns (`WI 5.6` — the "[They] [verb]" engine)

This is the heart of the request and the most valuable piece.

This pronoun/verb sugar is the **core of the natural-language layer** (Design
principle, layer 2). Each word reads an *implicit subject* — the action's actor by
default, or one named by `[regarding EXPR]` (D5) — and is shorthand for a library
call, so the explicit function form is always available. **Bracketed pronouns
always print as pronouns**, never silently as a name; to print an actor's name you
use an ordinary reference (`[the self.actor]`), not a pronoun word.

- **D1. Subject vs. third-person pronouns.** Inform: `[We]` / `[they]`. **Lamp:**
  two distinct words, both staying pronouns when printed:
  - `[We]` / `[we]` — the **subject** (the actor): prints "you" for the player
    (2nd person). Explicit form `[subject(self.actor)]`.
  - `[They]` / `[they]` — **third person**, referring to the current antecedent
    (the most-recently-named thing; the *same* `it`/`him`/`her`/`them` antecedent
    the parser tracks): prints "it" / "he" / "she" / "they".
  Example — `"[We] [have] [the self.taken]. [They] [are] [ours]."` with
  `self.taken = velvet_cloak` renders **"You have the velvet cloak. It is yours."**
- **D2. Object/possessive pronouns.** Inform: `[them]`, `[their]`, `[themselves]`.
  **Lamp (sugar):** `[them]` / `[their]` / `[themself]`, plus the subject's
  possessives `[ours]` / `[yours]` (as in D1's example). Explicit fallbacks
  `[object(self.actor)]`, `[possessive(self.actor)]`. All agree with the same
  subject.
- **D3. Verb conjugation.** Inform: `[drop]` → "drop"/"drops"/"drop". **Lamp
  (sugar):** `[drop]` / `[have]` / `[are]` conjugate against the implicit subject
  (or the `[regarding]` subject), also respecting the B7 plural flag. Explicit form
  `[conjugate(self.actor, drop)]`.
- **D4. Irregular verbs.** Inform: built-in adaptive verbs. **Lamp:** a verb table
  for "is/are", "has/have", "does/do", "goes/go" — not just `+s` — living in the
  **locale pack** (`lib/en-US`), not `lib/sys`, so a different language swaps the
  whole table. A world/game library registers its own domain verbs into the active
  locale's table; the engine holds only the conjugation *mechanism*.
- **D5. `[regarding EXPR]`.** Inform: `[regarding the noun]`. **Lamp:**
  `[regarding self.noun]` — takes a Lamp **expression** naming the subject the
  following pronoun/verb words adapt to, when it isn't the default actor.
- **D6. Story tense.** Render adaptive text in past/present/future (Inform's "story
  tense"): `[We] [had jumped]`. DEFER until we add story tense
- **D7. Person setting.** Choose 1st/2nd/3rd person narration globally (Inform lets
  a story be told in any person); the player verbs adapt accordingly. DEFER until we add other person viewpoints
- **D8. Integration with action defaults.** Inform: `"[The actor] [take] [the
  noun]."` (where `[The actor]` becomes "You" or "Alice"). **Lamp:** the default
  report of a generic action becomes a template keyed on the actor as **subject** —
  `report take: print "[We] [take] [the self.noun]."` — which renders "You take the
  velvet cloak." for the player, with the verb agreeing automatically. Because
  `[We]` is a *pronoun*, it always prints a pronoun ("you"), never a name: Lamp does
  **not** fold Inform's name-or-pronoun behavior into a single token. When a report
  should name a non-player actor instead, that is an explicit reference
  (`[the self.actor]` → "Alice"), not a pronoun word. This keeps the rule simple —
  pronoun sugar stays pronouns — at the cost that a report cannot say both "You" and
  "Alice" through the *same* token; choosing pronoun vs. name is the author's, made
  explicit in the template. This is the payoff that justifies D1–D7.

## E. Conditional text (`WI 5.7`)

- **E1. Inline if/else/end.** Inform: `"[if dark]It is pitch black.[otherwise]…[end
  if]"`. **Lamp:** reuse Lamp's own keywords — `"[if dark]It is pitch
  black.[else]…[end]"` (accept `[otherwise]` as an alias if wanted). The condition
  is a Lamp boolean expression. KEEP but use `else` with optional `otherwise`
- **E2. else-if chains.** Inform: `[otherwise if …]`. **Lamp:** `[else if COND]`,
  mirroring statement-level `else if`.
- **E3. Boolean/relation conditions.** Inform: `[if the noun is in the box]`.
  **Lamp:** the condition is an ordinary Lamp boolean expression, including
  **relation queries** — `"[if contains box _]The box has something inside.[else]The
  box is empty.[end]"` — not a second mini-language. (`contains box _` is the
  existing boolean-query form: true when any matching edge exists.)
- **E4. Interaction with `print` vs. concatenation** — decide whether conditional
  text is only valid inside string-literal substitutions or also as an expression
  form. 

## F. Randomized & sequential variation (`WI 5.8`)

Text variety for repeated messages — high value for "interesting generated text."

Two surface options for Lamp, not mutually exclusive: an **inline sugar** for
prose ergonomics (alternatives written out as text/templates), and a **function
form** `pick(LIST, MODE)` for computed/queried lists. The MODE values below map to
either the trailing sugar word or the function's mode argument.

- **F1. Random.** Inform: `[one of] … [or] … [at random]`. **Lamp:** `"[one of]a
  spark[or]a flicker[or]nothing[at random]"`, or `[pick(sparks)]` over a list value.
- **F2. Purely random.** Inform: `[purely at random]`. **Lamp:** `[at random]`
  default avoids immediate repeats; `[purely at random]` / `pick(list, purely)` for
  independent uniform.
- **F3. Shuffled cycle.** Inform: `[in random order]`. **Lamp:** `[in random
  order]` / `pick(list, shuffled)` — no repeat until exhausted.
- **F4. Cycling.** Inform: `[cycling]`. **Lamp:** `[cycling]` / `pick(list,
  cycling)` — in order, wrapping.
- **F5. Stopping.** Inform: `[stopping]`. **Lamp:** `[stopping]` / `pick(list,
  stopping)` — advance, then stick on the last.
- **F6. Sticky random.** Inform: `[sticky random]`. **Lamp:** `[sticky random]` —
  random once, then fixed.
- **F7. Weighted.** Inform: `[as decreasingly likely outcomes]` etc. **Lamp:** a
  `pick(list, weights)` mode.
- **F8. Determinism hook (Lamp-specific).** A seedable RNG so randomized text is
  reproducible under golden tests and consistent across UNDO/SAVE. The per-site
  cycle/stopping/sticky **cursor state** and the RNG seed **must be captured by a
  state provider** (`devdocs/state.md`) or the text desyncs across undo/restore.
  Inform doesn't face this; it is a hard requirement here.
- **F9. First-time / once-only block.** Inform: `"[first time]…[only]"` — print the
  enclosed text the first time this site is reached and never again (and the
  general `[Nth time]` form). **Lamp:** keep the same `"[first time]…[only]"` sugar;
  it is the degenerate `[stopping]` case (run once, then nothing). Stateful like
  F4–F6: the per-site **visited flag/counter** is part of the same cursor state F8
  requires a state provider to capture, so `undo`/`restore` and golden replays stay
  consistent (without that, a restored game would re-suppress or re-show the block).

## G. Lists & quantities (`WI 5.3` list substitutions)

- **G1. List of a set.** Inform: `"[a list of things in the box]"` / `[the list of
  …]`. **Lamp:** `"[contains box ?all]"` — a `list<thing>` value already renders
  comma/`and` honoring `oxford_comma`. Articles via `"[a_list(contains box
  ?all)]"` / `"[the_list(contains box ?all)]"`.
  - Works for any query collection, including `"[connects here _ ?all]"` (exits).
- **G2. Count.** Inform: `"[number of things in the box]"`. **Lamp:** `"[(contains
  box ?all).size]"`. **New primitive:** a list `.size`/`.count` accessor — today a
  list value exposes only `.first` (`devdocs/specs.md`). This is the user's
  canonical example of the Inform→Lamp translation.
- **G3. Count-driven agreement.** Inform: `[is-are the contents]`. **Lamp:**
  `[are((contains box ?all).size)]` → "is"/"are" by count; helpers
  `that_those(n)`, `a_an(x)` (also reading B7's plural flag for object subjects).
  - I'm not decided on the syntax here. DEFER
- **G4. Numbers in words.** Inform: `"[score in words]"`. **Lamp:**
  `"[in_words(score)]"` → "five"; ordinal `"[ordinal(rank)]"` → "fifth".
- **G5. Grouped/qualified lists.** Inform: `[a list of … with definite articles]` /
  grouping → "two brass lanterns and a key". **Lamp:** a render mode on the list
  formatter (`group(query)` or `the_list(query, group: true)`) that collapses
  **indistinguishable** objects into one counted entry instead of repeating them.
  Concretely, listing `{lantern_a, lantern_b, key}` yields *"two brass lanterns and
  a key"* rather than *"a brass lantern, a brass lantern and a key"*. The pieces:
  - **Grouping key** — what counts as "the same". In the token-bag model, default to
    objects the player can't tell apart: same printed `name` (or same kind). Make it
    overridable (an explicit grouping field) so authors can split or merge.
  - **Count → quantity** — a group of *n* renders its count as a word (reusing G4's
    `in_words`) plus the **plural** name ("two brass lanterns"); a singleton group
    falls back to the indefinite article ("a key", B4).
  - **Pluralization** — needs a plural form: the B7 plural flag / a `plural_name`
    field, or an `+s` pluralizer backed by the K5 irregular table ("sheep").
  - **Composition** — the grouped entries then run through the ordinary serial-comma
    formatter (G1, `oxford_comma`), so grouping is one pre-pass over the list, not a
    separate code path.
  Open sub-decision: definite vs. indefinite grouped articles ("the two brass
  lanterns" vs "two brass lanterns") — a parameter on the render mode.
- **G6. Empty-list phrasing.** Inform: list fallbacks. **Lamp:** a `list<T>`
  already renders empty as "nothing"; add an `is_empty(list)` predicate and/or a
  fallback parameter (`the_list(q, empty: "nothing here")`).
- **G7. Plural suffix `[s]`.** Inform: `[s]` — prints "s" unless the governing
  count is 1. **Lamp (sugar):** keep `[s]` as a number-agreeing suffix keyed on the
  **most recently interpolated number** in the same template. So
  `"[We] [have] [bullet_count] bullet[s]."` prints **"You have 1 bullet."** when
  `bullet_count == 1` and **"You have 3 bullets."** when it is 3 — the `[bullet_count]`
  substitution sets a small render-time "governing count" that the following `[s]`
  (and the G3 agreement helpers) read, so no explicit argument is needed. An
  explicit-argument form `[s bullet_count]` is the fallback when the count isn't the
  most recent number, and `[es]` is the companion for "box[es]"-style stems. Ties to
  D3 (verb agreement) and G3 (count-driven agreement); the governing-count context
  is the same one G3 needs, so build them together.

## H. Layout / paragraph control (`WI 5.1`, `WI 5.9`)

- **H1. Explicit breaks.** Inform: `[line break]` / `[paragraph break]` / `[no line
  break]`. **Lamp:** `\n` already exists for hard line breaks; the new value is
  *paragraph* state — propose `[par]` (a paragraph break) and `[no break]` markers,
  distinct from raw `\n`.
- **H2. Run paragraph on.** Inform: `[run paragraph on]`. **Lamp:** `[run on]` —
  suppress the trailing break so the next print continues the line (heavily used by
  IF report rules; the runtime must track pending-break state).
- **H3. Conditional paragraph break.** Inform: `[conditional paragraph break]`.
  **Lamp:** `[par if printed]` — break only if something was printed since the last
  break.
- **H4. Spacing normalization** — collapse/avoid double spaces and stray blank
  lines from composed substitutions (a real pain point in IF output). Engine-side
  output filter, no surface syntax.
  - DEFER
- **H5. Indentation helpers** for nested/box output, given `pre-wrap` shell
  rendering (`devdocs/lighthouse.md` → Shell). **Lamp:** an `indent(text, n)`
  function rather than a control word.
  - DEFER

## I. Special characters & typography (`WI 5.2`)

- **I1. Unicode escape.** Inform: `[unicode 233]`. **Lamp:** a `\u{…}` string
  escape (fits the existing escape model in `tokenizer.js`) rather than a bracket
  substitution — `"caf\u{e9}"`.
- **I2. Named typographic entities** — em dash, ellipsis, curly quotes, non-breaking
  space. **Lamp:** prefer literal UTF-8 in source plus a few `\`-escapes
  (`\—`-style) over bracket words; only add `[entity]` words if literals prove
  awkward.
- **I3. Type styles** — `[bold type]`/`[italic type]`/`[roman type]`. **Gated by the
  output channel:** the web shell renders **text nodes only, never innerHTML**
  (`devdocs/lighthouse.md`), so styling needs a structured/markup-safe channel, not
  raw HTML in prose. Likely deferred; note the constraint now.
  - Let's figure this out soon. I'm a big fan of text styling, and I'll want to add it to a much greater degree than Inform does, as it's constrained by the Z-machine, and Lamp is not.
- **I4. Fixed vs. variable letter spacing** (Inform's `[fixed letter spacing]`),
  for ASCII art/tables — depends on shell capability.
  - ditto here. For style and spacing, etc., we need to have a fail-silently policy. The author can specify a script font, for instance, and if the outer shell can't comply, it will fallback to the safe alternative.

## J. Player/parser-derived text

- **J1. Player's command.** Inform: `[the player's command]`. **Lamp:** a
  `[player_command]` accessor/global — echo what the player typed.
- **J2. Matched text.** Inform: `[the topic understood]`. **Lamp:** a field on the
  current action / parse result, e.g. `[self.topic]` — matched-text snippets from
  the grammar.
  - DEFER until we have text results from parsing.
- **J3. Current-room / current-actor.** Inform: `[the location]`, `[the actor]`.
  **Lamp:** *no special sugar needed* — these are plain expressions:
  `[self.actor]`, `[self.actor.holder]`. (Exactly the payoff of the design
  principle: world state is reached with the ordinary expression language.)

## K. Authoring ergonomics (Lamp-specific extensions beyond Inform)

Where "more mature than Inform" can show up.

- **K1. Named text snippets / macros.** Author-defined reusable templates
  (`text greeting = "[The actor] [wave]."`) referenced by name — first-class text
  values, not just inline literals.
- **K2. Text as a first-class value & type.** A `text` (template) type distinct from
  `string`, so templates can be stored in fields, passed to functions, and
  late-rendered. Decide how this relates to the closed value algebra in
  `devdocs/state.md` (is an unrendered template a storable/saveable value?).
- **K3. Substitution functions.** This is the **realized core principle** (see
  Design principle): a substitution is just an expression that yields text, so it
  can call any author/library function — `[describe(self)]`, `[the(self.noun)]` —
  closing the loop with the language instead of a fixed substitution vocabulary.
  All of B/C/G's article/case/list helpers are instances of this.
- **K4. Composability with `+` and `print`.** Define precisely how a template
  literal interacts with existing concatenation so old `print a + b` code keeps
  working during migration.
  - in this case `a` and `b` need to be substituted first, and then composed.
- **K5. Per-object name overrides** for article/case/plural (the world-model flags
  B4/B6/B7 expose) — one place, consulted by every substitution.
  - we should have a table of some overrides like "sheep", and also allow overrides by the author.
- **K6. Localization seam (non-goal now, design not to preclude).** The verb/pronoun
  tables (D) are inherently language-specific, so they live in a **swappable locale
  pack `lib/<locale>`** (default `lib/en-US`), not in `lib/sys` or the engine — a
  non-English (`lib/fr-FR`) or British-English (`lib/en-GB`) pack drops in later by
  replacing that library. See "Library placement" under Open questions for the full
  three-layer split.

## Render context (shared per-render state)

Several sugar features need state *while a string is being rendered*, and the
obvious-but-wrong move is a global per feature (a "current subject" global, a "last
number" global, an RNG cursor). Don't: these have **different lifetimes**, and
conflating them breaks determinism. Separate them into three tiers — only the first
is the "render context" proper.

1. **Render-local context (ephemeral).** One object threaded through a single
   render pass, holding state meaningful only while a template renders and discarded
   afterward:
   - **current subject** — who `[We]` / `[They]` / `[drop]` agree with (D1–D5); seeded
     from the action's actor, overridden by `[regarding EXPR]` (D5).
   - **governing count** — the most recently interpolated number, read by `[s]` /
     `[es]` (G7) and the `is`/`are` agreement helpers (G3).

   Created at the **outermost** render boundary (a `print` of a template, or a
   top-level template value) and threaded into every nested substitution, so a
   `[regarding]` early in the string governs the verbs after it and `[bullet_count]`
   governs the `bullet[s]` after it. Reset per render; **never saved**. A nested
   render (a substitution that itself yields a template) shares the same context.

2. **Site-durable state (persisted).** Per-call-site state that must survive across
   turns: the `[cycling]` / `[stopping]` / `[sticky random]` cursors and the
   `[first time]` / `[Nth time]` visit counters (F4–F9), plus the RNG stream/seed
   (F8). Keyed by source location, **not** in the render context, and **captured by a
   state provider** (`devdocs/state.md`) so `undo` / `restore` and golden replays stay
   consistent. (This corrects the earlier offhand idea of putting "the RNG cursor" in
   the ephemeral context — an ephemeral cursor would re-shuffle after every restore.)

3. **Output-stream state.** Pending paragraph/line-break state for `[run on]` /
   `[par if printed]` (H2/H3) spans *multiple* prints, so it is neither render-local
   nor site-keyed: it belongs to the writer/output channel.

Placement follows the three-layer split: the context object and its plumbing are
**mechanism** (engine / `lib/sys`); the language data (pronoun/verb tables,
number-words) *reads* tiers 1–2 but doesn't own them. Today's Slice-1
`renderTemplate` is contextless (eager concat); the render context is introduced
with the first feature that needs it (D `[regarding]`, G `[s]`, or F variation), and
Slices 3–5 all build against it — so **design this object once, up front**, rather
than growing three ad-hoc globals.

## Cross-cutting concerns (apply to every item)

- **String-literal syntax change.** `[` and `]` are literal today. Introducing
  brackets needs an escape (`\[`/`\]` or `[bracket]`) and a tokenizer/parser update;
  migration must not silently reinterpret existing prose containing `[`.
- **`--encode-strings` compatibility.** Substitution must be parsed *before*
  encoding so only literal segments are encoded and the bracketed calls still
  resolve (the build already encodes grammar/relation templates — same discipline).
- **Determinism & state.** Any stateful substitution (F's cycling/random, story
  tense if mutable) must be captured by a state provider so UNDO/SAVE/RESTORE and
  golden tests stay reproducible (`devdocs/state.md`). Mind the lifetime tiers in
  "Render context" — render-local state is never saved, site-durable state always
  is; don't mix them.
- **Output-channel neutrality.** Substitution produces a value sent through
  `print`/`write`; styling/markup (I3) must not assume HTML — the dev stdio host
  and the web shell both take plain text.
- **Where the logic lives.** Article/pronoun/verb tables and list phrasing belong in
  **`lib`** (English is a library concern), with the engine providing only the
  substitution *mechanism* and value→text primitives — mirroring the
  runtime-vs-library split already used for the world model.

## Action list (derived from triage)

Re-derived from the keep/cut/defer marks above. Items not listed in a slice are in
**Deferred** or **Cut** at the end. Each slice is a shippable increment; later
slices depend on earlier ones except where noted.

### Decisions locked (from triage)

- **Literal brackets:** `\[` / `\]` escapes (A2) — no `[bracket]` word.
- **Apostrophes/quotes:** mirror Inform exactly — `[']` prints a literal apostrophe,
  so `"'fo[']o'"` → `'fo'o'` (A5).
- **`text` is a distinct first-class type**, separate from `string` (K2): a value
  that renders to text at print time and can be stored/passed.
- **Add a list `.size` accessor** as a general runtime primitive (G2) — small, useful
  beyond text, and a prerequisite for counts/agreement. Can land independently.
- **Sugar is a small, explicit vocabulary** (articles, pronouns/verbs, control
  words); everything else inside `[…]` is an ordinary Lamp expression. Add sugar
  incrementally — nothing is blocked on it.
- **E/F substitutions are literal-only** — valid inside string literals, not as
  standalone expressions.
- **Three-layer language split** (see "Library placement" under Open questions):
  the substitution *mechanism* is engine/`lib/sys` (language-agnostic, always
  present); the *language data* — pronoun words, conjugation rules, irregular
  table, a/an, number-words — is a **swappable locale pack `lib/<locale>`** (default
  `lib/en-US`), so it isn't unconditionally compiled in; world/game **vocabulary**
  (domain verbs) is registered into the active locale's table by the world/game
  library.

### Slice 1 — mechanism (no language awareness)

**Status: DONE (2026-06-21).** The whole bracket-substitution mechanism, the
Inform quote convention, and the lazy `text` type + `freeze` are implemented
end-to-end. Tests: `tests/fixtures/text1.lamp` (A1–A3, B1, B2, K4) and
`text2.lamp` (A5, K2) + their goldens; six parser unit cases + three reject cases
in `tests/parser`; `--encode-strings` parity verified for both; all 11 suites
green (120 goldens).

1. **A1/A3 — DONE.** A string literal *in value position* parses at compile time
   into a `TemplateLiteral` AST node (an ordered mix of `text` segments and
   parsed-expression segments). The split happens in the parser
   (`splitTemplate` + `parseStringExpr`/`parseEmbeddedExpression` in
   `parser_rd.js`), so grammar/`syntax`/`understand` templates — which take a
   different STRING path — keep their literal `[slot]` markers. Both expression
   position *and* field/global default values (`parseSimpleValue`) interpolate.
   Each embedded expression is parsed with the surrounding name scope; a malformed
   one is a compile error pointing at the host string's line.
2. **A2 — DONE.** `\[` / `\]` escape to literal brackets (resolved in
   `splitTemplate`; the tokenizer leaves them intact so the parser can tell a
   literal from a substitution). **A4 — partial:** the substitution source is
   trimmed; strings are single-line so spanning is N/A.
3. **A5 — DONE.** Inform's quote convention (`applyQuoteConvention`): a `'`
   between word characters stays an apostrophe (`don't`), any other `'` becomes a
   typographic double quote (`'hi'` → `"hi"`); `[']` forces a literal apostrophe.
   Applies to value-position literals only (not grammar templates). A repo scan
   confirmed all existing apostrophes are mid-word, so no prose changed.
4. **B1 — DONE** (any expression interpolates). **B2 — DONE**: an object renders
   as its `name`, overridden by a `printed_name` field when set (in `formatValue`).
5. **K2 — DONE.** A template is a distinct **lazy `text` value**: the emitter emits
   `lamplighter.makeText(() => renderTemplate([...]))`, a branded thunk that
   re-renders (re-evaluating its substitutions) each time it is printed/embedded;
   `formatValue` renders it transparently. The **`freeze EXPR`** keyword
   (`renderText`) forces a `text` to a concrete `string` snapshot. `text` is a
   declared primitive type (fields/params/returns), interoperable with `string`
   (checker). **Save:** a captured `text` is frozen to its current string in
   `encodeValue` (it is not a save-algebra value kind) — see `devdocs/state.md`.
6. **K4 — DONE.** A rendered template is an ordinary string at use sites, so it
   composes with `+`/`print` ("substitute, then compose"); `freeze` is the explicit
   text→string when a concrete string is needed.
7. **Cross-cutting — DONE.** `--encode-strings` encodes only the text segments
   (each emitted via `emitStringLiteral`); embedded expressions emit normally.
   Verified on `text1` and `text2`: encoded builds produce byte-identical output
   with no plaintext prose. The `[`/`]` migration is safe — a repo scan found no
   value-position string literal containing `[` (all are grammar templates).

**Slice 1 is fully closed.** Next: Slice 2 (names, articles, case), which needs the
`lib/<locale>` locale-pack scaffolding.

### Slice 2 — names, articles, case

**Status: B3–B7 + C1/C3/C4 DONE (2026-06-21); K5 pending.** `lib/en-US` is the
**default locale pack, auto-loaded after `lib/sys`** (`gatherLibDirs` in
`src/lantern/index.js` — the three-layer split is real: engine/`lib/sys` mechanism
vs. `lib/en-US` language data). The English list-prose formatter (`format_list`,
the "and"/Oxford comma) **moved from `lib/sys` to `lib/en-US`**. Fixture
`locale1.lamp` + golden; six parser article-sugar/quote/freeze cases.

1. **B3/B4/B5 — DONE (functions + bare-word sugar).** `lib/en-US` provides the
   article functions `the(x)` / `indefinite(x)` (a/an auto-selected) / `an(x)`. The
   **bare-word sugar** `[the X]` / `[a X]` / `[an X]` (and capitalized `[The X]` /
   `[A X]`, which wrap in `cap`) desugars to those calls in the template parser
   (`desugarArticleSugar` in `parser_rd.js`), so `[the velvet_cloak]` ==
   `[the(velvet_cloak)]`. The sugar fires only on exactly `<article> <reference>`
   (two tokens, operand starting with a letter), so `[a + b]` with a local `a` is
   untouched. **Naming note:** the indefinite function is `indefinite`, *not* `a` —
   a one-letter `a()` function shadows the very common local `a` (a JS
   temporal-dead-zone hazard). The natural `[a X]` surface is unaffected; only the
   explicit call form is `[indefinite(x)]`.
2. **B6/B7 — DONE via the existing world-model convention.** The locale reads an
   object's `printed_name` and its `article` (an object whose `.name` is
   `proper`/`plural`/`definite`/`count`, the model `lib/advent` already uses);
   `proper` → no article, `plural` → "some"/definite plural. A cleaner
   boolean-flag contract (B6/B7 as named flags) can replace the `article` object
   later; the locale read is defensive so a world with neither still works.
3. **C1/C3/C4 — DONE.** `cap()`, `upper()`, `lower()`, `title()` in `lib/en-US`
   (plain string transforms; casing is language data, so it lives in the locale).
4. **K5 — DONE.** The world-model→locale contract is now the clean boolean flags
   `proper` / `plural` (+ `printed_name`, `plural_name`), read by the locale with
   `lib/advent`'s `article`-enum object kept as a back-compat fallback. The locale
   pluralizer `pluralize(x)` (named to avoid colliding with advent's `article
   plural` *object*) returns the plural display name: a per-object `plural_name`
   override wins, else the head word is pluralized via an irregular table
   (sheep/child/person/…) + regular `+s`/`+es`/`+ies` rules. Fixture `locale2.lamp`.

**Slice 2 is functionally complete** (B3–B7, C1/C3/C4, K5). Deferred refinements:
real **per-locale sugar words** + **locale swapping** — the article-sugar word set
(`the`/`a`/`an`) is hardcoded English in the parser and `lib/en-US` is
hard-auto-loaded; generalize both when a non-English locale lands.

### Slice 3 — the adaptive engine (headline)

**Status: DONE (2026-06-21).** The render context, adaptive pronouns, verb
conjugation, and `[regarding]` all landed. Fixture `slice3` + golden;
parser/prescan unit tests; all 11 suites green (123 goldens).

The model has **two distinct referents** plus a verb-**agreement** descriptor:

- **The player** — `[We]`/`[us]`/`[our]`/`[ours]`. Always the player, rendered by
  the **story viewpoint** (person + number: default 2nd singular → "you"; the
  globals `viewpoint_person`/`viewpoint_plural` change it, e.g. 1st → "I"). The
  player is **not** the actor and **not** a `[regarding]` target — those don't touch
  `[We]`. (This corrected an earlier draft that seeded `[We]` from the actor.)
- **The subject** — `[They]`/`[them]`/`[their]`/`[theirs]`/`[themself]`. A
  third-person referent, render-local, set by `[regarding EXPR]` or by *naming* a
  thing (the article functions). So `"[the cloak] … [they]"` reads "the velvet cloak
  … it". If the subject is itself the player object (`grammatical_person 2`),
  `[They]` correctly reads "you" — which is what makes one report serve every actor.
  **All** of these pronouns (subject and object/possessive alike) follow the *one*
  subject — there is no separate object-pronoun antecedent — so `[regarding]`
  redirects `[them]`/`[their]` too. To refer to a specific noun a `[regarding]` has
  moved away from, name it again or use literal text. (Decision: 2026-06-21.)
- **Agreement** — what a verb conjugates against, `{person, plural}`. Set by `[We]`
  (→ the viewpoint), `[They]` (→ the subject), `[regarding]` (→ its argument), and
  **by naming a thing** — naming switches the agreement onto that thing, so `"[We]
  [take] [the cloak] and [drop] it"` reads "You take the velvet cloak and **drops**
  it": the second verb has switched to the cloak. To put the agreement back on the
  player, write `[regarding the player]` (or `[regarding you]`) before the verb.

All three are **render-local** (reset per render/print, never saved). The engine
owns the context object and the accessors (`renderSubject`/`renderSetSubject`,
`renderAgreement`/`renderSetAgreement`, `renderCount`); the locale owns the words,
the viewpoint, and the conjugation rules.

The canonical example now works exactly: `"[We] [have] [the cloak]. [They] [are]
[ours]."` → **"You have the velvet cloak. It is yours."** (`[We]`/`[have]` = player;
`[the cloak]` names the subject; `[They]`/`[are]` = that subject; `[ours]` = the
player's possessive, person-adapted to "yours").

1. **D1 — DONE.** `[We]`/`[we]` (the player, viewpoint) vs `[They]`/`[they]` (the
   subject). Distinct referents, per above.
2. **D2 — DONE.** Object/possessive pronouns: player family `[us]`/`[our]`/`[ours]`,
   subject family `[them]`/`[their]`/`[theirs]`/`[themself]`. `[ours]` adapts by the
   viewpoint person — "yours" for the 2nd-person player. (No separate
   `[yours]`/`[mine]` token; the one adaptive token covers it.)
3. **D3 — DONE.** Verb conjugation `[drop]`/`[have]`/`[are]`, agreeing with the
   agreement descriptor. A `verb` declaration registers a word so `[drop]` becomes
   `conjugate("drop")` rather than an object reference; the parser collects the
   words in the prescan. The locale ships the irregular auxiliaries plus common
   verbs; a game adds its own with `verb`.
4. **D4 — DONE, in `lib/en-US`, not `lib/sys`.** The be/have/do/go irregular table
   lives with `conjugate()` in the locale (the original "in `lib/sys`" note was
   wrong — conjugation rules are language data, so they belong to the swappable
   locale, like the article words and the pluralizer).
5. **D5 — DONE.** `[regarding EXPR]` sets the subject *and* the agreement, renders
   empty.
6. **D8 — DONE (capability), not yet adopted by advent.** One report serves every
   actor: `report take: print "[regarding self.actor][They] [take] [the
   self.taken]."` renders "You take the velvet cloak." when the player acts and
   "Alice takes …" for a third-person actor — the `slice3` fixture proves both.
   advent's existing reports still branch on `self.actor == player` by hand;
   migrating them is a follow-up (it would churn goldens) — see TODO.

**Auto subject-switching (and its override).** Naming a thing switches the verb
agreement onto it, exactly as Inform does (verified empirically against an Inform
test game). So `"[We] [take] [the cloak] and [drop] it"` yields "You take the velvet
cloak and **drops** it" — the second verb agrees with the most recently named noun,
not the player. This is correct, intended behavior, not a bug. When the author wants
the verb to stay with the player (or any other subject), they reset it explicitly
with `[regarding the player]` / `[regarding you]`: `"[We] [take] [the cloak] and
[regarding you][drop] it"` → "…and **drop** it". `[regarding]` is the canonical
override in both Lamp and Inform. (A decorative article in `[regarding the player]`
is stripped — it names the player object, not its rendered name.)

**Sugar words are English, in the parser** (`PRONOUN_SUGAR_FNS`, the verb-word set,
`regarding`), the same small coupling the article words already have. Real
per-locale sugar words remain the deferred refinement noted under Slice 2.

### Slice 4 — variation & conditionals

1. **E1–E4 — DONE (2026-06-21).** Inline `[if COND]` / `[else if COND]` /
   `[else]` / `[end]` inside a string literal, with `[otherwise]` as an `[else]`
   alias and `[end if]` as an `[end]` alias. The condition is an ordinary Lamp
   boolean expression; a branch carries its own text and value substitutions.
   **Inline nesting is forbidden** — a `[if]` inside a branch is a compile error,
   because the `[else]`/`[end]` pairing is unreadable without the indentation that
   statement-level `if` relies on (the dangling-else problem). Flat `[else if]`
   chains cover most cases; for genuine nesting the author composes a separate
   `text` value and interpolates it (`let inner = "[if cold]B[else]C[end]"` then
   `"[if dark]A[inner][end]"`), keeping real branching in indented Lamp code. Built
   in the template layer: the parser classifies control markers
   (`classifyControl`) and folds the flat parts into a `cond` node
   (`buildTemplateParts`, a stack rejecting a second open `[if]`); the emitter
   emits a ternary chain of `renderTemplate(...)` calls (`emitTemplateFrag`) — no
   runtime change. Other unbalanced markers (`[end]`/`[else]` without `[if]`,
   missing `[end]`, `[if]` with no condition) are compile errors too. Conditionals
   are template-only (E4: not a standalone expression form). Fixture `cond1` +
   golden; parser unit tests.
2. **F9 + F8-foundation — DONE (2026-06-21).** `[first time]…[only]` renders the
   enclosed text the first time a site is reached, then nothing. The site-durable
   state mechanism lands here: each stateful text site gets a stable compile-time
   **site id** (allocated by the emitter, reset per build, so it is deterministic
   and survives a buildId-gated restore), and the runtime keeps a per-site visit
   count in `variationState`, advanced by `variationAdvance(siteId)` (returns the
   pre-visit count, 0 on the first). That store is captured by a **state provider**
   (key `variation`) so undo/save/restore and golden replays stay consistent —
   without it a restored game would re-show a `[first time]` block. The parser folds
   `[first time]`/`[only]` into a `firstTime` node (same block stack as `[if]`, so a
   nested block is rejected); the emitter emits `(variationAdvance(id) === 0 ?
   render(parts) : "")`. Fixture `firsttime1` + golden; a `tests/state` round-trip
   test; parser unit tests. The seeded **RNG** half of F8 lands in 4c with its first
   random consumer.
3. **F1–F7** `[one of]…[at random]` / `[cycling]` / `[stopping]` / `[in random
   order]` / `[sticky random]` / weighted, plus the `pick(list, mode)` function form.
   These reuse the same per-site `variationAdvance` cursor (cycling/stopping) and add
   the seeded RNG (random modes).

### Slice 5 — lists & numbers

1. **G2** count via the `.size` accessor (the primitive can land in Slice 1).
2. **G1** list-of-a-set with `a_list()` / `the_list()` over any query collection.
3. **G4** numbers in words + ordinals.
4. **G5** grouped/qualified lists (see the elucidated G5 bullet).
5. **G6** empty-list phrasing (`is_empty`, fallback parameter).
6. **G7** plural suffix `[s]` (+ `[es]`), built with the G3 governing-count context.

### Slice 6 — layout & misc output

1. **H1** `[par]` / `[no break]`; **H2** `[run on]`; **H3** `[par if printed]`
   (pending-break state in an engine output filter).
2. **I1** `\u{…}` escape; **I2** typographic entities.
3. **J1** `[player_command]`; **J3** is already plain expressions (no work).
4. **K1** named `text` snippets; **K3** substitution-as-function (falls out of the
   mechanism); **K6** keep the localization seam open.

### Slice 7 — text styling (after the core; author wants rich styling)

- **I3** type styles + **I4** fonts/letter-spacing, via a **structured,
  markup-safe output channel** (not raw HTML) with a **fail-silently** policy: the
  author requests a style and the shell falls back to a safe default when it can't
  honor it. Needs Lighthouse-shell + stdio-host work and a channel design; gated on
  finishing the core substitution slices.

### Deferred (revisit when the prerequisite lands)

- **D6** story tense — when tense is introduced.
- **D7** person setting — when alternate narrator viewpoints are introduced.
- **G3** count-driven agreement (`is`/`are`, `that`/`those`) — surface syntax
  undecided; the underlying `.size` + plural flag come earlier.
- **H4** spacing normalization; **H5** indentation helpers.
- **J2** matched-text (`[the topic understood]`) — when the parser yields text
  results.

### Cut

- **C2** sentence-initial auto-capitalization.

## Open questions

- Bracket vs. escape choice for literal `[` `]` (A2) — `\[` reads better with the
  existing escape model; `[bracket]` matches Inform. Pick one.
  - use the `\[`
- Is there a distinct `text`/template type (K2), or are templates always inline
  literals resolved at the `print` site? This decision shapes the AST and the value
  algebra.
  - distinct type
- **`.size`/`.count` on a list (G2).** The clean Lamp count form (`(contains box
  ?all).size`) needs a list-size accessor the runtime doesn't expose yet. Add it as
  a general list primitive (useful far beyond text), and decide the name.
  - add size
- **Functions vs. sugar boundary.** Articles/case/lists are plain functions; the
  adaptive words (D) and control words (E/F) are sugar. Confirm that line, and
  whether the capitalized spellings (`[The …]`, `[They]`) are recognized by the
  template parser or always written `cap(…)`.
  - I'd say it differently. Everything that hasn't been defined as sugar now can instead be accomplished by embedded ordinary Lamp expressions in []. We can add more sugar later if we want to. For instance, there's no need to call out the fact that we can say `print "[connects Foyer ?only Cloakroom]"`, because that's a given since we're just printing a pre-existing Lamp expression.
- Do conditional/variation substitutions (E/F) exist only inside literals, or also
  as standalone expressions?
  - Only inside literals
- **Library placement (mechanism vs. language data vs. world vocabulary).**
  - **Recommendation: three layers.** (1) The substitution *mechanism* — bracket
    parse, the `text` type, the print-time dispatch that asks for a verb/article
    surface form — is **engine + `lib/sys`** (language-agnostic, always present),
    along with the well-known function/registration names a language pack fills
    (`the`, `a`, `cap`, `subject`, `conjugate`, `register_verb`, …) and the
    agreement-dimension framework (person/number). (2) The *language data* — the
    closed pronoun set ("you/it/they/…"), regular + irregular conjugation rules, the
    a/an rule, pluralizer, number-words, ordinals — is a **swappable locale pack
    `lib/<locale>`**, default `lib/en-US`, loaded per game; swap to `lib/en-GB` /
    `lib/fr-FR` to change language (this is K6, and the "British English library"
    note). It is *not* in `lib/sys`, so a compile that wants another language
    doesn't carry English. (3) **World/game vocabulary** — domain verbs not already
    in the locale's core — is registered into the *active* locale's table by the
    world/game library. Rule of thumb: **mechanism → engine/`lib/sys`; language data
    → `lib/<locale>`; world vocabulary → the world/game library.**
  - Honest caveat: a world library's and a game's *own prose* are language-bound
    too, so switching languages is a **coordinated swap** (locale pack + localized
    world/game text), not free multilingual output from one source. The win is a
    clean, replaceable seam.
  - Note: the runtime's existing list formatter already bakes in English `and` /
    `oxford_comma`; a clean design pushes that join word down into the locale pack
    too (tracked under G1).
- Markup/type styles (I3): introduce a structured output channel, or defer styling
  entirely for v1?
  - We'll do at least the core of the text substitution work before tackling this.

## Non-goals (for now)

- Full natural-language generation beyond templated substitution.
- Localization/multi-language libraries (keep the seam open, K6; don't build it).
- Rich-text/HTML rendering in the web shell (I3/I4) until a markup-safe output
  channel exists.
