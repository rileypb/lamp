function contents_of(r) {
    const all = lamplighter.listItems(lamplighter.type("item").all);
    const visible = all.filter((x) => x.holder === r && !x.scenery);
    return lamplighter.makeList(visible.map((x) => lamplighter.concat("a ", x)));
}
