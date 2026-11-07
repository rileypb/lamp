# Rulebooks

Rules are how a Lamp game expresses behavior. They come in two forms:
**named rulebooks** — general decision pipelines you declare and invoke —
and **action rulebooks**, the built-in six-band pipeline every player
command runs through.

## Named rulebooks

A rulebook is an ordered list of guarded rules that runs until one rule
decides the result:

```lamp
rulebook string door_state(portal d):
    default "shut"
    when d.locked:
        stop "locked"
```

It has a result type, optional parameters, a required `default`, and rules
(`when GUARD:` plus a body). Following it runs the rules **in declaration
order**: for each rule whose guard is true, the body runs; `stop EXPR` ends
the rulebook with that value; a body that falls through continues to the
next rule; if nothing stops, the `default` is the result. Unlike function
overloads there is no specificity — order decides — and unlike overload
guards, a rule guard *may* use the parameters.

Invoke with `follow`, as an expression or a statement:

```lamp
print "The way north is [follow door_state(oak_door)]."
follow every_turn_rules()
```

### Contributing rules

A rulebook's rules need not live in its declaration. Any file adds one
with:

```lamp
rule RULEBOOK_NAME [when CONDITION]:
    ...
```

This is how a game hooks library rulebooks — the canonical example being
advent's `startup_rules`, where your game contributes its opening text.
Contributions from your file run **before** the declaring library's own
rules, so a game rule gets first say.

## Actions

An **action** is what a player command becomes: a typed object whose fields
are its **slots**, run through a fixed pipeline of rule bands.

```lamp
action take:
    item taken
```

Grammar comes from `syntax:` lines in the action body, or — the usual way
to extend a library action — a top-level `understand` line:

```lamp
understand "hang [put_item] on [destination]" as put_on
understand "read [target]" as examine
```

Each `[slot]` must name a slot of the action; the parser resolves the
player's words in that position to an in-scope object of the slot's type.

### Phase rules and the six bands

Behavior attaches with **phase rules**: a band keyword, an action name, an
optional `when` guard, and a body. The bands run in order:

**before → instead → check → do → after → report**

- **before** — preparation and observation; runs first.
- **instead** — replace the behavior wholesale (the classic
  customization band).
- **check** — validity tests; the natural place to refuse.
- **do** — the action's actual effect (the library defines these for its
  actions).
- **after** — reactions to a completed effect.
- **report** — the success message.

```lamp
instead take when self.taken == idol:
    print "The idol is firmly set in its shrine.[line break]"
    stop failed

after take when self.taken == brass_key:
    print "The key is cold to the touch.[line break]"
```

Inside a phase rule, `self` is the running action: its declared slots
(`self.taken`, `self.way`…) plus two implicit fields — `self.actor` (who is
acting) and `self.action` (which action, useful in multi-action rules).

`stop succeeded` / `stop failed` ends the whole action with that outcome;
if no rule stops, the action succeeds. Your rules run before the library's
in each band, so a game rule can preempt — or, with a print plus a bare
`stop` in a `report` band, replace the library's message.

### Failure reasons and `report failed`

`stop failed` may carry a **reason** — a named cause the reporting band can
render:

```lamp
check take when self.taken == idol:
    stop failed too_sacred

report failed take:
    if self.reason == too_sacred:
        print "The idol is too sacred to disturb.[line break]"
        stop
```

Reasons are auto-created from use — writing `stop failed too_sacred`
declares the reason object implicitly, and a mistyped reason in a
comparison is a compile error, not a silent never-match. The
`report failed` band runs only for failed actions; with no matching rule, a
failed action prints nothing.

### The actor default

A phase rule matches **only the player** unless marked otherwise. NPCs run
actions too (via orders and `try`); writing `actor` after the band word
opts the rule into any actor:

```lamp
check actor take:      # binds every actor, NPCs included
    ...
instead take:          # the player only; an ordered NPC sails past
    ...
```

The default protects ordinary game rules from NPC leakage; mark shared
world-law rules `actor` when you write NPC-driven content.

### Rules in type and object bodies

A phase rule may live inside a type or object body, implicitly scoped to
it — behavior stays with the thing it belongs to:

```lamp
type commando < item:
    instead attack:
        if self.target.defeated:
            print "Attacking a defenseless person isn't your style.[line break]"
            stop failed
```

A type-body rule adds an implicit guard that the action's *direct* object
is of that type (subtypes included); an object-body rule guards on that
object. `when` and `during` compose as usual.

### Action selectors

The action position of a phase rule accepts a **selector** over sets of
actions instead of one name:

```lamp
instead any except go except look when in_darkness(self.actor):
    print "In the dark? You could easily disturb something.[line break]"
    stop failed
```

`any` is every action; an action name is itself; a **tag** (declared with
a `tags` line in an action body) names a group; `and`, `or`, `not`,
`except`, and parentheses combine them. The set is resolved at compile
time. A selector rule may only touch slots every selected action has — in
practice `self.actor`, `self.action`, and `self.reason`.

### Running actions from code: `try`

```lamp
try take:
    taken lamp
```

`try` builds an action instance and runs it through the bands. As an
expression it yields the outcome (`succeeded`/`failed`); slot lines take
literals, object names, or property chains. Two refinements:

```lamp
silently try doff:
    clothing self.put_item
    actor self.actor
```

`silently` runs the action but suppresses its report bands — for implicit
sub-actions whose own messages would be noise (this is how hanging a worn
cloak takes it off without printing "You take off the cloak"). The `actor`
line runs the action as someone else — the foundation of NPC behavior (see
[NPCs and Movement](../3-advent/f-npcs.md)).

### Action modifiers

Three body-level flags change how an action relates to the world
(details in [Actions](../3-advent/c-actions.md)):

- `out_of_world` — a meta-verb (SCORE, SAVE): runs normally but spends no
  turn, takes no undo checkpoint, and fires no every-turn rules.
- `world_scope` — slots resolve against every object in the world, not
  just what the actor can see (debug verbs like PURLOIN use this).
- `multi` — the direct slot accepts noun lists and ALL (`take all`,
  `drop the ball and the umbrella`), dispatching the action once per
  object.

---

Next: [Scenes](h-scenes.md).
