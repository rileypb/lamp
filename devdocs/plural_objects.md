# Group / Plural Objects

> Status: **implemented (2026-07-11).** The presentation half already existed (the
> `plural` field); the one new mechanism — the unified **"them"** pronoun — is now
> built (`src/lamplighter/index.js`: `noteGroupAntecedent` / `pronounGroupOf`; en-US
> `groupAntecedentWords`). Golden `themgroup1`. Defines the design for **collective plural
> objects** in lib/advent — a single entity that reads and agrees as plural ("the
> rats are here", "attack them"), as opposed to a modeled set of individuals.
> Companion to the "group/plural objects" line in `lurking_todo.md` and to
> `devdocs/text.md` D (adaptive pronouns/verbs).
>
> The explicit goal is to **avoid Inform's plural-object mess**, whose root cause
> is one construct trying to be three incompatible things at once (below). We pick
> exactly one and refuse the others.

## Purpose

Let an author declare a swarm/crowd/mass — "the rats", "the urchins", "the audience"
— as **one object** that presents grammatically plural: plural article ("some
rats"), plural verb agreement ("the rats **are** here"), and the **"them"/"they"**
pronoun. The player refers to and acts on it as a unit; it is never decomposed into
members.

## The taxonomy (why Inform is a mess, and what we are *not* building)

"Plural object" conflates three genuinely different things:

1. **Collective unit** — one object that merely reads plural (the swarm). No
   members, no count. **← this is what we build.**
2. **Indistinguishable duplicates** — N interchangeable coins; TAKE takes one,
   "hold two". **Not built** (see Non-goals).
3. **Named set of distinct things** — "the tools" = {hammer, wrench}, individually
   manipulable. **Not built.**

Inform serves #1/#2/#3 with overlapping "plural-named kind" + "indistinguishable
from" + "multiply-present" machinery, so authors can't tell which semantics they
get. We model **only #1** and make #2/#3 explicit non-goals. Almost every hard
problem in this area is really "the answer differs per category," so refusing to
unify them is the whole design.

## The three framing decisions

- **(a) One collective object; members are NOT individually referable.** This is
  the decision that dodges the swamp. Member-addressability is what forces a
  part-of relation, per-action "swarm or member?" ambiguity, and — fatally under
  our adjective-free **token-bag** parser — an unanswerable "Which rat?" among
  identical members (they share one token bag; the bare-word disambiguation reply
  cannot separate them). Non-referable members delete all of it.
- **(b) The "them" pronoun is unified** — one antecedent slot serving both a
  plural collective object and the result of a multiple-object command. The
  antecedent table is already per-word (`pronounAntecedents: Map<word, referent>`),
  so this is a small addition (below).
- **(c) Counting is a non-goal** — no "take two", no fission/fusion, no
  collapse-N-identical. Decision (a) makes this clean: with no members and no
  count, there is nothing to partition.

## What already works (presentation)

A single plural object is **mostly built today** — setting the existing
author-field is enough for correct plural presentation:

- `bool plural` on `thing` (`lib/advent/types.lamp`) — an author writes
  `item rats: plural` (optionally `plural_name "rats"` for an irregular head).
- en-US locale (`lib/en-US/index.js`): `is_plural` → `indefinite` renders
  **"some rats"**; `descriptor_of` maps a plural thing to the `they` pronoun preset
  → **them/they** and **plural verb agreement** ("the rats **are** here"); naming
  the thing switches agreement onto it (`note_subject` / `renderSetAgreement`);
  `pluralize` / `plural_name` / the irregular-plural table handle display names.
- Antecedents (`src/lamplighter/index.js`): a plural thing is filed under **"them"**
  via the locale's `antecedentWords` hook, so "attack **them**" already resolves to
  a plural object.

So the collective's article, agreement, pronoun, and naming are done. This doc's
*new* work is small and mostly about identity semantics and the pronoun unification.

## Design

### The collective object

An ordinary `thing`/`item` with `plural` set. It is one object in scope, one entry
in the room listing (rendered "some rats"), one dispatch per action — no iteration,
no members. `initial_appearance` gives it a bespoke presence line ("There are
urchins here.") exactly as for any object; the generic list otherwise renders it via
`indefinite` ("… some rats here.").

**Interaction with ALL / `multi`.** A collective is a single object, so `take all`
would sweep it as one item and report once ("the rats: …"). Whether a given swarm
should be swept is the **author's** call via the existing `all_exempt` flag (the
`all`-includes filter in `actions.lamp` already honors it) — no new mechanism. The
collective is never *expanded* into members, so it never causes per-item explosion.

### The "them" unification (the one new mechanism)

Today `pronounAntecedents` maps each pronoun word to a **single** referent. Extend
the **"them"** slot to hold *either*:

- a single plural object (a collective — already the case), **or**
- a **group** (the ordered objects of the most recent multiple-object command).

Two wiring points:

1. **Bind on multi.** After a multiple-object command resolves (the `multiOut`
   path in `resolveSlots` / `resolveAllPhrase` / `resolveMultiPieces`), file
   `multiOut.objects` under "them" (a group referent), alongside the existing
   per-object "it" binding. So `take lamp and rope` sets them→[lamp, rope] and
   it→rope.
2. **Resolve by shape.** When a slot's noun is the pronoun "them":
   - group referent → feed the **multi** dispatch path (as if the player retyped
     the list); against a non-`multi` verb, refuse with `parser_no_multi` — exactly
     as a typed list does.
   - single (plural) object → bind the slot to it; single dispatch.

Last-writer-wins across the two sources (naming the rats, then `take lamp and
rope`, then "them" = the group) — ordinary pronoun semantics. No second "them"
notion; the collective and the multi-result share one slot.

**Implemented (2026-07-11).** `pronounAntecedents` values may now be an array (a
group) as well as a single object. `noteGroupAntecedent(objects)` files a 2+-object
result under the locale's `groupAntecedentWords` (en-US: `["them"]`), called after
the existing per-object `noteAntecedent` in `resolveAllPhrase` / `resolveMultiPieces`.
`pronounGroupOf(span)` returns the bound array; `resolveSlots` feeds it through
`multiOut` for a multi verb's direct slot (scoped/typed, empty→unresolved), and the
grammar-match classifier flags a group-"them" against a non-multi verb as a
multiple-object attempt → `parser_no_multi`. The `pronoun` state provider serializes
array values as name-lists (save/undo). Golden `themgroup1`.

## Non-goals

- **Indistinguishable duplicates (#2) and named sets of distinct things (#3).**
- **Counting / partitioning** — "take two coins", "drop half", numeric
  quantifiers on a multi slot, object **fission/fusion**.
- **Collapse-and-count listing** — "three rats here" from three objects. (A single
  collective needs none of this; it is one object rendered "some rats".)
- **Individually referable members** — no member objects, no part-of relation, no
  "examine a rat" vs "examine the rats" disambiguation.
- **Per-member state** — a collective holds none ("one urchin is asleep" is out of
  scope by construction; it is one object).

## Open questions

- **Verb agreement in the room-listing frame.** Confirm the "[We] [see] … here."
  frame renders a contained plural correctly ("You see some rats here.") — the
  frame's verb is player-viewpoint, but check the object phrase pluralizes via
  `indefinite`.
- **Group-"them" snapshot vs. live.** The group bound on a multi command should be
  a **snapshot** of the named objects (Inform-like), not a live query — confirm
  nothing expects it to track world changes.
- **"them" after a partial/failed multi.** If some pieces failed to resolve, does
  "them" bind the successful subset, the full typed set, or nothing? Lean: the
  resolved subset (what actually acted).
- **Does a group-"them" survive into AGAIN?** A replayed command should re-run the
  literal text, not a stale group — confirm the AGAIN target is the source command,
  so this is moot (consistent with the disambiguation-splice rule).
- **Mixed singular/plural "it" vs "them".** After `take lamp and rope`, "it"=rope
  and "them"=group; confirm both antecedents coexist without one clearing the
  other.
