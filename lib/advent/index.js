// An object's container, via the runtime containment seam (the source of its
// `contains` edge). Exposed to Lamp as `holder(x)` so author code reads
// containment without touching any field.
function holder(x) {
    return lamplighter.containerOf(x);
}

// The non-scenery item objects in room `r`. Returns the objects (not pre-rendered
// strings) so the caller chooses the article at render time via the locale's
// `a_list` / `the_list`. See lib/advent/rooms.lamp.
function contents_of(r) {
    if (r && r.closed) return lamplighter.makeList([]);
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const visible = all.filter((x) => lamplighter.containerOf(x) === r && !x.scenery);
    return lamplighter.makeList(visible);
}

// The room contents that belong in the standard "[We] [see] … here." list: contents_of
// minus any item still showing its initial appearance (a non-empty `initial_appearance`
// and not yet `handled`). Those describe themselves in their own paragraph instead, so
// they are pulled from the list (but stay in scope — scope doesn't read contents_of).
function listable_contents(r) {
    return lamplighter.makeList(
        lamplighter.listItems(contents_of(r)).filter((x) => x.handled || !x.initial_appearance),
    );
}

// A closed container seals its contents out of scope (mirrors contents_of hiding them
// from listings): you can't take or examine what's inside a shut box until it opens.
// Restricted to actual `container` types (a box) — a `door` also has a `closed` field, but
// it's a passage, not a vessel, so a closed door must NOT hide its parts (e.g. a scanner).
lamplighter.registerScopeBarrier(
    (container) => lamplighter.isTypeOrSubtype(container.type, "container") && !!container.closed,
);

// The advent direction names a door may use as a side. `door[dir]` holds the room
// reached by going `dir`. Mirrors the directions in globals.lamp.
const DOOR_DIRECTIONS = ["north", "northeast", "east", "southeast", "south",
                         "southwest", "west", "northwest", "up", "down"];

// Materialize each door's two `<direction> <room>` sides into the map. Reading 2
// semantics: `north RoomB` means RoomB lies to the north, so you reach it by going
// north from the OTHER side's room. Emits two directed `connects` edges (so `go`
// can traverse) and two `doorway` edges (the side->door index `go` and the scope
// provider read). Called once at startup, after object fields are populated. The
// exactly-two-sides invariant is enforced at compile time; this guards defensively.
function wire_doors() {
    for (const door of lamplighter.listItems(lamplighter.type("door").all)) {
        const sides = [];
        for (const dn of DOOR_DIRECTIONS) {
            if (door[dn]) sides.push({ dir: lamplighter.getObject(dn), room: door[dn] });
        }
        if (sides.length !== 2) {
            lamplighter.error("Door '" + door.name + "' must connect exactly two rooms; found " + sides.length + ".");
        }
        const a = sides[0];
        const b = sides[1];
        lamplighter.addRelation("connects", { source: b.room, dir: a.dir, target: a.room });
        lamplighter.addRelation("connects", { source: a.room, dir: b.dir, target: b.room });
        lamplighter.addRelation("doorway", { side: b.room, dir: a.dir, barrier: door });
        lamplighter.addRelation("doorway", { side: a.room, dir: b.dir, barrier: door });
    }
}

// Materialize each `part_of PART WHOLE` edge as containment (the whole contains the part), so a
// part rides scope's containment fixpoint — in scope wherever its whole is, and moving with it.
// Called once at startup, after objects and their part_of edges exist. See lib/advent/parts.lamp.
function wire_parts() {
    for (const part of lamplighter.listItems(lamplighter.type("physical").all)) {
        const wholes = lamplighter.listItems(lamplighter.queryRelationValue(
            "part_of",
            { part, whole: lamplighter.ANY },
            "whole",
            "all",
        ));
        for (const whole of wholes) {
            lamplighter.addRelation("contains", { place: whole, contained: part });
        }
    }
}

// Doors are present in both rooms they join but contained in neither, so the
// containment-based scope misses them. Surface the current room's doors.
lamplighter.registerScopeProvider(function (actor, location) {
    if (!location) return [];
    return lamplighter.listItems(lamplighter.queryRelationValue(
        "doorway",
        { side: location, dir: lamplighter.ANY, barrier: lamplighter.ANY },
        "barrier",
        "all",
    ));
});

// Backdrops (walls/floor/ceiling/sky/…) are present in every room — not contained
// anywhere — so the containment scope misses them too. Surface every `backdrop`
// instance regardless of location. (`type("backdrop")` always exists — advent
// declares it — and `.all` is empty when a game declares no backdrops.)
lamplighter.registerScopeProvider(function (actor, location) {
    return lamplighter.listItems(lamplighter.type("backdrop").all);
});

// Lists the contents of any scenery supporter resting in room `r`. A supporter
// is flagged by the `physical.supporter` field; the items resting on it are the
// non-scenery items contained by the supporter.
function describe_supporters(r) {
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const supporters = all.filter((x) => lamplighter.containerOf(x) === r && x.scenery && x.supporter);
    for (const s of supporters) {
        const onIt = all.filter((x) => lamplighter.containerOf(x) === s && !x.scenery);
        if (onIt.length === 0) continue;
        // The sentence is locale prose (supporter_phrase), so the listing
        // localizes; advent only decides which supporters and what rests on them.
        lamplighter.print(lamplighter.outputMarker("par"));
        lamplighter.print(supporter_phrase(s, lamplighter.makeList(onIt)));
    }
}

// Debug introspection for the SHOWME verb (lib/advent/debug.lamp): a multi-line dump of an
// object's identity, location, own fields, and contents. The instance is a plain record, so
// its own enumerable keys (minus the structural `name`/`type`) are its fields.
function describe_object(x) {
    if (!x || typeof x !== "object") return String(x);
    const lines = [];
    lines.push(`${x.name} (${x.type})`);
    const container = lamplighter.containerOf(x);
    lines.push(`  location: ${container ? container.name : "(nowhere)"}`);
    for (const key of Object.keys(x)) {
        if (key === "name" || key === "type") continue;
        lines.push(`  ${key}: ${formatDebugValue(x[key])}`);
    }
    const held = lamplighter
        .listItems(lamplighter.type("physical").all)
        .filter((inst) => lamplighter.containerOf(inst) === x)
        .map((inst) => inst.name);
    if (held.length > 0) lines.push(`  contents: ${held.join(", ")}`);
    return lines.join("\n");
}

// Render one field value for the debug dump: a list as [a, b], an object reference as its
// name, a string quoted, primitives verbatim. A field holding an interpolating template is
// a branded thunk (a function); render it to its current text via `renderText` (the freeze
// primitive — like SAVE, this evaluates the template, so a rare stateful one, e.g. a field
// with `[first time]`, advances). TODO: a read-only-render flag will suppress that — see
// devdocs/text.md "read-only render flag" and TODO.md.
function formatDebugValue(value) {
    if (value === null || value === undefined) return "none";
    if (typeof value === "function") return JSON.stringify(lamplighter.renderText(value));
    if (typeof value === "object") {
        if (Array.isArray(value.items)) return "[" + value.items.map(formatDebugValue).join(", ") + "]";
        if (typeof value.name === "string") return value.name;
        return "(value)";
    }
    if (typeof value === "string") return JSON.stringify(value);
    return String(value);
}

// The whole-world containment tree for the TREE debug verb (lib/advent/debug.lamp): every
// top-level object (a room, or an uncontained thing) and its contents, recursively indented.
function world_tree() {
    const all = lamplighter.listItems(lamplighter.type("physical").all);
    const children = new Map();
    for (const x of all) {
        const parent = lamplighter.containerOf(x) || null;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(x);
    }
    const lines = [];
    const walk = (node, depth) => {
        lines.push("  ".repeat(depth) + `${node.name} (${node.type})`);
        for (const child of children.get(node) || []) walk(child, depth + 1);
    };
    for (const root of children.get(null) || []) walk(root, 0);
    return lines.join("\n");
}

// What is currently in the player's scope, for the SCOPE debug verb: the objects the parser
// would resolve a noun against right now (in scope order — the room, then its reachable
// contents), one per line.
function scope_listing() {
    const player = lamplighter.getGlobal("player");
    return lamplighter
        .scopeOf(player)
        .map((x) => `${x.name} (${x.type})`)
        .join("\n");
}

// TEST runner: hand the script's already-split command lines to the runtime input queue, which
// promptLine drains ahead of host input (front-insertion, so a nested `test X` expands in place).
function queue_commands(cmds) {
    lamplighter.queueCommands(lamplighter.listItems(cmds));
}
