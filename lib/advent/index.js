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

function contents_of(r) {
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const visible = all.filter((x) => x.holder === r && !x.scenery);
    return lamplighter.makeList(visible.map(with_article));
}

// Lists the contents of any scenery supporter resting in room `r`. A supporter
// is flagged by the `physical.supporter` field; the items resting on it are the
// non-scenery items whose `holder` is the supporter.
function describe_supporters(r) {
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const supporters = all.filter((x) => x.holder === r && x.scenery && x.supporter);
    for (const s of supporters) {
        const onIt = all.filter((x) => x.holder === s && !x.scenery);
        if (onIt.length === 0) continue;
        const listed = lamplighter.makeList(onIt.map(with_article));
        const verb = onIt.length === 1 ? "is" : "are";
        lamplighter.print(lamplighter.outputMarker("par"));
        lamplighter.print("On the " + display_name(s) + " " + verb + " " + lamplighter.concat("", listed) + ".");
    }
}
