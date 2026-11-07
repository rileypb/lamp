# Introduction

Lamp is a system for writing and playing **parser interactive fiction** —
games in the tradition of Zork, where the player reads prose and types
commands:

```
Foyer
You are standing in a spacious hall, splendidly decorated in red and
gold, with glittering chandeliers overhead. The entrance from the street
is to the north, and there are doorways south and west.

> west
Cloakroom
The walls of this small room were clearly once lined with hooks, though
now only one remains. The exit is a door to the east.

> hang cloak on hook
(first taking off the velvet cloak)
You hang the cloak neatly on the hook.
```

You write your game in the **Lamp language**: a declarative, indentation-based
language designed for describing worlds — rooms, objects, the relations
between them — and the rules that make those worlds respond to the player.

## The three tools

The toolchain has three parts, and you will meet them in this order:

- **Lantern** — the compiler. It takes your `.lamp` source and produces a
  JavaScript program.
- **Lamplighter** — the runtime. It executes a compiled game: reading player
  commands, running your rules, keeping game state, and printing prose. It
  includes a terminal player, so you can play your game at the command line
  while you write it.
- **Lighthouse** — the bundler. When your game is ready to ship, Lighthouse
  packages it as a self-contained web page or an Electron desktop app.

The everyday loop is: edit your `.lamp` file, run it with `lantern-exe`
(which compiles and plays in one step), play a few turns, repeat.

## The standard library

Most games begin with one line:

```lamp
lib advent
```

This imports the **adventure library**, which provides the standard IF world
model so you don't build it from scratch: rooms, items, containers and
supporters, people, doors, darkness, wearable things, and the standard verb
set (LOOK, EXAMINE, TAKE, DROP, GO, OPEN, INVENTORY, and many more) — plus
the conveniences players expect, like UNDO, SAVE, RESTORE, RESTART, and QUIT.

Your game then consists of *declarations* (the rooms and objects of your
world) and *rules* (how your world deviates from the defaults). A complete,
playable game can be twenty lines; the library does the rest.

## How this documentation is organized

- **Part I (this part)** gets you from nothing to a playable game: install
  the tools, write a tiny game, then build the classic demo game *Cloak of
  Darkness* step by step.
- **Part II** covers the Lamp language itself — objects, rules, relations,
  text.
- **Part III** covers the adventure library in depth — the world model,
  actions, NPCs, conversation, endings.
- **Part IV** covers presentation: customizing messages, text windows,
  images, localization.
- **Part V** covers testing your game and shipping builds.
- **Part VI** is reference material.

Next: [Installation](b-installation.md).
