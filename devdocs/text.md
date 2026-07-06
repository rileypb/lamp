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
  - the "flanked by word characters" test includes accented Latin letters (fixed
    2026-07-05): French elisions sit against them constantly — `"d'évident"` was
    silently rendered as `d"évident` when the class was ASCII-only.

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
- **D5a. `[those]` — number-agreeing demonstrative.** Inform: `[regarding the noun][those]`.
  **Lamp:** `[those]` renders "that" for a singular context subject and "those" for a plural
  one, reading the same agreement descriptor as the pronouns/verbs; `[Those]` capitalizes.
  Point it at a thing with `[regarding EXPR]` first — the advent refusals use
  `"[We] can't eat [regarding self.food][those]."` so the message reads "…eat that." or
  "…eat those." by the food's number. A zero-arg locale call (`those()`), like the pronouns.
- **D6. Story tense.** Render adaptive text in past/present/future (Inform's "story
  tense"): `[We] [had jumped]`. DEFER until we add story tense
- **D7. Person setting.** Choose 1st/2nd/3rd person narration globally (Inform lets
  a story be told in any person); the player verbs adapt accordingly. **DONE.** Person and
  number are narration choices — the globals `viewpoint_person` (1/2/3, default 2 → "you")
  and `viewpoint_plural` (default false), declared in `lib/sys/globals.lamp`. **The pronoun
  set is not a global:** in third person it is read off the *player object's* `pronouns`
  field (the same source the subject pronouns use), so it tracks the main character —
  reassign `player` and the pronoun follows, with nothing to keep in sync. `pronouns` is
  free text — a preset key ("she"/"he"/"they"/"it") or a full custom set
  "subject/object/det/pron/reflexive" (e.g. "xe/xem/xyr/xyrs/xemself"), so any pronouns
  work, not a fixed gender enum; singular "they" takes a plural verb. So `[We] [see]`
  renders "You see" / "I see" / "She sees" / "They see" / "Xe sees" by `viewpoint_person` +
  `player.pronouns`, and the verb agrees. (Phobos: `viewpoint_person = 3` + `pronouns "she"`
  on `yourself` → "She …".) A third narration global, `viewpoint_familiar` (default false),
  is the T–V politeness choice for languages that distinguish (French tu/vous): false narrates
  a 2nd-singular viewpoint with the polite form — fr-FR renders "vous" with plural verb
  morphology while grammatical *number* stays singular — true gives the familiar "tu".
  English has no distinction; lib/en-US ignores it (see devdocs/i18n.md "French verb
  conjugation"). **Named third-person viewpoint (DONE):** set `viewpoint_named = true` (a `lib/sys`
  global) and, in third person, `[We]` emits the player's **name** on its first use in a render
  ("Galaxy") and pronominalizes later references in that render ("she"). It uses a per-render
  `viewpointNamed` flag in the runtime (`renderViewpointNamed`/`renderSetViewpointNamed`); the
  locale's `we()` reads it. For a name-based house style (Phobos: "Galaxy can't reach that.").
  Default false → pronoun, byte-invariant. The narration name defaults to the player's display
  name (`printed_name`), but a non-empty **`viewpoint_name`** global overrides it — letting the
  narration use a short first name ("Galaxy") while `printed_name` stays the full identification
  name ("Galaxy Jones") seen by `[the player]` and disambiguation prompts (matching I7's separate
  `[Player]` short-name substitution). Story **tense** (D6) remains deferred.
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
- **D9. Adaptive contractions.** Inform: contracted forms (`[We're]`, `[don't]`) ride the same
  verb/pronoun engine. **Lamp — mechanism DONE (2026-07-04, en-US); advent re-theme + fr-FR
  deferred.** A contraction token reads the same per-render agreement descriptor `{person, plural}`
  (§ *Render context*) as the pronouns (D1), verbs (D3), and demonstrative (D5a), so a message may
  be written contracted and still adapt. Contractions are **zero-arg locale sugar words** like
  `[we]`/`[those]` (the parser's `PRONOUN_SUGAR_FNS`, extended to allow a straight apostrophe in
  the bare word) backed by `lib/en-US` natives; `[We're]`/`[Don't]` capitalize via the B5/D1
  mechanism. Three families, and a set of **invariant** contractions deliberately left as literal
  text. Golden `contractions1`. **Not re-themed into advent's shared refusals yet:** those default
  messages compile under *both* locales, and English contractions don't map to single French
  tokens (French negation is discontinuous "ne … pas"; French doesn't contract subject+verb), so
  re-theming them would force a fr-FR contraction story that needs its own design. The sugar is
  **en-US-only**: a fr-FR game using `[we're]` gets a clear "undefined function" compile error.

  **D9a. Subject-pronoun contractions** — the `[We]` subject fused with a following auxiliary.
  Each renders the viewpoint subject **plus** the verb: **contracted** when the subject surfaces
  as a *pronoun*, **spelled out** when it surfaces as a *name*. **Decision: a named third-person
  viewpoint never contracts onto its proper noun** (`viewpoint_named`, D7) — `[we're]` → "Galaxy
  is", not "Galaxy's" — because name+clitic reads poorly (esp. `'ll`/`'d`); the pronoun forms
  contract normally.

  | token | verb | 1sg | 2 (sg/pl) | 3sg (she/he/it) | 1pl | 3pl | named 3rd |
  |---|---|---|---|---|---|---|---|
  | `[we're]` | be (pres.) | I'm | you're | she's / he's / it's | we're | they're | "Galaxy is" |
  | `[we've]` | have | I've | you've | she's / he's / it's | we've | they've | "Galaxy has" |
  | `[we'll]` | will | I'll | you'll | she'll / he'll / it'll | we'll | they'll | "Galaxy will" |
  | `[we'd]` | would | I'd | you'd | she'd / he'd / it'd | we'd | they'd | "Galaxy would" |

  Third-person-**referent** siblings `[they're]`/`[they've]`/`[they'll]`/`[they'd]` agree with the
  antecedent / `[regarding X]` subject (the D1 `[they]` family) instead of the viewpoint. They
  always render a pronoun (a referent is never a bare name — that is an explicit `[the X]`), so
  they always contract: "[The box] — [it's] locked" → "it's".

  **D9b. Negated-auxiliary contractions** — auxiliary + *not*, the negated forms of the D3/D4
  adaptive verbs. They render **no** subject (just the verb), so naming does not affect them;
  they agree with the current subject's person/number:

  | token | verb + not | 3sg | all other persons |
  |---|---|---|---|
  | `[don't]` | do | doesn't | don't |
  | `[aren't]` | be (pres.) | isn't | aren't |
  | `[weren't]` | be (past) | wasn't | weren't |
  | `[haven't]` | have | hasn't | haven't |

  **D9c. Demonstrative contraction** — `[that's]`: "That's" for a singular context subject,
  "Those are" for a plural one (that + be, the number-agreeing pair to `[those]`, D5a). E.g.
  `"[regarding self.food][that's] not edible."` → "That's …" / "Those aren't …".

  **Invariant contractions (excluded — stay literal).** These do not vary by person/number, so a
  message writes them as plain text and only the adjacent `[We]` adapts (`"[We] can't …"` already
  works): modals `can't`, `won't`, `cannot`, `wouldn't`, `couldn't`, `shouldn't`, `mustn't`,
  `shan't`, `needn't`; past auxiliaries `didn't`, `hadn't`; modal+have `could've`/`would've`/
  `should've`/`might've`/`must've`; and fixed `let's`, dummy-subject `there's`/`here's`, `that'll`.

  **Caveats.** (1) `[we'd]`/`[they'd]` mean **would** (the common modal); the rare past-perfect
  auxiliary "had" is spelled `[We] had`, since `'d` can't be disambiguated for spell-out. (2)
  1st-person negative *be* has no clean contraction — `[aren't]` at 1sg yields "'m not"/"aren't";
  1st person is rare in IF viewpoints, so accept it or spell out. (3) A **dummy/existential**
  subject must stay literal: "It's too dark" (weather *it*) and "There's a door" (existential)
  are *not* `[we're]` — only a referential subject uses the adaptive token. (4) `'s` = *is* or
  *has* is harmless: the surface is identical, so `[we're]`/`[we've]` share the 3sg "she's".

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
- **G3. Count-driven agreement.** Inform: `[is-are list of …]`. **Lamp:** DONE.
  Two pieces, no shared count-passing magic:
  - **`are(int n)`** — the bare primitive. Returns "is" only when `n` is exactly 1,
    else "are" (zero is plural — `[are(0)] bullets` → "are 0 bullets"). A plain
    function; it does not touch the render context. `[are(n)]` in a template is just
    an ordinary call substitution.
  - **`[is LIST]` / `[is the LIST]` / `[is a LIST]`** (+ capitalized `[Is …]`) —
    sugar mirroring Inform's three `[is-are list of …]` forms. Each renders the
    copula agreeing with the list's **size** followed by the list itself, with no /
    definite / indefinite articles. An empty list is **singular** here ("is nothing"),
    so the verb is "is" for size 0 or 1 and "are" for 2+ — deliberately *not*
    `are(LIST.size)` (which makes 0 plural). The lead verb word is decorative
    (agreement is by count), so `are` leads equivalently. Desugars in the parser to
    `is_are_list` / `is_are_the_list` / `is_are_a_list`, which reuse `format_list` /
    `the_list` / `a_list`. The operand must be list-typed (checker-enforced via the
    `list<object>` parameter).
  - Companion helpers `that_those(n)` / `a_an(x)` remain unbuilt — add when a fixture
    needs them.
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
- **G7. Plural suffix `[s]` (single token, pluralizer-backed).** Inform: `[s]` —
  prints "s" unless the governing count is 1, with a separate companion for
  "box[es]" stems. **Lamp (sugar):** **just `[s]`** — no `[es]`. `[s]` attaches to
  the **immediately-preceding word** and renders that word's correct plural when the
  governing count isn't 1, by routing the word through the locale's existing
  `pluralize_word` (the irregular table + `+s`/`+es`/`+ies` rules from Slice 2 K5).
  So `"[We] [have] [bullet_count] bullet[s]."` → "You have 1 bullet." / "…3 bullets.";
  `box[s]` → "box"/"boxes"; `berry[s]` → "berry"/"berries"; `sheep[s]` → "sheep"
  either way. A separate `[es]` would (a) duplicate the pluralizer's job and (b)
  can't even express `berry`→`berries` (a replacement, not a suffix) — so it is
  **dropped**. Mechanically `[s]` is not a literal "s": at parse time it consumes
  the trailing word `W` of the preceding text and emits `count == 1 ? W :
  pluralize_word(W)`, reading the **governing count** (the most recently interpolated
  number — the same render-context value G3 needs). An explicit-argument form
  `[s bullet_count]` is the fallback when the count isn't the most recent number.
  Ties to D3 (verb agreement) and G3 (count-driven agreement); the governing-count
  context is the same one G3 needs, so build them together.

## H. Layout / paragraph control (`WI 5.1`, `WI 5.9`)

- **H1. Explicit breaks.** DONE. `[line break]` (a single newline) and `[par]` /
  `[paragraph break]` (a blank line); `[no break]` cancels a pending break. Inline
  markers that desugar to lib/sys output-stream calls (`line_break()` / `paragraph()`
  / `no_break()`), emitted into the rendered text as private-use sentinels the runtime
  interprets in stream order. Raw `\n` still works for hard newlines.
- **H2. Run paragraph on.** DONE. `[run on]` (an alias for `[no break]`) cancels the
  pending break so the next print continues — used to suppress an automatic break for
  the rare case where it is wrong.
- **H3. Conditional paragraph break.** DONE. `[par if printed]` → `par_if_printed()`
  — requests a paragraph break only if text was printed since the last break (the
  dedup that prevents leading/stacked blank lines). lib/advent uses it at the turn
  boundary before the prompt.
- **H6. Automatic breaks — two rules, resolved by strength.** DONE. The standard
  blank-line-before-prompt comes from **two rules that each request a break**. The
  requests are **not summed** — the stronger one wins (see the pending-break model
  below):
  - **A. Sentence punctuation.** A printed string ending in sentence-ending
    punctuation (`.` `?` `!`, skipping trailing closing quotes / parens / whitespace)
    ends its line — i.e. requests a **line** break (≥1 newline). Text **not** so
    terminated does *not* (it runs on into the next output).
  - **B. Rulebook boundary.** At the end of certain rulebooks — `report` /
    `report failed`, `after` (and the turn boundary before the prompt) — a
    **paragraph** break (≥2 newlines) is requested, **conditional and deduplicated**
    (only if text was printed since the last break; never stacks). This is H3
    `[par if printed]` invoked automatically.

  Worked example — a `report take` whose only message is `Taken.`:
  ```
  Taken.   <- A requests a line break (≥1); B requests a paragraph break (≥2)
           <- the paragraph break wins → blank line before the prompt
  >        <- prompt
  ```
  i.e. `Taken.\n\n>` — the two newlines come from **B's paragraph break (≥2)**, not
  from A and B adding 1 + 1. Drop rule B (no boundary break) and only A's single
  newline remains, smashing the text against the prompt; drop rule A too and the text
  runs straight on. `[run on]` / `[no break]` (H2/H1) cancel a pending break where the
  default is wrong ("usually right, though not always").

  **Corollary — same-strength breaks do not stack.** Two `[line break]`s (or an
  automatic line break from `.?!` plus an explicit `[line break]`) collapse to a
  **single** newline, because both are line-strength and the manager keeps only the
  strongest pending request. A blank line therefore needs a **paragraph** break
  (`[par]`), never a second line break.
  - **Pending-break model:** a break request *ensures at least* N newlines before the
    next visible text (line break ⇒ ≥1, paragraph break ⇒ ≥2); the manager keeps the
    strongest pending request and flushes it before the next text / prompt / at exit,
    so consecutive boundary breaks don't stack. `[run on]` / `[no break]` reset pending
    to 0.
  - **Consequence for Lamp:** because rule A makes the per-print line-ending
    **conditional on punctuation**, the trailing newline can no longer be appended
    blindly by the host — the runtime output-stream manager must own it (the
    host→runtime newline move). Today `print` always appends one `\n` and the prompt
    fakes the blank line; the new model replaces both with rules A+B. *(This corrects
    an earlier draft of this note that said H6 needs only a printed-since-break flag;
    that held only for a boundary-break-only reading.)*
  - **Implementation.** The runtime output-stream manager (`src/lamplighter/index.js`)
    routes `print`/`write` through `streamWrite`, owning newlines (emitted via the
    `write` channel; the host/shell add none — the old `print`-message path is gone).
    Rule A fires in `streamEmitRun` (`SENTENCE_END`); markers travel as private-use
    sentinels and are processed in stream order; `flushOutput` (worker exit)
    materializes the final break. A break "ensures at least N newlines" before the next
    text, subtracting `streamTrailingNewlines` already at the tail — so after a prompt
    (whose echoed input ended the line; `streamNoteInputLine`) a paragraph break adds
    one blank line, not two. Rule B is **per-band**: the engine (`runAction`) requests a
    paragraph break after a top-level action's `after` band when that band printed
    (separating `after` from `report`), and lib/advent requests `[par if printed]` at
    the turn boundary (`startup.lamp`) for the prompt + a break between supporter groups
    (`describe_supporters`). Output that should occupy its own line without sentence
    punctuation uses an explicit `[line break]` (banners, room names, inventory rows,
    parentheticals). Fixtures `para1`; the `after`+`report` separation is exercised by
    `study`/`study_advent`. Parser test; output-compatible rebaseline.
- **H4. Spacing normalization** — collapse/avoid double spaces and stray blank
  lines from composed substitutions (a real pain point in IF output). Engine-side
  output filter, no surface syntax.
  - DEFER
- **H5. Indentation helpers** for nested/box output, given `pre-wrap` shell
  rendering (`devdocs/lighthouse.md` → Shell). **Lamp:** an `indent(text, n)`
  function rather than a control word.
  - DEFER

## I. Special characters & typography (`WI 5.2`)

- **I1. Unicode escape.** DONE. A `\u{HEX}` string escape (1–6 hex digits) in
  `unescapeString` (`tokenizer.js`) rather than a bracket substitution —
  `"caf\u{e9}"` → "café", `"\u{1f600}"` → an astral-plane emoji. Resolved at decode
  time (the single decode point), so every downstream consumer sees the character; a
  malformed `\u{…}` is left verbatim like any unrecognized escape. Note `[\u{a0}]`
  still opens a substitution — `\u{…}` resolves *before* template splitting, so an
  nbsp inside brackets is an empty-substitution error; print such a character bare.
  Fixture `typography1` + golden; tokenizer unit tests.
- **I2. Named typographic entities** — em dash, ellipsis, curly quotes, non-breaking
  space. **Lamp:** prefer literal UTF-8 in source plus a few `\`-escapes
  (`\—`-style) over bracket words; only add `[entity]` words if literals prove
  awkward.
- **I3. Type styles.** FIRST CUT DONE (2026-06-22) → see **Slice 7** for the full
  record. Surface is **wrapping functions** `bold(…)`/`italic(…)`/`fixed(…)` in
  `lib/sys` (not Inform's stateful `[bold type]`/`[roman type]` toggles), plus the
  paired-marker sugar `[bold]…[/bold]`/`[italic]…[/italic]`/`[fixed]…[/fixed]` (DONE;
  long-form only — `[i]` would collide with a loop-index print). Transport is
  **structured segments** (`{value, styles}`
  per `write` message), preserving the web shell's text-nodes-only / never-innerHTML
  rule (`devdocs/lighthouse.md`).
  - Author wants styling to a much greater degree than Inform's Z-machine-constrained
    set; Lamp is not so constrained.
- **I4. Fixed vs. variable letter spacing** (Inform's `[fixed letter spacing]`),
  for ASCII art/tables — depends on shell capability. First cut folds fixed-width in
  as a style (monospace); true letter-spacing/table layout deferred.
  - **Fail-silently policy:** the author can request a style (e.g. a script font);
    if the outer shell can't comply it falls back to the safe alternative.

## J. Player/parser-derived text

- **J1. Player's command.** DONE. `[player_command()]` — the player's most recent
  raw input line (original casing, trimmed), retained by the runtime in `runCommand`
  and exposed as a `native function string player_command()` in `lib/sys`. Transient
  narration state (not saved). Surface is the call form (no bare-word sugar — it
  doubles as a K3 example and avoids coupling another word into the parser's sugar
  layer). Fixture `slice6c` + golden.
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

- **K1. Named text snippets / macros.** DONE (no new code — falls out of the `text`
  type, K2). A `text`-typed global/field holds a template referenced by name
  (`global text vibe = "[We] [are] still here."`), and renders **lazily against the
  caller's render context** — so `[regarding x][vibe]` makes the snippet's pronouns
  and verbs adapt at the use site. Composes into other templates and through `+`.
  Verified by fixture `slice6c` (and the deferred-render behavior by scratch tests).
- **K2. Text as a first-class value & type.** A `text` (template) type distinct from
  `string`, so templates can be stored in fields, passed to functions, and
  late-rendered. Decide how this relates to the closed value algebra in
  `devdocs/state.md` (is an unrendered template a storable/saveable value?).
- **K3. Substitution functions.** DONE (the **realized core principle**, see Design
  principle): a substitution is just an expression that yields text, so it can call
  any author/library function — `[describe(self)]`, `[the(self.noun)]`,
  `[upper(player_command())]` — closing the loop with the language instead of a fixed
  substitution vocabulary. All of B/C/G's article/case/list helpers are instances of
  this; `slice6c` exercises it explicitly.
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
   - **governing count** — the most recently interpolated number, read by `[s]`
     (G7) and the `is`/`are` agreement helpers (G3).
   - **governing case/role** *(future, not built)* — the grammatical role a
     governing word to the *left* (a preposition or verb) imposes on the next noun
     phrase, so the article function can realize it (French `de`+`le`→`du`, German
     case). The mirror image of *current subject*: agreement flows outward from the
     noun, government flows inward from context. Set by a governing marker (like
     `[regarding]` sets the subject), consumed by the next `the`/`a`. See
     "Preposition + article contraction / case government" under Open questions.

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

   > **TODO — read-only render flag (not yet built).** Some renders are *inspections*,
   > not real output, and must not advance site-durable state: SHOWME renders a field's
   > template to display it (`lib/advent/index.js` `formatDebugValue` → `renderText`), and
   > SAVE freezes text-thunk fields at capture (`encodeValue`). A `[first time]` or
   > `[cycling]` field value would advance its counter/cursor as a side effect of merely
   > looking at or saving it. Plan: a runtime global boolean (e.g. `renderReadOnly`) set
   > around such evaluations; the site-advance helpers (`variationAdvance`/`variationPick`
   > and the first-time counter) read the current state but **skip the mutation** when it
   > is set. Tackle later — but note the **SAVE** half is now moot: persistable templates
   > (`devdocs/text-persistence.md`, Phase 1) no longer *render* a stored template at
   > capture, so save/undo/restore no longer advance its cursors (that also fixed the
   > freeze-to-dead-string bug — `devdocs/state.md`). SHOWME's inspect-render is the
   > remaining case for a read-only flag.

3. **Output-stream state.** Pending-break state (ensure-at-least N newlines) plus a
   **printed-since-break** flag for `[run on]` / `[par if printed]` (H2/H3) and the
   automatic breaks (H6: sentence punctuation + rulebook boundary) span *multiple*
   prints, so this is neither render-local nor site-keyed: it belongs to the
   writer/output channel. The trailing newline is currently owned by the *host*
   (`sandbox/host.js` appends `\n` per print); H6 requires moving that ownership into a
   runtime output-stream manager, because rule A makes the per-print line-ending
   conditional on punctuation (the host can no longer append `\n` unconditionally).

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

**Slice 2 is functionally complete** (B3–B7, C1/C3/C4, K5). **Per-locale sugar words are
now declarable (DONE 2026-07-05):** the article/pronoun/contraction token vocabulary is no
longer hardcoded in the parser — a locale pack declares it with `sugar bare|operand …`
(the compiler bakes in no language sugar). See devdocs/i18n.md ("declarable grammar sugar").

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
6. **D8 — capability DONE; advent uses Inform-style separate branches (2026-06-22).**
   The adaptive verb/pronoun machinery (D1–D7) is the capability. For action reports,
   advent keeps the player and other-actor cases as **separate branches**, matching
   Inform's `standard report dropping rule`: the player branch is terse ("Dropped."),
   the other-actor branch **names** the actor with an adaptive verb —
   `print "[The self.actor] [drop] [the self.dropped]."` → "The npc drops the cloak."
   (articles + capitalization + agreement). Implemented across advent's reports.
   - **Rejected:** folding the two branches into one template via
     `[regarding self.actor][They] …`. `[They]` is a *pronoun*, so a third-person actor
     would render "It drops the cloak." rather than a name — and Inform itself keeps the
     branches separate for this reason. Choosing name-vs-pronoun is deliberately the
     author's, made explicit per branch (see the D8 entry under section D, and
     "Auto subject-switching" below).

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

**Sugar words are locale-declared (DONE 2026-07-05):** the pronoun/article/contraction
token vocabulary moved out of the parser into `sugar bare|operand …` declarations in the
locale packs (`lib/en-US`/`lib/fr-FR`); the parser bakes in no language sugar. Only the
structural sugar (`regarding`, `is/are LIST`, markers, style/variation control words) stays
in the parser — it is language-neutral. See devdocs/i18n.md ("declarable grammar sugar").

### Slice 4 — variation & conditionals

**Status: DONE (2026-06-21), all items.** Inline conditionals (E), `[first time]`
(F9), the site-durable state mechanism, the six variation modes (F1–F6), the seeded
RNG (F8), plus the formerly-deferred **F7 weighted** (`[as decreasingly likely
outcomes]`), the **`pick(list, mode)`** function form, and **RNG entropy seeding**
(`seed_random`/`randomize`) all landed.

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
3. **F1–F6 + F8 — DONE (2026-06-21).** `[one of]ALT[or]ALT…[MODE]` chooses one
   alternative per render by the closing mode word: `[cycling]` (in order, wrapping),
   `[stopping]` (advance, then stick on the last), `[at random]` (uniform but never
   the immediately-previous), `[purely at random]` (independent uniform), `[in random
   order]` (a shuffled run, no repeat until exhausted, then reshuffle), `[sticky
   random]` (random once, then fixed). An alternative carries its own substitutions;
   the same block stack rejects nesting. The parser folds it into a `oneOf` node
   (`alternatives` + `mode`); the emitter computes the index **once** (cycling/stopping
   from `variationAdvance`; the random modes from `variationPick`) inside an IIFE, then
   a ternary renders only the chosen alternative. **F8 — DONE:** a seeded RNG
   (mulberry32, fixed default seed → deterministic golden output) whose stream state
   is captured by the `rng` state provider, and the random modes' per-site cursors
   ({last}/{chosen}/{order,pos}) live in the same `variation` provider — so
   undo/save/restore reproduce the exact sequence. Fixture `variation1` + golden; a
   `tests/state` RNG round-trip; parser unit tests.
4. **F7 + `pick()` + seeding — DONE (2026-06-21).**
   - **F7 weighted:** the inline mode `[as decreasingly likely outcomes]` — a
     weighted draw with weight `n` for the first alternative down to `1` for the last
     (`variationPick` mode `"decreasing"`, stateless).
   - **`pick(LIST, MODE)` function form:** chooses among a computed list's *elements*
     (default mode `"random"`; the mode string accepts the internal names and the
     inline phrasings, e.g. `"in random order"`). The emitter special-cases `pick`
     and injects a stable per-call-site id, so the stateful modes keep a cursor in the
     same `variation` provider; the checker infers the list's element type as the
     result and validates the 1–2 argument arity. (Note: passing a `"quoted"` mode
     inside a `[…]` template substitution hits the general nested-quote limitation —
     use `pick` in code position there, or the inline `[one of]` sugar.)
   - **RNG entropy seeding:** `seed_random(n)` reseeds reproducibly from an integer;
     `randomize()` draws a fresh seed from entropy for cross-playthrough variety
     (lib/sys). Golden fixtures call neither, so they keep the deterministic default
     seed; the seed is captured by the `rng` provider, so a seeded game still restores
     consistently. Fixture `variation2` + golden; parser unit test for the weighted
     marker.

### Slice 5 — lists & numbers

**Status: DONE (2026-06-21).** All listed items (G1, G2, G4, G5, G6, G7) landed;
G3 (count-driven `is`/`are` agreement) stays deferred — its syntax was never
settled, and the governing-count context it needs now exists (built for G7), so it
can be picked up cheaply later.

1. **G2 — DONE (2026-06-21).** A list value exposes `.size` / `.count` (both the
   element count, an `int`). Works on a list-typed name (`stuff.size`, via the
   existing `name.field` chain) and on a parenthesized query
   (`(contains chest ?all).size`) — the latter via a new **`MemberAccess`** node:
   the `(...)` nud collects a trailing `.field` chain, the emitter emits
   `(expr).field`, and the checker infers it through a shared `applyFieldToType`
   helper (refactored out of the chain walker). Runtime: `makeList` gains `size` /
   `count` getters.
2. **G1 — DONE (2026-06-21).** `a_list(xs)` / `the_list(xs)` (lib/en-US) render a
   list with indefinite / definite articles via the serial-comma formatter — "a
   brass lantern, a key and an apple" / "the …". Works over any query collection.
3. **G4 — DONE (2026-06-21).** `in_words(n)` → "forty-two" and `ordinal(n)` →
   "forty-second" (lib/en-US), American style (no "and"), covering negatives and up
   to billions; ordinals ordinalize the last cardinal word (irregular table for
   first/second/third/fifth/eighth/ninth/twelfth, `y`→`ieth` for the tens). Fixture
   `numbers1` + golden.
4. **G5 — DONE (2026-06-21).** `a_group(xs)` / `the_group(xs)` (lib/en-US) collapse
   objects with the same display name into a counted entry — "two brass lanterns,
   three coins and a key" — reusing `in_words` (count word), `pluralize` (plural
   name), and `format_list` (serial comma). The definite-vs-indefinite sub-decision
   is resolved by the two variants (`a_group` → indefinite singletons; `the_group` →
   "the two brass lanterns…"). Grouping key is the display name; first-seen order is
   preserved. Fixture `group1` + golden. (An author-overridable grouping key is a
   later refinement.)
5. **G6 — DONE (2026-06-21).** `is_empty(xs)` predicate; an empty list already
   renders "nothing", and a custom fallback composes with the conditional sugar
   (`[if is_empty(xs)]…[else][the_list(xs)][end]`).
6. **G7 — DONE (2026-06-21).** The single `[s]` token (no `[es]`). At parse time it
   splits the trailing word `W` off the preceding text into a `pluralSuffix` node;
   the emitter emits `plural_suffix("W")`, which returns `W` when the **governing
   count** is 1 and `pluralize_word(W)` otherwise — so `bullet[s]`/`box[s]`/`berry[s]`/
   `sheep[s]` all inflect correctly. The governing count is "the most recently
   interpolated number": every value substitution is wrapped in `lamplighter.interp(…)`
   which records an interpolated number as the render-context `count`; template parts
   are array elements evaluated left-to-right, so the count is set before a later
   `[s]` reads it. `[s]` not immediately following a word is a compile error. Fixture
   `plural1` + golden; parser unit test.

Fixtures `list1` / `numbers1` / `plural1` + goldens; parser unit tests
(`MemberAccess`, `pluralSuffix`). All 11 suites green (129 goldens).

### Slice 6 — layout & misc output

1. **H1/H2/H3/H6 — DONE.** `[par]` / `[line break]` / `[no break]` / `[run on]` /
   `[par if printed]` markers + the two composing auto-break rules (A: a print ending
   in `.?!` ends its line; B: a conditional paragraph break — per-band after a
   top-level action's `after` band, plus the lib/advent turn boundary). Newline
   ownership moved off the host into a runtime output-stream manager with
   trailing-newline tracking (correct prompt spacing). Output that needs its own line
   without sentence punctuation uses an explicit `[line break]`. Fixtures `para1`,
   `study`/`study_advent` (after+report); parser test; output-compatible rebaseline.
2. **I1** `\u{…}` escape — DONE (`tokenizer.js`, fixture `typography1`). **I2**
   typographic entities — covered by literal UTF-8 + `\u{…}`; no new syntax.
3. **J1** `[player_command()]` — DONE (`lib/sys`, fixture `slice6c`). **J3** is
   already plain expressions (no work).
4. **K1** named `text` snippets — DONE (no code; falls out of K2). **K3**
   substitution-as-function — DONE (the realized core principle). **K6** localization
   seam kept open. Both in fixture `slice6c`.

### Slice 7 — text styling (after the core; author wants rich styling)

- **I3** type styles + **I4** fonts/letter-spacing, via a **structured,
  markup-safe output channel** (not raw HTML) with a **fail-silently** policy: the
  author requests a style and the shell falls back to a safe default when it can't
  honor it. Needs Lighthouse-shell + stdio-host work and a channel design; gated on
  finishing the core substitution slices.

  **First cut — DONE (2026-06-22).** bold / italic / fixed-width shipped.
  `bold(value)` / `italic(value)` / `fixed(value)` live in `lib/sys` (param typed
  `string`, so a `text`/template argument works via the string↔text rule; to style an
  object pass its rendered form, `bold(the(obj))`). The runtime brackets the rendered
  content with per-style PUA push/pop sentinels (`–`); the output-stream
  manager keeps a depth per style and tags each emitted run with the active set in a
  stable order (`styled()` + `activeStyles()` in `src/lamplighter/index.js`).
  `writeImpl(run, styles)` carries the set out-of-band: the worker adds a `styles`
  array to the `{type:"write"}` message only when non-empty, so plain text keeps the
  bare shape. stdio host → ANSI SGR on a TTY (bold=1, italic=3; fixed has no code — a
  no-op), plain on a pipe; web shell → a `span` with `style-*` classes (`shell.css`),
  `textContent` only. Fixture `styling1` (golden is plain text — styles dropped in a
  pipe, proving fail-silently); sandbox tests assert the styled segments and the
  ANSI/plain split.

  **Paired-marker sugar — DONE (2026-06-22).** `[bold]…[/bold]` / `[italic]…[/italic]`
  / `[fixed]…[/fixed]` desugar to the `bold`/`italic`/`fixed` calls. `classifyControl`
  recognizes the open/close words; `buildTemplateParts` lifts them into a `style` block
  node (`{kind, name, parts}`); the emitter renders `name(renderTemplate([…inner]))`.
  Unlike the conditional/variation blocks, style spans **nest** (their named close tags
  keep the pairing readable) and may sit inside or around a control block — only
  `[if]`/`[first time]`/`[one of]` are still barred from nesting each other.
  **Long-form spellings only:** the single-letter `[b]`/`[i]` from the original sketch
  were dropped — `[i]` collides with the universal loop-index variable (`[i]` is a bare
  variable print, exercised by the `example13`–`21` fixtures), so short forms are unsafe
  sugar. `[fixed(x)]` (with parens) stays the explicit call form, distinct from the
  `[fixed]` span. Fixture `styling2` (+ golden), parser unit test; 137 goldens.

  **Remaining:** true fixed letter-spacing / table layout (I4); capability handshake +
  author-specified fallbacks.

  **Decisions taken (2026-06-22).** First cut covers **bold, italic, fixed-width**.
  - **Surface = wrapping functions.** `bold("…")`, `italic("…")`, `fixed("…")` (in
    `lib/sys`, language-agnostic — styles are not locale data). They return styled
    `text` values, so they **compose/nest** (`bold(italic(x))`) and have no
    forgot-to-reset failure mode. **Paired-marker sugar** (`[b]…[/b]`, `[i]…[/i]`,
    `[fixed]…[/fixed]`) is queued as the next follow-up over these primitives.
  - **Transport = structured segments.** The runtime owns the style stack; each
    `{type:"write"}` message carries its **resolved style set**
    (`{type:"write", value, styles:[…]}`). Hosts stay dumb — every message is
    self-describing, no host-side stack or sentinel protocol to reconstruct. (The
    in-band PUA sentinels may still be the *internal* carrier inside `text` values,
    but only flat run + active style set crosses the transport.)
  - **Per-host mapping, fail-silently (no capability handshake in v1).**
    stdio host → ANSI SGR (bold/italic) when a TTY, else drop; **fixed-width is a
    no-op** (terminal is already monospace). web shell → `createElement("span")` +
    `className` + `textContent` (the existing markup-safe channel); fixed-width →
    a monospace class (where it actually matters, for tables/ASCII art). Unknown
    styles are silently dropped.
  - **Style stack is orthogonal to break sentinels;** a style does not survive a
    `[par]`/`[line break]` unless still open. `text`-value concatenation must
    **preserve style runs** — the one genuinely new bit of plumbing (the value type
    stops being a plain string).
  - **Fixed-width is folded in as a third style** (monospace class) for the first
    cut; true fixed letter-spacing / table layout (I4) is deferred.

### Deferred (revisit when the prerequisite lands)

- **D6** story tense — when tense is introduced.
- **D7** person setting — when alternate narrator viewpoints are introduced.
- **D9** adaptive contractions — **mechanism DONE (en-US)**; the advent shared-message re-theme
  and a fr-FR contraction story remain (English contractions don't map to single French tokens).
- **G3** count-driven agreement (`is`/`are`, `that`/`those`) — surface syntax
  undecided; the underlying `.size` + plural flag come earlier.
- **H4** spacing normalization; **H5** indentation helpers.
- **J2** matched-text (`[the topic understood]`) — when the parser yields text
  results.

### Cut

- **C2** sentence-initial auto-capitalization.

## Open questions

- **Preposition + article contraction / case government** *(known limitation; no
  fix scheduled).* `the(x)` produces one fixed definite phrase ("the coin", "le
  caillou"), and the preposition before it is a literal in the template. At that
  boundary some languages *fuse* the preposition with the article, governed by the
  preposition — which neither the literal nor `the(x)` can see:
  - French: `de`+`le`→`du`, `de`+`les`→`des`, `à`+`le`→`au`, `à`+`les`→`aux` (no
    contraction before `la`/`l'`). So a French message "… de [the X]" wrongly
    renders "de le caillou" instead of "du caillou".
  - Wider: German `von dem`→`vom`, `zu dem`→`zum`, *plus* the article changes by
    case (`der/den/dem/des`); Italian `di/a/da/in/su` × `il/lo/la/…` →
    `del/dello/al/dal/nel/sul/…`; Spanish/Portuguese `de el`→`del`, `em o`→`no`.
    German genitive realizes "of the X" as `der Münze` with **no preposition word
    at all** — so this is grammatical *case government*, not a syntactic quirk.
  - **Why not a `de_()`/`à_()` helper.** Rejected (2026-06-26): it's French-syntax
    leaked into a native name, doesn't exist in English (so a shared template can't
    use it), proliferates per-preposition/per-case, and can't express the German
    no-preposition genitive. Wrong level of abstraction.
  - **Forward-compatible shape (when a game needs it).** Two complementary
    mechanisms for two subclasses:
    - *Romance fusion (no markup) — recommended for this subclass.* Give the
      article resolver the **preceding rendered text** (or just the last token) and
      let it **consume a matched preposition**: seeing the buffer end with `de `/
      `à `, French `the(château)` emits `du château` and trims the `de `. The
      decision must live in the resolver, not a post-render regex, because `le` is
      ambiguous — `de` + article `le` contracts (`du château`) but `de` + object
      pronoun `le` does not (`content de le faire`), and only the article function
      knows it is emitting the *article*. It also already knows when it elides
      (`de l'hôtel` stays) or is feminine (`de la tour` stays). No template markup:
      a French override just writes `… de [the château]`. Cost: the render contract
      gains a bounded left-rewrite (a substitution may trim a trailing preposition
      it matched), plus sentence-start capitalization (`De [the X]` → `Du château`).
      The same mechanism extends to Italian/Spanish/Portuguese fusion. (Idea due to
      a 2026-06-26 suggestion: pass the resolver its preceding words.)
    - *Case government (needs markup) — for German/Slavic.* Preceding-words does
      **not** reach this: there is often no preposition token (German genitive
      `der Münze` = "of the X"), and the article form is set by the grammatical role
      assigned by a governing word, not its surface neighbor. Here add a fourth
      render-local context item, *governing case/role* (above): a governing marker
      sets a pending role, the next `the`/`a` consumes it. Author-facing as a
      role-tagged article (`[the X | of]`) or a semantic combinator (`[of_the X]`);
      English no-ops it (`the coin`), German selects case (`der Münze`). Mirrors the
      subject/agreement mechanism (D) but flows inward from context.
    Both are deliberate extensions, not quick natives; the fusion mechanism is the
    smaller first increment and covers the common (Romance) case.
  - **Until then:** phrase French (and other) overrides to avoid a `de`/`à` +
    `le`/`les` boundary. There is almost always a natural rewording — e.g.
    `examine_nothing` is "[The act.target] n'a rien d'inhabituel." not "… à propos
    de [the act.target]". See `devdocs/i18n.md` (Pending).
- **H6 automatic breaks (the 6b design).** RESOLVED & DONE. Decisions taken:
  (1) non-punctuated prints run on; output needing its own line uses explicit
  `[line break]` / `[par]`. (2) Rule B is **per-band** — the engine breaks after a
  top-level action's `after` band (when it printed), and lib/advent breaks at the turn
  boundary for the prompt. (3) Built and rebaselined (output-compatible apart from the
  intended `after`/`report` separation). (4) No per-band default-off exceptions —
  `[run on]` is the escape hatch. Prompt spacing is handled by trailing-newline
  tracking; the dead `print`-message transport path was removed. See the H6 entry.
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
  - RESOLVED (2026-06-22). Core substitution (Slices 1–6) is done; Slice 7 now
    adopts a **structured-segment** channel (`{value, styles}` per `write` message)
    with **wrapping-function** surface (`bold`/`italic`/`fixed`). See Slice 7.

## Non-goals (for now)

- Full natural-language generation beyond templated substitution.
- Localization/multi-language libraries (keep the seam open, K6; don't build it).
- Rich-text/HTML rendering in the web shell (I3/I4) until a markup-safe output
  channel exists.
