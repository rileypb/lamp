# Scenes

A **scene** is a named, latched span of play time with begin and end
hooks — the structural device for dramatic modes: a meeting, a fight, a
hack in progress, an ambush.

## Declaring a scene

```lamp
scene ambush:
    begins when in_region(location_of(player), the_base) and alarm_raised
    ends when commandos_down == 2
```

A scene is a singleton object with three engine-maintained fields you can
read anywhere:

- `ambush.active` — happening right now.
- `ambush.happened` — has begun at least once, ever.
- `ambush.recurring` — set by a bare `recurring` line in the declaration; a
  non-recurring scene that has ended never re-begins from its conditions.

You *read* these; you never assign them (that's a compile error — a direct
write would skip the begin/end hooks).

## Transitions

`begins when` / `ends when` take global-scope boolean conditions (globals,
named objects, function calls — they should be pure reads). Both are
optional and repeatable; several conditions OR together. A bare
`scene heist` with no body is valid too — a purely imperative scene you
drive yourself with the functions:

```lamp
begin_scene(heist)
end_scene(heist)
```

These transition immediately, mid-turn, and are no-ops when the scene is
already in the target state.

Declared conditions are evaluated once per turn (after every-turn rules;
plus once at startup, so a scene whose condition already holds is active
before the first prompt), with ends processed before begins. When the
story ends, every active scene ends, so an end hook can contribute to the
closing text.

## Hooks

Every transition dispatches an event named after the scene —
`NAME_begins` / `NAME_ends`:

```lamp
on heist_begins:
    print "The alarm panel goes dark.[line break]"
```

And every rule or handler form accepts a **`during SCENE`** guard, gating
it on the scene being active:

```lamp
before any except attack except shoot during ambush:
    print "No time for that — they're on you![line break]"
    stop failed

rule every_turn_rules during watch:
    ...
on gadget.setting change during watch:
    ...
```

`during` sits after the rule's header, before any `when` guard; the two
compose. The scene name is checked at compile time.

## Chaining scenes

Inside a scene body's conditions — and only there — `SCENE begins` and
`SCENE ends` are edge atoms, true exactly when that scene began or ended
*this turn*:

```lamp
scene pursuit:
    begins when ambush ends and story == ongoing
```

Unlike the level test `ambush.happened and not ambush.active`, an edge atom
is true for a single evaluation pass, so it anchors correctly to *each* run
of a recurring predecessor. Scenes that chain this way transition in the
same turn.

## Scenes and saves

Because a scene's state is ordinary fields on a named object, undo, save,
and restore capture it with no extra machinery — and a restore never
re-fires transition hooks.

---

Next: [Statements and Expressions](i-statements-and-expressions.md).
