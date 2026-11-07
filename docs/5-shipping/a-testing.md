# Testing Your Game

Lamp games are unusually testable: by default the random-number stream is
**seeded and deterministic**, so the same commands always produce the same
transcript. The tools below build on that.

## The TEST verb

A `test_script` is a canned command sequence, run in play with
`test <name>` — the commands are queued as if typed, flowing through the
real parser, turn cycle, and story checks:

```lamp
test_script test_dig:
    printed_name "dig"
    understand "dig"
    commands "take trowel/out/i"
```

```
> test dig
> take trowel
Taken.

> out
Garden
...
```

Commands are one `"/"`-joined string. A script may *begin with* another
`test <name>` command — the referenced script expands in place, so you can
build `test endgame` from chapter scripts. The Phobos walkthrough
(`test endgame` in
[sample/phobos/lib/phobos/debug.lamp](../../sample/phobos/lib/phobos/debug.lamp))
drives the entire winning game this way.

**Placement matters.** The TEST machinery is debug-only, excluded from
`--release` builds — so your scripts must be excluded too, or the release
build fails to compile against the missing `test_script` type. Put them in
a per-game library file marked `not_for_release`:

```
mygame.lamp                 # lib advent  /  lib mygame
lib/mygame/debug.lamp       # not_for_release + your test_scripts
```

A file that begins with `not_for_release` vanishes entirely from release
builds — debug shortcuts, cheat verbs, and test scripts all belong there.

Debug builds also carry the developer verbs: `showme X` (dump an object),
`purloin X` (take anything from anywhere), `gonear X` (teleport),
`tree` (the containment tree), `scope` (what's referable right now).

## Transcripts

`script` (or `transcript`) starts mirroring the session — output, prompts,
and typed commands — to a text file; `script off` stops:

```
> script
Name for transcript file: myplay
Transcript started.
```

The CLI writes `myplay.txt` in the working directory; the browser shell
accumulates and downloads it when the transcript closes. Transcripts
record what scrolled past — UNDO and RESTORE don't rewind them, which is
exactly what you want for a bug report.

## Regression testing

The pieces compose into a simple, robust harness with no framework:

```sh
node src/lantern/index.js mygame.lamp build/mygame.js
printf 'test endgame\nquit\ny\n' | node src/lamplighter/play.js build/mygame.js > current.txt
diff expected.txt current.txt
```

Pipe commands on stdin, capture stdout, diff against a blessed
transcript. Determinism makes the diff meaningful: a byte-level change
means behavior changed. This is precisely how Lamp's own test suite works
(the "golden" tests in `tests/golden/` — including the full Phobos
walkthrough), and it scales from a three-command smoke test to a
whole-game walkthrough.

Two things to keep tests deterministic:

- Don't call `randomize()` in code paths tests exercise — that's the
  opt-in to *non*-reproducible randomness. (`seed_random(n)` is fine and
  useful for testing specific variations.)
- Remember `[one of]`/`[at random]` draws come from the seeded stream, so
  they reproduce — different-looking output between runs means something
  else changed.

---

Next: [Saving and Restoring](b-saving.md).
