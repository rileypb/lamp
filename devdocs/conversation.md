# NPC Conversation — greet, order, ask-for, and topics

> Status: **implemented (2026-07-12).** Engine: the `X, COMMAND` addressing
> fallback in `runCommand` (after the grammar pass, so greet's comma templates
> win first), `orderMode`/`orderUnparsed`, and `setPersuasionGate` (dispatch
> consults it with `act` exposed; refusal spends the turn). advent:
> `persuasion_rules` rulebook + `persuasion_gate` (installed at startup),
> `ask_for` (en `ask X for Y`, fr `demander Y à X`). lib/conversation: `greet`
> (incl. the "[interlocutor] , hello" templates), bare `hello`, topics widened
> to `thing`, `say` gains the engine-filled `interlocutor` slot. Golden
> `conversation2` exercises the whole surface. **Implementation deviations:**
> an ordered out-of-world verb falls back to the directed utterance (not "not
> understood"); a disambiguation answer resumed mid-order bypasses persuasion
> (v1 limitation); ordered parse failures (including would-be missing-noun
> prompts) silently become the directed utterance; `wait` was added to the
> en-US `verb` list for the greet default's conjugation.
> Designs the last Lurking Horror triage
> cluster — `talk to X` / `hello`, `X, COMMAND` (ordering an NPC), and
> `ask X for Y` — and the ask-about-objects extension, as one coherent
> conversational surface. Companion to `lib/conversation/conversation.lamp`
> (the existing opt-in ask/tell/say library) and `devdocs/accessibility.md`
> (the `visible` slot level conversation leans on).

## Current state

Already built, and unchanged by this design:

- **`lib/conversation`** (opt-in by design): `subject` topics carrying a
  `reply`; `ask [interlocutor] about [topic]` (prints the reply or a puzzled
  default); `tell … about …`; free-text `say/answer [string]` utterances
  (fail-by-default; games hook `instead say`). Interlocutor slots are
  `visible` — talking is vocal and works through the glass booth.
- **`give X to Y` / `show X to Y`** in core advent (fail-by-default with
  per-NPC `instead` reactions).
- Actor infrastructure the orders build on: every action carries `self.actor`;
  reports already have `_other` variants ("The urchin takes the lamp");
  `run_command(cmd, actor)` runs a command as any actor (the NPC-"me" fix);
  the accessibility gate is actor-parametric, so an ordered NPC's reach is
  gated automatically.

## Resolved decisions

- **Persuasion is a rulebook** (Inform-style), default **refuse** — not an
  `obedient` flag. Flexible per-NPC/per-action/per-scene grants.
- **Placement:** greeting + topics live in `lib/conversation`; `ask X for Y`
  lives in **advent** beside give/show (it moves objects — the "economy"
  verbs); the `X, COMMAND` *parsing* lives in the **engine** with the
  persuasion *policy* installed by advent (the `set_reach_gate` pattern).
- **Ask-about-objects is in scope** — the topic slot design below.

## Design

### 1. Greeting — `talk to X`, `greet X`, `hello` (lib/conversation)

A `greet` action, deliberately modest: its job is to *steer the player toward
the real conversation verbs*, and to give games a single hook for an opening.

```lamp
action greet:
	direct visible physical interlocutor
	syntax:
		"talk to [interlocutor]"
		"greet [interlocutor]"
		"say hello to [interlocutor]"
```

- Default report: `greet_default` — "[The act.interlocutor] [wait] for [us] to
  say something." (the Lurking Horror nudge). A game gives an NPC a real
  opening with `instead greet when self.interlocutor == hacker: …` — the same
  override story as every fail-soft verb.
- Refuses a non-`person` target (`greet_not_person` — "[We] [get] no reply.").
- **Bare `hello`** (no addressee): an objectless `hello` action printing
  `hello_reply` — the "Cheery, aren't you?" rider, a named message games
  retheme. (No "guess the addressee" magic; if exactly-one-NPC inference is
  ever wanted, it belongs to `devdocs/command_inference.md`, not here.)
- **`X, hello`** routes to `greet X` — see the addressing special case below.

### 2. Ordering an NPC — `X, COMMAND` (engine parse, advent policy)

The big piece, and mostly parser work.

**Parsing (engine, `runCommand`).** Before the grammar pass, detect the
addressing form: a leading span, a comma, a remainder. The leading span must
resolve to a **`person` in the player's scope** (visible — an order is vocal);
otherwise the comma is not an address (it may be a multi-object list, which
only occurs *after* a verb, so the forms don't collide: an addressing comma
follows a *leading noun phrase*, a list comma follows a verb's slot). Then:

1. **`X, hello`** (the remainder is a greeting word) → dispatch `greet X` as a
   *player* action — greeting is the player's act, not an order.
2. **The remainder parses as a command** → resolve it with **`actor = X` and
   X's scope** (Inform's model: the urchin takes what *the urchin* can see;
   the existing actor-parametric resolution and accessibility gate do this for
   free). Before dispatch, consult the **persuasion gate** (below). Refused →
   print the refusal, spend the turn. Granted → dispatch with `actor = X`;
   the `_other` report variants render ("The urchin takes the lamp.").
   Out-of-world verbs are never orderable ("urchin, save" → not understood).
3. **The remainder parses as nothing** → a **directed utterance**: dispatch
   `say` with the raw remainder AND the addressee (a new optional
   `interlocutor` slot on `say`, `none` for plain SAY). This is exactly the
   Lurking Horror case — `urchin, boo` → a game's
   `instead say when self.topic == "boo" and self.interlocutor == urchin`.
   The default stays "There is no reply."

**Persuasion (advent policy, engine hook).** Mirroring `set_reach_gate`:

- Engine: `setPersuasionGate(fn)`; called as `fn(npc, instance)` after the
  order resolves and before dispatch. Truthy = **granted**.
- advent installs `persuasion_gate` at startup, which follows a new rulebook:

```lamp
rulebook bool persuasion_rules(person p):
	default false
```

  Default refuse: the gate prints `persuasion_refused` — "[The p] [have]
  better things to do." — and reports blocked. A game grants per-case:

```lamp
rule persuasion_rules when p == urchin and act.action == "go":
	stop true
```

  (The resolved order is the running `act` inside the rulebook, so rules can
  discriminate on the action and its slots.) A blanket-obedient NPC is one
  rule: `rule persuasion_rules when p == robot: stop true`.
- A refused order **spends the turn** (the NPC declined; time passed). A
  granted order's turn accounting is the dispatched action's own.

**Interaction notes to honor in implementation:** disambiguation and
missing-noun prompts raised while resolving an order carry the NPC actor
through their pending state (both flows are instance-carrying already); AGAIN
replays the whole addressed command; the pronoun antecedents ("it") set by an
order follow the existing direct-slot rules.

### 3. `ask X for Y` (advent, with give/show)

The reverse of give — the NPC hands something over:

```lamp
action ask_for:
	direct visible physical interlocutor
	item requested
	syntax:
		"ask [interlocutor] for [requested]"
```

- Fail-by-default: `ask_for_declined` — "[The act.interlocutor] [do] not seem
  inclined to part with [regarding act.requested][those]." A game hooks
  `instead ask_for` and does its own `move` + reply.
- `requested` resolves in the player's scope — an NPC's carried items are in
  scope (containment fixpoint through a person), which is exactly the use
  case: `ask professor for stone`. `requested` stays touchable-defaulted?
  **No — mark it `visible`**: you're asking, not grabbing; the *NPC* does the
  transfer. (The glass-booth case: asking the guard for the key through the
  glass is a fair request; whether he opens the booth is the game's story.)
- `interlocutor` is `direct`… no: `requested` is the natural `it` antecedent
  (`ask her for the stone. examine it`). Mark `requested` **direct**.

### 4. Topics — asking about objects (lib/conversation)

Today `[topic]` is a `subject` slot (a non-physical `thing`), resolved
globally. To let `ask hacker about moonstone` work without declaring a
`moonstone` subject, **widen the slot to `thing`**:

```lamp
action ask:
	visible physical interlocutor
	direct thing topic
```

- A `thing` slot is non-`physical`-rooted, so it resolves **globally** —
  subjects as before, plus every physical object by name. Global is *correct*
  for conversation: you may ask about the moonstone from another room (you
  remember it). It also sweeps in odd referents (rooms, directions); they
  resolve, hit the default puzzled reply, and are harmless.
- Reply resolution order: a `subject`'s `reply` as today; a physical topic has
  no `reply` field, so it falls to the puzzled default — games answer with
  `instead ask when self.topic == moonstone`. (Adding a `reply`-bearing field
  to `physical` is deliberately avoided; lore stays in subjects or rules.)
- `tell` widens identically. `direct` moves to `topic` so `it` tracks the
  thing discussed (matching ask_for above).
- **Spoiler gate** (asking about an object the player has never seen) is a
  real concern but needs a "seen/known" model advent doesn't have — recorded
  as an open question, not solved here.

## The authoring story (what a game writes per NPC)

```lamp
person hacker

rule persuasion_rules when p == hacker and act.action == "give":  # obeys "hacker, give…"
	stop true

instead greet when self.interlocutor == hacker:
	print "The hacker looks up. 'Yes? I'm compiling.'"
	stop succeeded

subject keys_topic:
	understand "keys/key"
	reply "'Master keys? Talk to the urchin,' the hacker mutters."

instead ask_for when self.interlocutor == hacker and self.requested == manual:
	print "'Take it, I know it by heart.'"
	move manual to player
	stop succeeded
```

One greeting rule, topic subjects, persuasion grants, and ask-for handovers —
each independent, all optional, everything fail-soft without them.

## Non-goals

- **Conversation menus / dialogue trees** — a different UI paradigm; a game
  can build one on `say`.
- **NPC-initiated conversation** — that's every-turn-rules content (daemons).
- **A knowledge model** (who knows what, seen/known gating) — open question.
- **`X, COMMAND` for multiple addressees** ("guards, follow me") — the plural
  collective object *is* orderable as one addressee; per-member fan-out is not
  modeled (collectives have no members, by the plural design).
- **Speech acts beyond these** (whisper/shout/lie) — games re-theme or extend.

## Open questions

- **Per-NPC greeting as data.** `instead greet` rules work today; a
  `greeting` text field on `person` (the `feels`/`sound` pattern) would be
  nicer authoring but needs either a field added in advent's `person` (core
  paying for an opt-in lib's feature) or type reopening (a language feature).
  Start rules-only.
- **Seen/known gating for topics** — see above; likely wants a general
  "player has encountered X" bit (`handled` is close but take-only).
- **Ordering through glass.** An order is vocal, so the addressee is
  `visible` — but should a *granted* order let the NPC act even though the
  player couldn't reach them? Yes (the NPC uses their own reach); confirm the
  gate runs with the NPC actor (it does — actor-parametric).
- **Refusal turn-accounting edge:** an order that fails to *resolve* (unknown
  noun in the remainder) should behave like any parse failure (no turn),
  reserving the turn-spend for an actual persuasion refusal. Confirm in
  implementation.
- **`say` gains an `interlocutor` slot** — confirm a `none`-default object
  slot alongside a `string` slot parses cleanly in the grammar (the directed
  form is only ever built by the addressing parser, never typed).
