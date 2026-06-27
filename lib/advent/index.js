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
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const visible = all.filter((x) => lamplighter.containerOf(x) === r && !x.scenery);
    return lamplighter.makeList(visible);
}

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
