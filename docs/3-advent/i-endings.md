# Ending the Story

The story's state lives in one global: `story`, which is `ongoing` until
a rule of yours declares otherwise:

```lamp
report examine when self.target == sawdust:
    if disturbance == 0:
        print "The message, neatly marked in the sawdust, reads...[line break]"
        story = won
    else:
        story = lost
    stop
```

Setting `story` to `won` or `lost` ends the game at the close of the
turn: every active [scene](../2-language/h-scenes.md) ends (their end
hooks may contribute closing text), the `end_story_rules` rulebook prints
the closing banner, and the session drops to the end-of-story prompt:

```
*** You have won ***

Please type RESTART, RESTORE, or QUIT.
```

The prompt honors the full Infocom triad — RESTART begins the game over
(intro and all), RESTORE loads a save and resumes play, QUIT exits. Only
those meta-verbs work there; the ended game can't be nudged with LOOK or
TAKE.

## Custom ending text

`end_story_rules` is an ordinary rulebook with library rules for the two
banners; contribute your own rule to replace them (game rules run first
and `stop` the default):

```lamp
rule end_story_rules when story == lost:
    print "*** Game over, friend. ***[line break]"
    stop true

rule end_story_rules when story == won:
    print "*** You have prevailed"
    if score == max_score:
        print " — flawlessly"
    print " ***[line break]"
    stop true
```

This is the place to render a rank from the final score, tally
achievements, or print an epilogue paragraph before the banner.

## Beyond won and lost

Nothing restricts a game to two endings — branch inside your
`end_story_rules` on any state you track (which room, which scene
happened, what the player carried). During play, RESTART also works
mid-game with a confirmation prompt, and QUIT confirms before exiting;
both are standard library behavior your game gets for free.

---

This concludes Part III. Continue with
[Part IV — Presentation and Polish](../README.md#part-iv--presentation-and-polish),
starting with customizing the library's messages.
