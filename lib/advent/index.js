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
