# Scoring

A small opt-in subsystem in core advent. Two globals — `score` and
`max_score` — and one function. Opt in by setting the maximum, at top
level or in a startup rule:

```lamp
max_score = 3
```

Award points from any rule with `award_points(n)`, which bumps the score
and prints the traditional notification in its own paragraph:

```lamp
after take when self.taken == coin:
    award_points(1)
```

```
> take coin
[Your score has just gone up by one point.]
Taken.
```

The player checks progress with **SCORE** (out-of-world — no turn):

```
> score
You have scored 1 out of a possible 3.
```

With `max_score` set, the status line's right side switches from the turn
count to "1 of 3 points" in hosts that show one.

For house-style flourishes, wrap `award_points` in your own function
(print a banner, play a fanfare pane) and call that from your rules; at
the end, map the final `score` to a rank in your `end_story_rules`
contribution — see [Ending the Story](i-endings.md).

---

Next: [Ending the Story](i-endings.md).
