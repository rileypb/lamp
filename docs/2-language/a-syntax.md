# Syntax Fundamentals

## Source files

A Lamp game is plain text in one or more `.lamp` files, one statement per
line. **Indentation defines block structure**, as in Python: a block begins
after a `:` and ends when indentation returns to the enclosing level.

```lamp
room Foyer:
    description "A spacious hall."
```

`#` introduces a comment that runs to the end of the line.

A game imports libraries with a `lib` line, almost always:

```lamp
lib advent
```

and may pick its language pack with a `locale` declaration
(`locale "fr-FR"`; the default is `en-US`).

## Identifiers and display names

An **identifier** names an object, type, global, field, or variable. It is a
single token — never containing spaces — but object and global names support
a **display coercion** so one token can stand for a multi-word name:

- `_` renders as a space: `West_of_House` names `West of House`.
- `-` renders as a literal hyphen: `well-worn_map` names `well-worn map`.
- `\_` renders as a literal underscore.

The coerced string is the name's identity: `room West_of_House:` declares a
room named `West of House`, and every later reference to `West_of_House`
resolves to it. A separator may only appear *between* characters — an
identifier can't begin or end with `_` or `-`.

Local variables (from `let`, function parameters, and loop variables) are
plain identifiers only — letters, digits, underscore, no coercion — because
they are internal names, never displayed. Type names, kind names, and field
names are likewise plain.

Free text with spaces or punctuation is always a double-quoted string, never
a bare identifier: `author "Roger Firth"`.

## String literals

Strings are double-quoted, with the usual escapes: `\"`, `\n`, `\t`, `\\`,
and `\u{HEX}` for a Unicode code point (`\u{e9}` → é). An unrecognized
escape keeps its backslash, so stray backslashes in prose are never lost.

A literal may span **multiple lines**: a `"` not closed on its line
continues to the next unescaped `"`, each source newline becoming a real
newline. Continuation lines are dedented (their common indentation is
stripped), so long prose can be indented under its statement for
readability.

Two conveniences apply to strings used as values (prose, not grammar
templates):

- **Quote convention**: a `'` between letters stays an apostrophe
  (`don't`), while `'quoted'` renders with typographic double quotes —
  handy for dialogue inside a double-quoted literal. Write `[']` to force a
  literal apostrophe.
- **Text substitution**: an unescaped `[…]` embeds a live Lamp expression in
  the text — `"Your score is [score]."`. This is the heart of Lamp's prose
  system and gets its own page: [Text Output](j-text.md). Write a literal
  bracket as `\[` or `\]`.

## Reserved words

The language's structural words — among them `type`, `global`, `on`, `if`,
`else`, `let`, `for`, `in`, `while`, `print`, `function`, `return`, `when`,
`and`, `or`, `not`, `is`, `relation`, `bidi`, `remove`, `rulebook`, `stop`,
`follow`, `action`, `try`, `move`, `from`, `to`, `mod`, `div` — are reserved
and can't be used as names. The reservation applies only to a *whole*
identifier: `move_to_room` is a valid name even though `move` and `to` are
reserved.

Many other words you'll meet (`syntax`, `understand`, `default`, `during`,
`actor`, the rule-band words `before`/`instead`/`check`/`do`/`after`/
`report`, and more) are **contextual**: they are special only in their
particular position and remain ordinary identifiers everywhere else, so
they rarely get in your way.

---

Next: [Objects and Kinds](b-objects-and-kinds.md).
