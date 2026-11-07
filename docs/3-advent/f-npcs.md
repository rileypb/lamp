# NPCs and Movement

A non-player character is just a `person` placed in a room — instantly
examinable, listed in room descriptions, and reachable by the social
verbs. Life comes from rules.

```lamp
person butler:
    description "Impeccably dressed."
    pronouns "he"
contains Hall butler
```

## NPCs acting

An NPC performs an action the same way your code runs any action — `try`
with an `actor` line:

```lamp
try take:
    taken silver_tray
    actor butler
```

The action runs through the full pipeline as the butler: *his* scope,
the same checks (a locked door refuses him too), and third-person
reports ("The butler takes the silver tray."). Remember the **actor
default**: your unmarked phase rules bind only the player, so world-law
rules that should constrain NPCs too must be marked `actor`
(see [Rulebooks](../2-language/g-rulebooks.md)).

Put behavior on `every_turn_rules` to make it ongoing.

## Movement, witnessed

When an NPC moves, the player sees exactly what they should: a departure
line when they share the room ("The butler goes north."), an arrival line
when the NPC walks in ("The butler arrives from the south."), and nothing
at all elsewhere. A *failed* NPC move is silent — the failure messages
are the player's; your driving code reads the outcome instead:

```lamp
let r = try go:
    actor butler
    way north
```

## Routes

`route_to(here, destination)` returns the first step of a shortest route
through the map as a direction — or `none` when there's no route or
you're already there. The standard travel idiom is one step per turn:

```lamp
rule every_turn_rules when butler_walking:
    let here = location_of(butler)
    if not (here == Yard):
        let next_way = route_to(here, Yard)
        try go:
            actor butler
            way next_way
```

Routes ignore door state — a closed door surfaces as a failed step when
tried, which your rule can notice (have the NPC open it, or wait). This
is how a guard leads the player somewhere: walk one step each turn the
player keeps up.

## Orders: "butler, take the form"

Players command NPCs with the classic comma form. The command resolves
in the *NPC's* scope, then consults the **`persuasion_rules`** rulebook —
default **refuse** ("The butler has better things to do."). Your game
grants permission per NPC, per action, or per situation:

```lamp
rule persuasion_rules when p == butler:
    stop true                                # blanket obedience

rule persuasion_rules when p == urchin and act.action == "go":
    stop true                                # will walk, won't fetch
```

A granted order dispatches with the NPC as actor (third-person reports);
a refused one prints the refusal and spends the turn. Out-of-world verbs
are never orderable. Two special addressed forms: `butler, hello` routes
to greeting, and an unparseable remainder (`butler, boo`) becomes a
directed utterance for `say` rules — both in
[Conversation](g-conversation.md).

## Staging NPCs in prose

A character woven into the room's own description shouldn't also appear
in the contents list. Name them through a substitution
(`"…[the guard] slouches by the door…"`) and the `mentioned` machinery
suppresses the double listing automatically; for flat prose, mark them
`scenery` (people stay conversational and examinable either way). See
[Room Descriptions](d-describing.md).

---

Next: [Conversation](g-conversation.md).
