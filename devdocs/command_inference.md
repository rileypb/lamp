# Command Inference — "Does the Player Mean…"

> Status: **design; not implemented.** Defines candidate *inference*: when a noun
> matches several in-scope objects, ranking them by how plausibly the player meant
> each **given the action**, so an obvious winner is chosen without a disambiguation
> question. This is Inform's "does the player mean…" activity (DPM). Companion to
> the disambiguation flow in `src/lamplighter/index.js` and to
> `devdocs/missing_noun.md` (the sibling parser feature).
>
> Distinct from **implicit actions** (the "(first taking the X)" facility, a separate
> item): that supplies a *missing enabling action*; this picks among *already-matched
> nouns*.

## The motivating example

A gold coin and a silver coin are in the room:

```
> take
What do you want to take?
> coin
Which do you mean: the gold coin or the silver coin?
> silver
Taken.
> take
> coin
```

At the second `coin`, both coins still *match* — the silver is now in your
inventory, the gold on the floor — so today we ask again. But taking the silver
would only report "You're already carrying that." **The only sensible reading is
the gold coin.** Inference lets the parser see that and take the gold one without
asking.

## The philosophical choice

There are two honest stances, and this is genuinely a taste decision:

- **Always ask.** The parser never guesses; every ambiguity is the player's to
  resolve. Never wrong, sometimes tedious, and occasionally insulting ("obviously
  I meant the only takeable coin").
- **Infer when there is a clear winner.** The parser ranks the candidates by
  plausibility and, *only when one strictly out-ranks all others*, picks it
  silently. Convenient, matches human intent, but can surprise a player who had a
  reason to mean the "unlikely" one.

**Lamp's stance (proposed):** infer **only** when exactly one candidate is
strictly the most plausible; otherwise fall back to the existing disambiguation
question — but ask **among the top tier**, so ranking at least *shrinks* the
prompt. Two guarantees make this safe:

1. **Never silently pick a genuine tie.** Two equally-takeable coins → still ask.
   Inference resolves *rank differences*, never coin-flips.
2. **Never hide an object.** A lower-ranked candidate is still nameable — if the
   player types "silver" they get the silver coin, rank notwithstanding. Ranking
   only decides the *default*, never removes a referent from scope.

The coin case is a rank *difference* (takeable vs. already-held), so we infer.
Two identical coins is a *tie*, so we ask. That line — "infer differences, ask
ties" — is the whole policy.

## Design

### Where it hooks in

`resolveSlots` (`src/lamplighter/index.js`) already collects `candidates` for a
slot and, when `candidates.length > 1`, prints the disambiguation prompt and parks
`pendingDisambiguation`. Insert a **ranking step just before that branch**:

1. Rank every candidate for `(instance, field, candidate)`.
2. Keep only the **maximally-ranked** subset.
3. If that subset has **one** member → bind it silently (as if unambiguous).
4. If it has **several** → disambiguate **among them** (the existing prompt, with
   fewer options).

So the change is local and additive; the disambiguation machinery, the
missing-noun re-run, and pronoun binding are all downstream and unchanged.

### The rank scale

Mirror Inform's ladder as a small ordered enum (highest to lowest):

`very_likely > likely > possible > unlikely > impossible`

- Ranking returns one level per candidate; the default is `possible`.
- The winner is the unique candidate at the highest present level.
- `impossible` is special: an `impossible` candidate is dropped from the *default*
  choice but still nameable (guarantee #2). If *every* candidate is `impossible`,
  keep them all (don't invent a refusal) and disambiguate as today.

### Where ranks come from

An installable hook, mirroring `set_all_filter` / `allFilter(instance, obj)`
(`src/lamplighter/index.js`): `set_dpm_ranker(fn)` with
`dpmRanker(instance, candidate) → level`. The library installs a default at
startup; a game replaces or (better) *extends* it. `instance` carries the action
and any already-resolved slots, so the ranker is fully action-aware.

Two candidate sources for the ranker's logic — a real fork to decide:

- **(a) Declarative per-action rules (recommended default).** The library encodes
  a handful of applicability rules: for `take`, a candidate already held is
  `unlikely`; for `drop`/`put`, a candidate *not* held is `unlikely`; for
  `unlock`/`open`, a non-`lockable`/non-`closable` is `unlikely`; etc. Safe, cheap,
  and legible. A game adds its own (`the player probably doesn't mean the red
  herring`).
- **(b) A dry-run of the action's `check` rules.** General — "prefer a candidate
  the action wouldn't immediately refuse" subsumes every case-by-case rule — but it
  requires `check` rules to be **pure** (no side effects) and a way to run them
  speculatively and roll back. Heavier, and risky if a game's `check` mutates.

Proposed: ship **(a)** as the library default (a small, documented set of
applicability rules) and keep **(b)** as an open question to revisit if the
declarative defaults prove too coarse.

### Optional: recency / pronoun bias

A candidate that is the current `it`/`them` antecedent (recently referred to)
could get a small bump (`take` → `examine it` intent). Optional and low-priority;
noted so it isn't accidentally precluded. Must never override a strong
applicability signal (a held coin shouldn't win `take` just because it was "it").

## Interactions

- **Disambiguation.** Ranking runs first and narrows the candidate set; the prompt
  asks among the top tier. If ranking yields one, no prompt.
- **Missing-noun (`devdocs/missing_noun.md`).** The answer to "What do you want to
  take?" is spliced and re-parsed, so ranking applies to the answer with no extra
  work — `take` → `coin` (silver held) resolves to gold directly.
- **`ALL` / multi.** Ranking does **not** apply; `all` takes everything eligible,
  and its analog is the separate `all_includes` filter. Ranking is only for a
  *single* referent that matched several objects.
- **Bound pronouns.** `it`/`them` already resolve to a specific referent (no
  multi-candidate step), so ranking never runs on them.

## Non-goals

- Not a planner or NLU: it ranks objects the grammar *already matched*; it never
  invents nouns or guesses verbs.
- No history/learning beyond the optional pronoun-recency bump.
- Does not change what is *in scope* — only which in-scope match is the default.
- Not implicit actions (a separate item): DPM never *performs* an enabling action,
  it only chooses a noun.

## Open questions

- **Announce or stay silent?** When inference picks a non-obvious default, Inform
  sometimes echoes "(the gold coin)". Silent is cleaner for a clear win; an echo
  is friendlier when the choice was close. Lean: silent when the winner is
  `very_likely`/`likely` and alone; revisit an echo for narrower wins.
- **Sole-candidate ranking.** If a noun matches exactly **one** object that is
  `unlikely`/`impossible` (e.g. `take` the only coin, already held), do we still
  bind it and let the action report the failure ("already carrying"), or refuse at
  parse time? Lean: **bind it** — ranking only breaks ties among *several*
  candidates; a lone match always binds and the action speaks.
- **Rank source (a) vs (b).** Declarative rules vs. a `check` dry-run — see above.
  Start with (a).
- **Does the default library ranker need per-action coverage, or a small generic
  core?** Which verbs get applicability rules first (`take`/`drop`/`put`/`wear`/
  `open`/`unlock`/`lock`), and is that enough for the common cases?
- **Ties that differ only by adjective the player omitted.** Two takeable coins —
  we ask (correct). Confirm ranking never collapses such a tie.
- **Should a game be able to force a question** (opt out of inference for a
  particular verb/scene) — e.g. a puzzle where picking the wrong twin matters? A
  per-action or global "never infer" switch, or just: rank both `possible` (a tie)
  so it always asks.
