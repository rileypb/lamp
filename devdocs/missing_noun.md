# Missing-Noun Prompts

> Status: **design complete (open questions resolved 2026-07-11); not yet
> implemented.** Defines the intended design for
> *missing-noun* handling in the Game Parser — the "What do you want to take?" /
> "Who do you want to give it to?" re-prompt an IF parser issues when a command
> names a verb but omits a required noun. Companion to `devdocs/game_parser.md`
> (the overall parse pipeline) and the "noun missing" line in `lurking_todo.md`.
>
> The target is Inform-style behavior adapted to Lamp's **literal-template**
> grammar, whose structural limits (below) make the fit different from Inform's
> slot grammar. Where the current runtime can't express a capability, it is
> called out under **Runtime changes** and **Open questions** rather than assumed.

## Purpose

Given a command whose verb is recognized but a required noun is absent —
`take` (no object), `unlock door with` (no instrument), `give to hacker` (no
gift) — the parser should **ask for the missing noun** and consume the player's
next line as the answer, rather than emit the generic
`parser_no_understand` ("I don't understand that."). This is Inform's asking of
"the noun" / "the second noun".

Examples (interrogative varies by slot type; preposition by grammar):

| Input | Prompt |
|---|---|
| `take` | What do you want to take? |
| `unlock door with` | What do you want to unlock the door with? |
| `ask Fred` | What do you want to ask Fred about? *(preposition supplied)* |
| `give lamp to` | Who do you want to give the lamp to? |
| `go` | Which way do you want to go? |

Only a **bare single-noun verb** or a verb missing its **final** slot prompts;
a two-noun verb missing its *first* noun (`give to hacker`, `ask about keys`)
does not — see **Non-goals**.

## The controlling constraint

Lamp's grammar is **whole-template literal matching**
(`matchGrammar`, `src/lamplighter/index.js`). A grammar entry is a list of
`parts` — literals interleaved with typed slots — and a template matches only if
every literal aligns and every slot captures ≥1 token. The decisive line:

```js
// matchGrammar
if (span.length === 0) return null;   // an empty slot fails the WHOLE template
```

**Consequence:** today a missing noun is *indistinguishable from gibberish*.
Bare `take` matches no template, `sawVerbMatch` stays false, and the loop prints
`parser_no_understand`. The parser has **no partial-match concept** — it never
learns "the verb matched but slot S is empty." So missing-noun handling is **not
a new message on an existing path**; it requires the matcher to surface partial
matches.

Correspondingly, we can only detect a missing noun when the typed tokens form a
**prefix** of a template — the verb plus all earlier slots/literals — leaving a
**unique** trailing slot to ask for. See **Structural boundary** for what this
excludes.

## Design

Two halves. The **answer flow** reuses existing machinery; the **detection** is
the new work.

### 1. Detection — partial matches from `matchGrammar`

Extend `matchGrammar` (or add a second pass gated on total-match failure) to
return, instead of only `null`, a **partial match** describing an otherwise-
aligned template with exactly one empty *required* slot:

- `field` — the empty slot's name.
- `type` — its declared type (from `slotTypes` / the action's field schema).
- `preposition` — the literal immediately preceding the empty slot in `parts`
  (`with` / `in` / `to` / `about` / …), or none for a bare verb's direct slot.
- the already-filled slots (their spans), so a chained prompt can re-resolve the
  whole command once the answer arrives.

A template is a **partial-match candidate** when its `parts` split into:

- a **prefix** that matches the tokens exactly and consumes **all** input
  (every prefix literal aligns, every prefix slot captures ≥1 token), and
- a **suffix** of *zero or more literals followed by exactly one slot* — so
  exactly one slot is unfilled and it is the template's **final** slot.

The suffix's literals are the connecting preposition(s) (`about`, `with`, …).
**Crucially they need not have been typed:** `ask Fred` matches
`ask [interlocutor] about [topic]` with prefix `ask [interlocutor]` (=Fred) and
suffix `about [topic]`, yielding *"Ask Fred about what?"*. A typed trailing
preposition (`unlock door with`) simply means the suffix is just the bare final
slot.

Requiring the empty slot to be **final** (all earlier slots filled) is what
keeps a two-noun verb's *first* noun out of scope (Non-goals).

What excludes `put lamp` is therefore **not** the un-typed preposition but
**ambiguity**: both `put [x] in [y]` and `put [x] on [y]` yield a valid suffix
(`in [y]` / `on [y]`), so there are *two* candidate completions. Uniqueness of
the completion is the gate — see **Tie-break**.

### 2. Question phrasing — from slot type + preposition

- **Interrogative** from `type`: a `person` slot → **"Who"**, a `direction`
  slot → **"Which way"**, otherwise → **"What"**.
- **Preposition** from the adjacent literal: "…unlock the door **with**?",
  "…give it **to**?" (no trailing preposition for a bare direct slot).
- Filled slots render through the normal `the()` path so the prompt can name
  them ("unlock **the door** with?").

All phrasing inputs already live in `parts` + `slotTypes`; no new world-model
data is needed. Messages are named/locale-owned like the rest of the parser
prose (`devdocs/messages.md`).

### 3. Answer flow — mirror `pendingDisambiguation`

Add a `pendingNoun` state analogous to `pendingDisambiguation`
(`src/lamplighter/index.js`): after printing the question, park the resolved
action-so-far, the empty `field`, and the remaining slots; **spend no turn**.
On the next line, treat the input as that slot's span and re-enter resolution.
This reuses, verbatim, three behaviors the disambiguation path already has:

- **Chaining into disambiguation.** `take` → "What do you want to take?" →
  `brick` → "Which brick?" — the answer flows into the existing candidate
  resolution / `pendingDisambiguation` with no special case.
- **`ALL` / multi.** `take` → `all` rides `resolveAllPhrase` for a `multi` slot.
- **AGAIN splicing.** Fold the answer into the source command
  (`spliceDisambiguation`-style: `take` + `lamp` → `take lamp`) so `again`
  replays the fully-resolved command.

## Structural boundary (a deliberate divergence from Inform)

Because detection needs the structure present, two cases stay unrecognized —
call this out to authors:

- **`put lamp`** (two-noun verb, no preposition typed) — excluded by
  **ambiguity**, not by the missing preposition: `put [x] in [y]` and
  `put [x] on [y]` each yield a valid completion, so the trailing slot isn't
  unique and we don't guess (Tie-break). Contrast `ask Fred`, where only
  `ask…about…` completes → we *do* prompt "Ask Fred about what?" with the `about`
  supplied. Inform asks "put the lamp in what?"; we fall through when the
  completion isn't unique, unless a per-verb default is authored.
- **A bare form already resolves.** `unlock door` resolves via the
  `unlock_keyless` line, so it must **not** trigger a prompt. The rule: only
  prompt when *no* complete template (of any arity) matches. `unlock door with`
  (dangling preposition) has no complete match → prompt.

## Tie-break policy (new ambiguity)

Allowing prefix matches creates an ambiguity that cannot exist today: one input
may be a valid prefix of **several** templates, each with a different trailing
suffix. Rule:

- Collect **partial-match candidates** (prefix consumes all tokens; suffix =
  literals + one final slot), as defined above.
- If **exactly one** candidate → prompt, supplying the suffix's preposition(s)
  in the question (`ask Fred` → "Ask Fred about what?").
- If **more than one** → do **not** guess; fall through to
  `parser_no_understand` (`put lamp`: `in [y]` vs `on [y]`). A later "which verb
  did you mean?" is out of scope here.
- A complete match (any arity) always wins over any partial — so bare forms
  (`unlock door` → `unlock_keyless`) and fully-typed commands are never
  overridden.

## Non-goals

- **First (or any non-final) noun of a multi-noun verb omitted** —
  `give to hacker`, `ask about keys`, `put in box`. Only a bare single-noun verb
  or a verb missing its **final** slot prompts. These leading-empty-slot inputs
  are structurally *detectable* (the empty span precedes a present preposition),
  but leading with a preposition is rare and asking for the first noun reads
  awkwardly, so it is deliberately excluded.
- No per-verb *default nouns* ("search" → search the room) — verbs wanting a
  default add it themselves; this feature only *asks*.
- No guessing among **multiple** possible completions (`put lamp` → `in` vs
  `on`) — we prompt only when the trailing slot is *unique*. A unique completion
  with an un-typed preposition (`ask Fred` → "…about what?") **is** in scope.
- No "which verb did you mean" disambiguation across multiple qualifying
  templates (tie-break falls through instead).
- No change to the disambiguation feature itself — only reuse of its flow.

## Runtime changes (summary)

1. `matchGrammar` (or a second pass): emit **partial-match candidates** — a
   prefix that consumes all tokens plus a suffix of *literals + one final slot* —
   on total failure, each carrying `field`, `type`, the suffix's preposition
   literal(s) (typed or supplied), and the filled prefix spans.
2. Failure classifier (the `sawVerbMatch` block): when **exactly one** partial
   candidate exists and no complete match did, open a `pendingNoun` prompt
   instead of printing `parser_no_understand`; on ≥2, fall through.
3. `pendingNoun` state + its next-line handler, modeled on
   `pendingDisambiguation` (park, re-resolve, chain, AGAIN-splice, no-turn).
4. Locale messages: `noun_missing_what` / `_who` / `_which_way`, composed with
   the filled-slot name + preposition.

## Resolved decisions

All resolved 2026-07-11 — the `pendingNoun` answer path is, deliberately, the
disambiguation path:

- **Multi-word / adjective answers → act exactly like disambiguation.** The
  answer (`red brick`) re-enters `resolveCandidates`/token-bag resolution, never
  treated as a fresh command — the same handler the disambiguation reply uses.
- **"it" / pronoun answers → reuse it.** `take` → `it` binds through the existing
  pronoun-antecedent path (`noteAntecedent`), same as any resolved direct object.
- **Wrong-type answer → fail.** `give lamp to` → `lamp` (a thing, not the person
  recipient) produces the generic failure, not a re-ask — consistent with
  disambiguation's 0-match fall-through.
- **Opt-out → already covered.** No per-action opt-out flag is needed: a verb
  with a bare form (`unlock door` → `unlock_keyless`) never prompts because a
  complete match wins, and a verb whose input yields no single partial candidate
  falls through. "No bare form + a unique partial" is exactly when a prompt is
  wanted.
- **Direction interrogative → confirmed.** `direction` is a non-`physical` slot
  type (like `subject`), distinguishable at match time, so "Which way" is
  selectable from the slot type alongside who/what.
