# Actions

## From command to action

Each turn, the parser matches the player's line against the registered
grammar, resolves each `[slot]` to an in-scope object of the slot's type,
and runs the matched action through its rule bands (see
[Rulebooks](../2-language/g-rulebooks.md)). Along the way it handles
articles, pronouns (`it` tracks the last direct object), ambiguity
("Which do you mean, the brass key or the iron key?"), missing nouns
("What do you want to take?"), multiple objects on `multi` actions
(`take all but the sword`), command sequences (`take lamp then go north`,
or `n.e`), and AGAIN/G.

## The standard verbs

Grouped by temperament rather than alphabetically:

**Sensing** — `look` (`l`), `examine` (`x`, `read`), `look <direction>`,
`look in`, `look under`, `look behind`, `search`, `touch` (`feel`),
`listen [to]`, `smell` (`sniff`). EXAMINE prints `description` (and an
open container's contents); TOUCH prints `feels`; LISTEN and SMELL print
`sound`/`scent` and work at a distance and in the dark.

**Manipulation** — `take` (`get`), `take X from Y`, `drop`, `put X on Y`,
`put X in Y`, `wear`, `take off` (`remove`), `open`, `close`, `lock` /
`unlock [with]`, `turn on` / `turn off`, `push`, `pull`.

**Movement** — `go <direction>` (or the bare direction), `enter` /
`sit on` / `get in`, `get out` / `stand` / `get off`.

**Social** — `give X to Y`, `show X to Y`, `ask X for Y`, `attack`
(`hit`, `smash`), plus the conversation verbs
([Conversation](g-conversation.md)).

**Meta** (out-of-world, no turn spent) — `score`, `verbose` / `brief` /
`superbrief`, `save`, `restore`, `undo`, `restart`, `quit`, and in debug
builds the developer verbs (`showme`, `purloin`, `gonear`, `tree`,
`scope`, `test`).

`wait` (`z`) and `sleep` are in-world: they change nothing but do spend
the turn.

## The fail-soft pattern

Many verbs **fail by default with a mild message**, existing so your rules
can make specific things respond: `attack` ("Violence isn't the answer"),
`push`, `pull` ("Nothing obvious happens"), `search`, `look under`,
`look behind` ("You find nothing of interest"), `give`, `show`, `ask for`
(the recipient isn't interested), `sleep`. The pattern is always the same:

```lamp
instead look_under when self.target == rug:
    print "A tarnished key lies beneath the rug![line break]"
    move tarnished_key to holder(self.actor)
    stop succeeded
```

Everything you don't handle falls through to the sensible default. In the
other direction, per-object refusal text replaces default messages
declaratively: `take_refusal` and `attack_refusal` fields, and `feels`
for touch.

## Implicit actions

The library performs obvious sub-steps automatically, with the standard
announcement: wearing an uncarried item takes it first ("(first taking
the cloak)"), dropping or hanging a worn item takes it off first. Your
own actions get the same behavior from the helpers:

```lamp
if not implicitly_take(self.actor, self.target):
    stop failed
```

— which announces, silently tries TAKE, and reports failure if the take
itself refuses.

## Writing a new action

Declare the action and its slots, give it grammar, and attach rules:

```lamp
action frob:
    direct item target
    syntax:
        "frob [target]"
        "twiddle [target]"

check frob when self.target.scenery:
    stop failed cant_take_that

do frob:
    ...

report frob:
    print "[The self.target] emits a satisfying click.[line break]"
```

Mark the slot `direct` so `it` refers back to it afterwards. Add
phrasings to *existing* actions (yours or the library's) with
`understand "hang [put_item] on [destination]" as put_on` — usually
better than a new action when the meaning is the same.

Body flags: `multi` lets the direct slot take noun lists and ALL;
`out_of_world` makes a meta-verb (no turn, no undo checkpoint);
`world_scope` resolves slots against the whole world instead of scope
(for debug-style verbs). For `all`, the library's policy skips scenery,
people, and anything flagged `all_exempt`; `take all` skips what's
carried.

---

Next: [Room Descriptions and Looking](d-describing.md).
