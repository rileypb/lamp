// Full-file tokenizer for the Lamp language.
//
// Emits a flat token stream with Python-style significant indentation
// (INDENT / DEDENT / NEWLINE). It is intentionally role-agnostic: an
// identifier's display coercion (underscore -> space, etc.) is NOT applied
// here, because whether coercion applies depends on the identifier's role
// (object/global name vs. local/field), which only the parser knows. The
// token carries the raw source spelling; the parser calls `coerceName` when
// an identifier is used as a name.
//
// See devdocs/parser_refactor.md and devdocs/specs.md ("Names and
// identifiers") for the design this implements.

const KEYWORDS = new Set([
    "type",
    "kind",
    "global",
    "on",
    "for",
    "in",
    "while",
    "if",
    "else",
    "let",
    "print",
    "error",
    "dispatch",
    "break",
    "lib",
    "locale",
    "not_for_release",
    "from",
    "to",
    "step",
    "change",
    "function",
    "return",
    "when",
    "and",
    "or",
    "not",
    "is",
    "native",
    "freeze",
    "relation",
    "bidi",
    "remove",
    "disconnect",
    "rulebook",
    "stop",
    "follow",
    "action",
    "try",
    "verb",
    "sugar",
    "move",
    "mod",
    "div",
]);

const SINGLE_CHAR_TOKENS = {
    "+": "PLUS",
    "-": "MINUS",
    "*": "STAR",
    "/": "SLASH",
    "^": "CARET",
    ":": "COLON",
    ".": "DOT",
    "(": "LPAREN",
    ")": "RPAREN",
    ",": "COMMA",
    "[": "LBRACKET",
    "]": "RBRACKET",
    "{": "LBRACE",
    "}": "RBRACE",
    "?": "QUESTION",
};

function tokenize(sourceText, filePath) {
    const rawLines = sourceText.split(/\r?\n/);
    const tokens = [];
    const indentStack = [0];
    let lastLine = 0;
    let li = 0;
    // Implicit line joining inside brackets: while a `[` (or `{`) is open, following
    // physical lines continue the same logical line — no NEWLINE, no
    // INDENT/DEDENT — so a long list literal wraps freely (multi-line tables,
    // devdocs/phobos_gaps.md §3). Brackets inside string literals are STRING
    // token content and never reach this count. The cost of the freedom: a
    // missing `]` joins everything to the end of the file, so the eventual
    // error points far from the culprit.
    let bracketDepth = 0;

    while (li < rawLines.length) {
        const lineNumber = li + 1;
        const codeLine = stripComment(rawLines[li]);

        if (codeLine.trim() === "") {
            li += 1;
            continue;
        }

        if (bracketDepth === 0) {
            const indent = computeIndent(codeLine);
            emitIndentation(tokens, indentStack, indent, filePath, lineNumber);
        }
        // A multi-line string literal consumes raw lines past `li`; tokenizeLine
        // returns the index of the last line it consumed so we resume after it.
        const before = tokens.length;
        const lastLi = tokenizeLine(codeLine, lineNumber, filePath, tokens, rawLines, li);
        for (let t = before; t < tokens.length; t += 1) {
            if (tokens[t].type === "LBRACKET" || tokens[t].type === "LBRACE") bracketDepth += 1;
            else if (tokens[t].type === "RBRACKET" || tokens[t].type === "RBRACE") bracketDepth = Math.max(0, bracketDepth - 1);
        }
        lastLine = lastLi + 1;
        if (bracketDepth === 0) {
            tokens.push({ type: "NEWLINE", line: lastLine });
        }
        li = lastLi + 1;
    }

    while (indentStack.length > 1) {
        indentStack.pop();
        tokens.push({ type: "DEDENT", line: lastLine });
    }
    tokens.push({ type: "EOF", line: lastLine });
    return tokens;
}

function emitIndentation(tokens, indentStack, indent, filePath, lineNumber) {
    const top = indentStack[indentStack.length - 1];
    if (indent > top) {
        indentStack.push(indent);
        tokens.push({ type: "INDENT", line: lineNumber });
        return;
    }
    while (indent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        tokens.push({ type: "DEDENT", line: lineNumber });
    }
    if (indent !== indentStack[indentStack.length - 1]) {
        throw syntaxError(filePath, lineNumber, "Inconsistent indentation");
    }
}

// Tokenizes one logical line, returning the index of the last raw line it consumed
// (equal to `li` unless a multi-line string literal pulled in continuation lines).
function tokenizeLine(s, lineNumber, filePath, tokens, rawLines, li) {
    let i = 0;
    let curLi = li;

    const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

    while (i < s.length) {
        const ch = s[i];

        if (ch === " " || ch === "\t") {
            i += 1;
            continue;
        }

        if (ch === '"') {
            const close = findCloseQuote(s, i + 1);
            if (close !== -1) {
                tokens.push({ type: "STRING", value: unescapeString(s.slice(i + 1, close)), line: lineNumber });
                i = close + 1;
                continue;
            }
            // No close quote on this line: gather raw continuation lines verbatim
            // (no comment-stripping, blank lines kept) until one closes the string.
            const segments = [s.slice(i + 1)];
            let k = curLi + 1;
            let closePos = -1;
            while (k < rawLines.length) {
                closePos = findCloseQuote(rawLines[k], 0);
                if (closePos === -1) {
                    segments.push(rawLines[k]);
                    k += 1;
                    continue;
                }
                segments.push(rawLines[k].slice(0, closePos));
                break;
            }
            if (closePos === -1) {
                throw syntaxError(filePath, lineNumber, "Unterminated string literal");
            }
            tokens.push({ type: "STRING", value: unescapeString(dedentSegments(segments)), line: lineNumber });
            // Resume after the close quote on the closing line, with the right line
            // number; the remainder may carry more tokens and/or a comment.
            curLi = k;
            lineNumber = k + 1;
            s = stripComment(rawLines[k].slice(closePos + 1));
            i = 0;
            continue;
        }

        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            let raw = "";
            // A name word allows interior `-` glue (between two ident chars)
            // and the `\_` literal-underscore escape; see specs.md.
            while (j < s.length) {
                const c = s[j];
                if (/[A-Za-z0-9_]/.test(c)) {
                    raw += c;
                    j += 1;
                } else if (c === "\\" && s[j + 1] === "_") {
                    raw += "\\_";
                    j += 2;
                } else if (c === "-" && isIdentChar(s[j + 1])) {
                    raw += "-";
                    j += 1;
                } else {
                    break;
                }
            }
            tokens.push({ type: KEYWORDS.has(raw) ? "KEYWORD" : "IDENT", value: raw, line: lineNumber });
            i = j;
            continue;
        }

        if (/\d/.test(ch) || (ch === "-" && /\d/.test(s[i + 1]))) {
            let j = ch === "-" ? i + 1 : i;
            while (/\d/.test(s[j])) j += 1;
            let isFloat = false;
            if (s[j] === "." && /\d/.test(s[j + 1])) {
                isFloat = true;
                j += 1;
                while (/\d/.test(s[j])) j += 1;
            }
            const text = s.slice(i, j);
            tokens.push({ type: "NUMBER", value: isFloat ? parseFloat(text) : Number(text), line: lineNumber });
            i = j;
            continue;
        }

        if (ch === "=") {
            if (s[i + 1] === "=") {
                tokens.push({ type: "EQEQ", line: lineNumber });
                i += 2;
            } else {
                tokens.push({ type: "EQUALS", line: lineNumber });
                i += 1;
            }
            continue;
        }

        // `!=` is inequality (desugared to `not (a == b)` in the parser). A bare `!` is
        // not an operator — Lamp spells logical negation `not` — so it falls through to
        // the unexpected-character error below.
        if (ch === "!" && s[i + 1] === "=") {
            tokens.push({ type: "NEQ", line: lineNumber });
            i += 2;
            continue;
        }

        if (ch === "<") {
            if (s[i + 1] === "=") {
                tokens.push({ type: "LTE", line: lineNumber });
                i += 2;
            } else {
                tokens.push({ type: "LT", line: lineNumber });
                i += 1;
            }
            continue;
        }

        if (ch === ">") {
            if (s[i + 1] === "=") {
                tokens.push({ type: "GTE", line: lineNumber });
                i += 2;
            } else {
                tokens.push({ type: "GT", line: lineNumber });
                i += 1;
            }
            continue;
        }

        const single = SINGLE_CHAR_TOKENS[ch];
        if (single) {
            tokens.push({ type: single, line: lineNumber });
            i += 1;
            continue;
        }

        throw syntaxError(filePath, lineNumber, `Unexpected character: ${JSON.stringify(ch)}`);
    }
    return curLi;
}

// Index of the next unescaped `"` in `line` at/after `from`, or -1 if none. A `\`
// escapes the following character (so `\"` is not a close), matching unescapeString.
function findCloseQuote(line, from) {
    for (let k = from; k < line.length; k += 1) {
        if (line[k] === "\\") {
            k += 1;
            continue;
        }
        if (line[k] === '"') return k;
    }
    return -1;
}

// Joins the raw source segments of a multi-line string with literal newlines after
// stripping their common leading indentation (the dedent policy: authors may indent
// continuation lines for readability without it appearing in the value). The first
// segment is the text after the opening quote on the opening line and is left as-is;
// the common indent is measured over the remaining non-blank lines.
function dedentSegments(segments) {
    if (segments.length <= 1) return segments.join("\n");
    const cont = segments.slice(1);
    let common = Infinity;
    for (const line of cont) {
        if (line.trim() === "") continue;
        const lead = line.length - line.replace(/^[ \t]+/, "").length;
        if (lead < common) common = lead;
    }
    if (!Number.isFinite(common)) common = 0;
    return [segments[0], ...cont.map((line) => line.slice(common))].join("\n");
}

// Resolves an identifier's raw source spelling to its canonical display/name
// string: `_` -> space, `\_` -> literal `_`, `-` stays a literal hyphen.
function coerceName(raw) {
    let out = "";
    for (let i = 0; i < raw.length; i += 1) {
        if (raw[i] === "\\" && raw[i + 1] === "_") {
            out += "_";
            i += 1;
        } else if (raw[i] === "_") {
            out += " ";
        } else {
            out += raw[i];
        }
    }
    return out;
}

// Resolves backslash escapes in a string literal's raw inner text to their
// character values, so prose can contain a double quote or a line break. The
// recognized escapes are `\\`, `\"`, `\n`, `\t`, `\r`, and the Unicode code-point
// form `\u{HEX}` (1–6 hex digits, e.g. `\u{e9}` → "é"); any other `\X` is left
// verbatim (backslash kept) so a stray backslash in prose is never lost. This is
// the one place strings are decoded — every downstream consumer (emitter, prescan
// templates, --encode-strings) sees the resolved value.
function unescapeString(raw) {
    if (raw.indexOf("\\") === -1) return raw;
    let out = "";
    for (let i = 0; i < raw.length; i += 1) {
        if (raw[i] !== "\\" || i + 1 >= raw.length) {
            out += raw[i];
            continue;
        }
        const next = raw[i + 1];
        if (next === "\\") out += "\\";
        else if (next === '"') out += '"';
        else if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === "r") out += "\r";
        else if (next === "u" && raw[i + 2] === "{") {
            const close = raw.indexOf("}", i + 3);
            const hex = close === -1 ? "" : raw.slice(i + 3, close);
            const code = /^[0-9a-fA-F]{1,6}$/.test(hex) ? Number.parseInt(hex, 16) : NaN;
            if (code <= 0x10ffff) {
                out += String.fromCodePoint(code);
                i = close - 1;
            } else {
                out += "\\" + next;
            }
        }
        else { out += "\\" + next; }
        i += 1;
    }
    return out;
}

function stripComment(line) {
    let inString = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inString) {
            if (ch === "\\") {
                i += 1;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === "#") {
            return line.slice(0, i);
        }
    }
    return line;
}

function computeIndent(line) {
    let count = 0;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === " ") {
            count += 1;
        } else if (ch === "\t") {
            count += 4;
        } else {
            break;
        }
    }
    return count;
}

function syntaxError(filePath, lineNumber, message) {
    return new Error(`${filePath}:${lineNumber}: ${message}`);
}

module.exports = {
    tokenize,
    coerceName,
    KEYWORDS,
};
