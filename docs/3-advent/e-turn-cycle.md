# Every-Turn Rules and the Turn Cycle

## What happens each turn

For each command the player types:

1. The parser resolves it and the action runs through its bands
   (before → instead → check → do → after → report).
2. If an action actually ran — a **turn was spent** — the
   `every_turn_rules` rulebook runs.
3. Scene conditions are evaluated (ends before begins).
4. A light change is announced if one happened.
5. The prompt returns (after the status line refreshes).

Not everything spends a turn: parse failures, disambiguation questions,
and out-of-world verbs (SCORE, SAVE, UNDO…) skip steps 2–4 entirely. A
*refused* in-world action also spends no turn. Each command also
checkpoints undo — one UNDO steps back exactly one command.

A line may hold several commands (`take lamp then go north`, `n.e`); each
is a full turn of its own, and a failure abandons the rest of the line.

## Every-turn rules

`every_turn_rules` is the home of daemons, countdowns, and per-turn
upkeep. Contribute side-effect rules and **don't `stop`** — every
contributed rule should get its chance to run each turn:

```lamp
global int fuse = 10

rule every_turn_rules:
    fuse = fuse - 1
    if fuse == 3:
        print "The hissing from the crate grows urgent.[line break]"
    if fuse == 0:
        print "The crate detonates.[line break]"
        story = lost
```

Rules run after the action's own output, in their own paragraph. Guards
and `during SCENE` scope a rule to when it's relevant:

```lamp
rule every_turn_rules during pursuit:
    ...
```

A rule may end the story (set `story`); the loop notices on its next
check. There's no built-in "fire at turn N" scheduler yet — a counter in
an every-turn rule, as above, is the pattern.

NPC life also lives here: an every-turn rule that moves or acts an NPC
each turn is a wandering character — see
[NPCs and Movement](f-npcs.md).

## Waiting

`wait` (`z`) is the player-side counterpart: an action that changes
nothing but legitimately spends the turn, letting your daemons advance.
`sleep` similarly refuses by default but spends the turn — a scripted
dream can run on every-turn rules.

---

Next: [NPCs and Movement](f-npcs.md).
