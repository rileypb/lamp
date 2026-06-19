function with_article(x) {
    const name = x.printed_name ? String(x.printed_name) : String(x.name).replace(/_/g, " ");
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
