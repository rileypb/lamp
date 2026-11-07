# Tutorial: Cloak of Darkness

*Cloak of Darkness* is the traditional demo game of IF systems — a
specification small enough to implement in an afternoon, rich enough to
exercise a system's core features. The rules, per
[the spec](https://www.ifwiki.org/Cloak_of_Darkness):

- Three rooms: a **Foyer**, a **Cloakroom** to the west, and a **Bar** to
  the south.
- The player wears a **velvet cloak**. The Bar is **dark** while the cloak
  is in it — the cloak seems to swallow light.
- The Cloakroom contains a **hook**; the cloak may only be put down there.
- The Bar's floor has a **message in the sawdust**. Doing anything in the
  dark Bar risks disturbing it. Reading the message ends the game: you win
  if the sawdust was never disturbed, lose otherwise.

We'll build it in six steps. The finished game ships with Lamp as
`sample/cloak.lamp`; every snippet here is drawn from it. To follow along,
put each stage in a file and run `lantern-exe` on it (or
`node src/lantern/exe.js` from the repo).

## Step 1: The map

```lamp
lib advent

game Cloak_of_Darkness:
    author "Roger Firth"
    tagline "A Lamp port of the classic text adventure"
    version 0
    release dev
    start Foyer

room Foyer:
    description "You are standing in a spacious hall, splendidly decorated in red and gold, with glittering chandeliers overhead. The entrance from the street is to the north, and there are doorways south and west."

room Bar:
    description "The bar, much rougher than you'd have guessed after the opulence of the foyer to the north, is completely empty. There seems to be some sort of message scrawled in the sawdust on the floor."
    lighted false

room Cloakroom:
    description "The walls of this small room were clearly once lined with hooks, though now only one remains. The exit is a door to the east."

bidi connects Foyer south Bar
bidi connects Foyer west Cloakroom
```

One new thing: `lighted false`. Every room has a `lighted` field, `true` by
default; setting it false makes the room dark. That's all it takes — walk
south and the library handles the rest:

```
> south
Darkness
It is pitch dark, and you can't see a thing.
```

For now the Bar is permanently dark. In step 4 we'll flip `lighted` based on
where the cloak is.

## Step 2: Introductory text

Games traditionally open with a scene-setting paragraph before the first
room description. The library provides a hook for it — a *rulebook* called
`startup_rules` that runs after the banner and before the opening room. You
contribute a rule to it:

```lamp
rule startup_rules:
    print "Hurrying through the rainswept November night, you're glad to see the bright lights of the Opera House. It's surprising that there aren't more people about but, hey, what do you expect in a cheap demo game...?"
    print "[par]"
```

`print` outputs text. The `[par]` inside the string is a *text
substitution* — this one emits a paragraph break. You'll also see
`[line break]` later; square brackets inside strings are how Lamp text stays
dynamic.

## Step 3: The objects

The cloak, the hook, and the sawdust:

```lamp
room Bar:
    description "The bar, much rougher..."
    lighted false
    item sawdust:
        scenery
        understand "message/writing/floor"

room Cloakroom:
    description "The walls of this small room..."
    item hook:
        description "It's just a small brass hook, screwed to the wall."
        scenery
        supporter

item velvet_cloak:
    description "A handsome cloak, of velvet trimmed with satin, and slightly splattered with raindrops. Its blackness is so deep that it almost seems to suck light from the room."
    wearable

wears yourself velvet_cloak
contains yourself velvet_cloak
```

New ideas here:

- **Nested declarations.** An `item` declared inside a room's block starts
  in that room — no separate `contains` line needed. The sawdust lives in
  the Bar, the hook in the Cloakroom.
- **`scenery`** marks an object as part of the room: it isn't listed in the
  room description ("You see a sawdust here" would be silly) and can't be
  taken.
- **`understand "message/writing/floor"`** adds synonyms. The player can
  READ MESSAGE, EXAMINE WRITING, or LOOK AT FLOOR and reach the sawdust.
- **`supporter`** makes the hook something you can put things *on*.
- **`wearable`** makes the cloak something you can WEAR and TAKE OFF, and
  **`wears yourself velvet_cloak`** starts the game with it worn.
  `yourself` is the player object the library provides; the `contains` line
  puts the cloak in the player's possession, and `wears` marks it worn
  rather than merely carried.

## Step 4: Darkness that follows the cloak

Now the real trick: the Bar is dark exactly when the cloak is there with
you. The tidy way to do this is to update `Bar.lighted` at the moments it
could change — just before the player walks in, and after the cloak is
dropped or hung up:

```lamp
before go:
    let here = holder(self.actor)
    let dest = connects here self.way ?first
    if dest == Bar:
        Bar.lighted = not (holder(velvet_cloak) == player)

after put_on when self.put_item == velvet_cloak:
    Bar.lighted = not (holder(velvet_cloak) == player)

after drop when self.dropped == velvet_cloak:
    Bar.lighted = not (holder(velvet_cloak) == player)
```

This is your first sight of **action rules**, the heart of a Lamp game. When
the player types GO SOUTH, the library runs the `go` action through a series
of *bands*: `before` rules, `instead` rules, checks, the action itself, then
`after` and `report` rules. A rule names the band and the action
(`before go`), optionally with a `when` guard; inside, `self` is the running
action, so `self.actor` is who's acting, and each action exposes its slots as
fields — `go` has `self.way` (the direction), `put_on` has `self.put_item`,
`drop` has `self.dropped`.

Two library functions do the world-model queries: `holder(x)` returns
whatever directly contains `x` (a room, a container, or a person), and
`connects here self.way ?first` asks the map relation for the room this
direction leads to. `player` is a global holding the current player object.

So: before any movement, if the destination is the Bar, set its light from
where the cloak is now. After hanging or dropping the cloak (which can only
happen in the Cloakroom, as the next step ensures), refresh it again.

## Step 5: House rules

Two behaviors the spec demands, both written as `instead` rules — the band
that *replaces* an action's normal behavior:

```lamp
instead drop when self.dropped == velvet_cloak and not (holder(self.actor) == Cloakroom):
    print "This isn't the best place to leave a smart cloak lying around.[line break]"
    stop failed

instead go when self.way == north and holder(self.actor) == Foyer:
    print "You've only just arrived, and besides, the weather outside seems to be getting worse.[line break]"
    stop failed
```

`stop failed` ends the action there, marking it unsuccessful — the drop
never happens, the movement never happens; only your message prints.

The dark Bar needs sterner stuff. *Any* action in the dark — except leaving
or looking — disturbs the sawdust. Rather than intercept every verb by name,
an **action selector** covers all of them at once:

```lamp
global int disturbance = 0

instead any except go except look when holder(self.actor) == Bar and in_darkness(self.actor):
    print "In the dark? You could easily disturb something.[line break]"
    disturbance = disturbance + 1
    stop failed

instead go when holder(self.actor) == Bar and in_darkness(self.actor) and not (self.way == north):
    print "Blundering around in the dark isn't a good idea![line break]"
    disturbance = disturbance + 1
    stop failed

before look when holder(self.actor) == Bar and in_darkness(self.actor):
    disturbance = disturbance + 1
```

`instead any except go except look` matches every action *but* those two —
including any verbs added to the game later. The excluded pair get their own
handling: going anywhere but north (the way out) disturbs and fails; LOOK is
allowed to proceed (the library prints the darkness text) but still counts
as a disturbance, so it's a `before` rule — observe and let the action
continue — rather than an `instead`. The `global int disturbance` line
declares a game-wide counter for the scoring at the end.

## Step 6: The ending

Reading the message ends the game. There's no separate READ action —
absorbing READ into EXAMINE is the common IF convention, done with a grammar
line:

```lamp
understand "read [target]" as examine

report examine when self.target == sawdust:
    if disturbance == 0:
        print "The message, neatly marked in the sawdust, reads...[line break]"
        story = won
    else:
        print "The message has been carelessly trampled, making it difficult to read.[line break]"
        print "You can just distinguish the words...[line break]"
        story = lost
    stop
```

`understand "read [target]" as examine` teaches the parser a new phrasing
for an existing action — READ X now runs `examine` with X in its `target`
slot. The `report` rule replaces the default examine output for the sawdust
(the bare `stop` at the end suppresses the library's own report, which would
otherwise also print). Setting the `story` global to `won` or `lost` ends
the game: the library prints the closing banner and offers RESTART, RESTORE,
or QUIT.

One last flourish, the same two tools again — a natural phrasing for hanging
the cloak, and a custom success message:

```lamp
understand "hang [put_item] on [destination]" as put_on

report put_on when self.put_item == velvet_cloak:
    print "You hang the cloak neatly on the hook.[line break]"
    stop
```

HANG CLOAK ON HOOK was already reachable as PUT CLOAK ON HOOK (the hook is a
supporter); this just adds the verb players will actually type.

## Play it

The complete game is `sample/cloak.lamp`. The winning path:

```
> west
Cloakroom
The walls of this small room were clearly once lined with hooks, though
now only one remains. The exit is a door to the east.

> hang cloak on hook
(first taking off the velvet cloak)
You hang the cloak neatly on the hook.

> east
Foyer
...

> south
Bar
The bar, much rougher than you'd have guessed after the opulence of the
foyer to the north, is completely empty. There seems to be some sort of
message scrawled in the sawdust on the floor.

> read message
The message, neatly marked in the sawdust, reads...

*** You have won ***

Please type RESTART, RESTORE, or QUIT.
```

Note the "(first taking off the velvet cloak)" — the library noticed the
cloak was worn and took it off implicitly before hanging it. You wrote no
rule for that.

## Where to go next

You've now seen the shape of every Lamp game: declare the world, then bend
the defaults with rules. From here:

- [Part II](../README.md#part-ii--the-lamp-language) covers the language
  properly — the rule bands and `stop`, relations like `connects` and
  `contains`, rulebooks, text substitutions.
- [Part III](../README.md#part-iii--the-adventure-library-libadvent) tours
  what else the adventure library gives you: doors, containers, NPCs,
  conversation, scoring, scenes.
- When your game is ready for players,
  [Part V](../README.md#part-v--testing-and-shipping) shows how to test it
  and ship a web build.
