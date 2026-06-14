function readline() {
    const fs = require("fs");
    const buf = Buffer.alloc(1);
    let result = "";
    while (true) {
        const n = fs.readSync(0, buf, 0, 1);
        if (n === 0) break;
        const ch = buf.toString("utf8", 0, 1);
        if (ch === "\n") break;
        result += ch;
    }
    return result;
}

function split(input) {
    const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
    return lamplighter.makeList(words);
}
