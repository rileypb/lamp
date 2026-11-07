# Statements and Expressions

The small core of imperative Lamp — what goes inside rule, handler, and
function bodies.

## Statements

**`let`** introduces a local variable (which may not reuse a global's
name):

```lamp
let here = holder(self.actor)
```

**Assignment** updates an existing local, global, or object field — never
declares anything new:

```lamp
disturbance = disturbance + 1
Bar.lighted = false
```

**`print`** writes a value to the player. With no argument it prints a
blank line. Note that `print` does **not** end the line — finish player
messages with `[line break]` (see [Text Output](j-text.md)).

**`if` / `else`** and **`while`** are Python-style blocks:

```lamp
if disturbance == 0:
    story = won
else:
    story = lost
```

**`for`** has two forms — counted (inclusive of the bound, optional
`step`) and for-each over a list:

```lamp
for i = 1 to 3:
    print "i=[i] "

for r in room.all:
    print "[r] "
```

For-each iterates any `list<T>` — `item.all`, a list field or global, a
`?all` relation query, a function result. Iterating `none` runs zero
times. **`break`** exits the innermost loop.

**`error EXPR`** aborts with a message — for "this should never happen"
guards.

Plus the forms covered on their own pages: `dispatch` ([Events](e-events.md)),
`follow` and `stop` ([Rulebooks](g-rulebooks.md)), `try`
([Rulebooks](g-rulebooks.md)), `move X to Y` and relation
assertion/`remove`/`disconnect` ([Relations](f-relations.md)).

## Operators

Arithmetic: `+`, `-`, `*`, `/`, plus the keyword operators **`div`**
(floored integer division) and **`mod`** (remainder — `17 div 5` is `3`,
`17 mod 5` is `2`), and `^` (power, right-associative). `+` also
concatenates strings, and mixing `int` and `real` produces `real`.
Division by zero yields `NaN` for `/` and `0` for `div`/`mod`.

Comparison: `==`, `!=`, `<`, `<=`, `>`, `>=`. Objects compare by identity,
scalars by value. Logical negation is spelled `not` — there is no `!`
operator.

Boolean: `and`, `or`, `not` — precedence is `not`, then `and`, then `or`.

**Type membership**: `EXPR is TYPE` is true when the value is an object of
that type or a subtype. `none` is never a member, so the test is safe on
unset references:

```lamp
if target is container:
    print "It's a container.[line break]"
```

## Values and names

A bare identifier resolves in order: local variable, global, function
(giving a function reference), named object, and finally a string literal —
the last is what makes enum comparisons like `release == final` work.
`none` is the absent-object literal: `if self.target == none: …`.

Property access chains with `.`: `this_game.name`, `game.all.first`. A
chain may follow a parenthesized expression or a call —
`holder(p).lighted`.

## Lists

```lamp
let primes = [2, 3, 5, 7]      # literal; [] is the empty list
let first = primes[0]          # zero-based indexing
primes[0] = 1                  # element assignment (durable)
```

Lists expose `.first` (or `none` if empty) and `.size` / `.count`. There is
no append operator; the `append(list, item)` native grows a list in place,
which with a loop is how you filter or collect:

```lamp
let evens = []
for n in nums:
    if n mod 2 == 0:
        append(evens, n)
```

`shuffle(list)` shuffles in place, and `pick(list)` draws an element — both
described with the rest of the randomness tools in
[Text Output](j-text.md). List mutations are durable: undo and save
capture them.

One current limitation: an index expression can't appear *inside* a text
substitution (`[m[k]]`) — bind it with `let` first.

---

Next: [Text Output](j-text.md).
