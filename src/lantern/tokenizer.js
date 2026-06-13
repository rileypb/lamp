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
    "while",
    "if",
    "else",
    "let",
    "print",
    "error",
    "dispatch",
    "break",
    "lib",
    "to",
    "step",
    "change",
    "function",
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
};

function tokenize(sourceText, filePath) {
    const rawLines = sourceText.split(/\r?\n/);
    const tokens = [];
    const indentStack = [0];
    let lineNumber = 0;

    for (const rawLine of rawLines) {
        lineNumber += 1;
        const codeLine = stripComment(rawLine);

        if (codeLine.trim() === "") {
            continue;
        }

        const indent = computeIndent(codeLine);
        emitIndentation(tokens, indentStack, indent, filePath, lineNumber);
        tokenizeLine(codeLine, lineNumber, filePath, tokens);
        tokens.push({ type: "NEWLINE", line: lineNumber });
    }

    while (indentStack.length > 1) {
        indentStack.pop();
        tokens.push({ type: "DEDENT", line: lineNumber });
    }
    tokens.push({ type: "EOF", line: lineNumber });
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

function tokenizeLine(s, lineNumber, filePath, tokens) {
    let i = 0;

    const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

    while (i < s.length) {
        const ch = s[i];

        if (ch === " " || ch === "\t") {
            i += 1;
            continue;
        }

        if (ch === '"') {
            let j = i + 1;
            while (j < s.length && s[j] !== '"') {
                if (s[j] === "\\") j += 1;
                j += 1;
            }
            if (j >= s.length) {
                throw syntaxError(filePath, lineNumber, "Unterminated string literal");
            }
            tokens.push({ type: "STRING", value: s.slice(i + 1, j), line: lineNumber });
            i = j + 1;
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
