# Globals and Constants

A **global** is a named value that lives for the whole game — counters,
flags, the current player, static tables.

## Declaring globals

```lamp
global int disturbance = 0
global bool hero_buffed = false
global real PI = 3.141592653
global person player = yourself
```

The type may be any primitive, kind, or object type. For object-typed
globals the initializer may be an object name, `none`, or omitted (which
means `none`). Globals initialize at startup after all objects exist, so an
object-name initializer always resolves.

## Reading and assigning

A global's bare name works anywhere in an expression, and a bare
`NAME = VALUE` assigns it — inside rules and functions to mutate game
state, or at the **top level** of your file to override a default a library
declared:

```lamp
disturbance = disturbance + 1     # in a rule: mutate state
max_score = 2                     # at top level: override a library default
```

Locals may not shadow globals (a `let` reusing a global's name is a compile
error), so a name always means the same thing wherever it appears.

## List and map tables

List- and map-typed globals may declare their contents inline — the home
for static data tables:

```lamp
global list<string> ranks = ["Rookie", "Veteran", "Legend"]
global list<list<int>> flips = [[1], [2, 3], [1, 2, 4]]
global list<item> kit = [brass_lamp, rope]

global map<item, string> nicknames = {ruby: "the red one", opal: "the milky one"}
global map<string, int> costs = {"ruby": 90, "opal": 40}
```

Elements and keys are **simple values** — literals, bare object names
(checked against the declared element/key type), or nested list literals —
never computed expressions: a global initializes at load, so its
initializer is data, not code. Inside the brackets, lines join implicitly,
so a long table may wrap.

These are ordinary mutable globals: element assignment (`ranks[0] = "..."`),
`append`, and `shuffle` all work, and undo/save capture the contents. Map
notes: indexing (`m[k]`) and index assignment work as on lists; a missing
key reads as `none`; maps don't yet support `for … in` iteration or
`.size`. When the map's value type is `function`, values may be bare
function names, giving you a compile-checked dispatch table:

```lamp
global map<item, function> praise = {ruby: praise_ruby, opal: praise_opal}
```

```lamp
let fn = praise[x]
fn()
```

## Constants

`const` declares an **immutable** global — the right home for data that
never changes:

```lamp
const int max_rank = 11
const list<list<int>> yellow_flips = [[1], [2, 3], [3, 4]]
const map<physical, string> surfaces = {yellow_door: "the yellow scanner"}
```

Reads, indexing, and iteration work like any global, but assignment is a
compile error, in-place mutation through an alias (`shuffle`, `append`, an
indexed write) is a runtime error, and — because constants are program, not
game state — save files and undo skip them entirely. A table you shuffle at
startup stays `global`; `const` is for data that truly never changes.

---

Next: [Functions](d-functions.md).
