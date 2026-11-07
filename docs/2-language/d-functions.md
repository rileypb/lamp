# Functions

A **function** is a named, reusable block declared at top level, callable
from anywhere in the program — your file, library files, rules, templates.

```lamp
function void greet(string greeting, string subject):
    print greeting + ", " + subject + "!"

function int add(int a, int b):
    return a + b

function int factorial(int n):
    if n == 0:
        return 1
    return n * factorial(n - 1)
```

The return type is `void` (no value) or any value type; recursion works.
`return EXPR` exits with a value; a bare `return` exits a `void` function
early. Parameter types follow the same conventions as field types, and an
argument that is a bare object name resolves to that object when the
parameter is object-typed.

Calls are ordinary expressions (`add(3, 4)`, usable in `let`, arithmetic,
text substitutions) or standalone statements.

## Function references

The type `function` denotes a function *value*. Passing a function's bare
name (no parentheses) hands over the function itself:

```lamp
function int apply(int n, function fn):
    return fn(n)

function int double(int n):
    return n * 2
```

`apply(5, double)` returns `10`. Function references are untyped beyond the
`function` tag — the checker doesn't verify the referenced signature
matches.

## Conditional overloads

A function may have several definitions, each guarded by `when` — the
definition that runs is chosen by the game's current state:

```lamp
function int damage(int base):
    return base

function int damage(int base) when hero_buffed:
    return base * 2

function int damage(int base) when hero_buffed and boss_fight:
    return base * 3
```

At each call, the most **specific** true guard wins (roughly: more atomic
conditions score higher; `and` sums, `or` takes the max; ties go to the
later definition). The unguarded definition is the fallback; if no guard
matches and there is no fallback, that's a runtime error.

Constraints: all overloads must share the exact signature; at most one may
be unconditional; and guards may reference globals, object fields, and
relation queries — **not parameters**. Guards select by *world state*, not
by argument; for argument-driven dispatch use a
[rulebook](g-rulebooks.md), whose rule guards do see parameters.

## Native functions

A library may declare a function implemented in JavaScript rather than
Lamp:

```lamp
native function string greet(string name)
```

The signature is declared in `.lamp` (so calls type-check normally) and the
body lives in the library directory's `index.js`. This is a
library-authoring feature — game code rarely needs it, and the standard
library's design principle is to keep natives to the irreducible minimum.

---

Next: [Events](e-events.md).
