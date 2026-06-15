function readline() {
    return lamplighter.readLine();
}

function split(input) {
    const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
    return lamplighter.makeList(words);
}
