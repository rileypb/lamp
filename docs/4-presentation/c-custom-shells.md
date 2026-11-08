# Custom Shells

For presentation beyond text and panes — sound, motion, full-page art
direction, bespoke UI — a game can ship its own **web shell**. The game
stays pure Lamp; it emits *semantic events* that your shell JavaScript
interprets. The vocabulary is yours, per game.

## The Lamp side

Two functions:

```lamp
shell_send("kim", board_state)      # name + one string payload, fire-and-forget
if shell_available():
    ...                             # a custom layer is present
```

`shell_send` is like `print`: no reply, never blocking, never captured in
transcripts. On hosts without a custom layer (the terminal, a stock web
build) it drops silently — so it can never break test transcripts.

Two disciplines make shell effects robust:

- **Enhancement-only.** Anything information-bearing must also exist in
  text. Gate the text version on `not shell_available()` if the shell
  replaces it wholesale.
- **Whole truth per turn.** Send complete state each turn (a rule
  alongside your window refreshes), not incremental deltas — then UNDO
  and RESTORE repaint your custom UI correctly with zero extra work,
  exactly like [text windows](b-text-windows.md).

## The shell side

Put a directory named `<game>.shell/` next to your `.lamp` file;
Lighthouse packages it. The light-touch path is two files the stock shell
loads automatically:

- **`custom.js`** — your handlers:

  ```js
  LampShell.on("kim", (payload) => {
      renderKimBoard(document.querySelector("#kim"), payload);
  });
  ```

- **`custom.css`** — your styling over the stock shell's.

`LampShell.on(name, handler)` receives your `shell_send` events.
`LampShell.command("press 3")` sends input the *other* way — a click
becomes an ordinary typed command: echoed in the transcript, adjudicated
by your real game rules, nothing new to secure or save. That's the whole
input model — buttons synthesize commands; there is no separate
shell-to-game data path.

For commands that would flood the transcript, such as one step per key
press on a map, pass `{ silent: true }`: the command isn't echoed and its
prompt is taken back, while its own output still prints and an open
transcript still records it.

```js
LampShell.command("step north", { silent: true });
```

A shell that animates the game's events can keep the transcript in step with
the animation. `LampShell.mark()` holds the game's later text, status bar and
prompt until the returned function is called; `LampShell.releaseAll()` lets
everything through, for skipping ahead.

```js
const release = LampShell.mark();   // as an animation frame arrives
// ... later, when that frame is drawn:
release();
```

### Keys without a custom shell

A game can give modified arrow keys a command itself, with no shell code:

```lamp
rule startup_rules:
	bind_key("shift+up", "step north")
	bind_key("shift+down", "step south")
```

The key sends its command silently, and only when the input line is empty
and the game is waiting. It works in the terminal and in any web build; a
piped run ignores it, so the command must also work when typed. Some
terminals don't pass every modified arrow through, and Shift is the most
reliable. See `devdocs/key-bindings.md`.

Any file in the shell directory whose name matches a stock asset
(`index.html`, `shell.js`, `shell.css`) **overrides** it; everything else
(sounds, fonts, art) is copied into the bundle verbatim. For deep
customization, `lighthouse --eject-shell` copies the stock shell into
your directory to edit — with the honest cost that an ejected shell
stops receiving stock improvements.

## A worked example

Phobos EX's KIM simulator
([sample/phobos_ex/phobos_ex.shell/](../../sample/phobos_ex/phobos_ex.shell/))
renders a five-puzzle hacking device as a clickable strip: the game
`shell_send`s the whole board each turn, buttons fire
`LampShell.command("press N")` so the real puzzle rules adjudicate, and
terminal players get the ASCII keypads instead (gated on
`not shell_available()`). The game's puzzle code barely knows the
simulator exists.

## Trust, plainly

Your shell JavaScript runs unsandboxed in the player's browser, like any
website's code — it's your page. The *game* worker stays sandboxed
regardless. Players trust a custom-shell game the way they trust a
website; keep that in mind if you distribute through others.

---

Next: [Images](d-images.md).
