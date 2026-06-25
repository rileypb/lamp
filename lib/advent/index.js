function display_name(x) {
    return x.printed_name ? String(x.printed_name) : String(x.name).replace(/_/g, " ");
}

function with_article(x) {
    const name = display_name(x);
    const art = x.article ? x.article.name : null;
    if (art === "definite") return "the " + name;
    if (art === "proper" || art === "plural") return name;
    return (/^[aeiou]/i.test(name) ? "an " : "a ") + name;
}

// An object's container, via the runtime containment seam (the `contains`
// relation, with a legacy `holder`-field fallback during migration). Exposed to
// Lamp as `holder(x)` so author code reads containment without touching the field.
function holder(x) {
    return lamplighter.containerOf(x);
}

function contents_of(r) {
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const visible = all.filter((x) => lamplighter.containerOf(x) === r && !x.scenery);
    return lamplighter.makeList(visible.map(with_article));
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
        const listed = lamplighter.makeList(onIt.map(with_article));
        const verb = onIt.length === 1 ? "is" : "are";
        lamplighter.print(lamplighter.outputMarker("par"));
        lamplighter.print("On the " + display_name(s) + " " + verb + " " + lamplighter.concat("", listed) + ".");
    }
}
