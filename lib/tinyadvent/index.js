function read4() {
    const fs = require("fs");
    const buf = Buffer.alloc(1);
    let line = "";
    while (true) {
        const n = fs.readSync(0, buf, 0, 1);
        if (n === 0) break;
        const ch = buf.toString("utf8", 0, 1);
        if (ch === "\n") break;
        line += ch;
    }
    const words = line.trim().split(/\s+/).filter((w) => w.length > 0).slice(0, 4);
    return lamplighter.makeList(words);
}

function split(input) {
    const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
    return lamplighter.makeList(words);
}

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
