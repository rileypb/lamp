// Finds the top-level function names a native library's index.js exposes.
//
// The emitter inlines a lib's index.js verbatim at the top level of the
// generated module, so only its *depth-0* `function NAME(...)` declarations
// become callable globals — the set a `native function` declaration in a .lamp
// file must match. The previous approach (a bare `\bfunction\s+NAME\(` regex
// over the raw text) also matched the word in comments and strings and matched
// nested function declarations, overstating what is actually callable.
//
// This scanner walks the source as JavaScript surface syntax — skipping line and
// block comments, string and template literals, and regex literals — and tracks
// brace depth so only depth-0 function declarations are collected. The native
// files are small and controlled; this is robust for them and for ordinary JS.
//
// See devdocs/architecture.md ("Known Architectural Issues" → B).

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

// Keywords after which a `/` begins a regex literal, not division (e.g.
// `return /x/`). Identifiers and other keywords are treated as values.
const REGEX_PRECEDING_KEYWORDS = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "throw", "else", "do", "yield", "await", "case",
]);

// A `/` begins a regex literal (rather than division) when the previous
// meaningful token is not a value — i.e. not an identifier/number/keyword, a
// closing `)`/`]`, or a string/template. `prev` is a coarse classifier:
// "value" for those cases, otherwise the raw punctuator char (or "" at start).
function regexAllowed(prev) {
    return prev !== "value" && prev !== ")" && prev !== "]";
}

function extractTopLevelFunctionNames(source) {
    const names = new Set();
    const n = source.length;
    let i = 0;
    let depth = 0;
    let prev = "";

    while (i < n) {
        const c = source[i];

        if (c === "/" && source[i + 1] === "/") {
            i += 2;
            while (i < n && source[i] !== "\n") i += 1;
            continue;
        }
        if (c === "/" && source[i + 1] === "*") {
            i += 2;
            while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
            i += 2;
            continue;
        }
        if (c === '"' || c === "'") {
            i += 1;
            while (i < n && source[i] !== c) {
                if (source[i] === "\\") i += 1;
                i += 1;
            }
            i += 1;
            prev = "value";
            continue;
        }
        if (c === "`") {
            i += 1;
            while (i < n && source[i] !== "`") {
                if (source[i] === "\\") i += 1;
                i += 1;
            }
            i += 1;
            prev = "value";
            continue;
        }
        if (c === "/" && regexAllowed(prev)) {
            i += 1;
            let inClass = false;
            while (i < n) {
                const r = source[i];
                if (r === "\\") { i += 2; continue; }
                if (r === "\n") break;
                if (r === "[") inClass = true;
                else if (r === "]") inClass = false;
                else if (r === "/" && !inClass) { i += 1; break; }
                i += 1;
            }
            while (i < n && IDENT_PART.test(source[i])) i += 1;
            prev = "value";
            continue;
        }
        if (c === " " || c === "\t" || c === "\r" || c === "\n") {
            i += 1;
            continue;
        }
        if (c === "{") { depth += 1; i += 1; prev = "{"; continue; }
        if (c === "}") { depth -= 1; i += 1; prev = "}"; continue; }

        if (IDENT_START.test(c)) {
            let j = i;
            while (j < n && IDENT_PART.test(source[j])) j += 1;
            const word = source.slice(i, j);
            if (word === "function" && depth === 0) {
                let k = j;
                while (k < n && /\s/.test(source[k])) k += 1;
                if (source[k] === "*") { k += 1; while (k < n && /\s/.test(source[k])) k += 1; }
                let m = k;
                while (m < n && IDENT_PART.test(source[m])) m += 1;
                if (m > k) {
                    let p = m;
                    while (p < n && /\s/.test(source[p])) p += 1;
                    if (source[p] === "(") names.add(source.slice(k, m));
                }
            }
            prev = REGEX_PRECEDING_KEYWORDS.has(word) ? "keyword" : "value";
            i = j;
            continue;
        }

        if (/[0-9]/.test(c)) {
            i += 1;
            prev = "value";
            continue;
        }

        prev = c;
        i += 1;
    }

    return names;
}

module.exports = {
    extractTopLevelFunctionNames,
};
