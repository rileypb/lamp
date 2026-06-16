#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseSource } = require("./parser_rd");
const { emitProgram } = require("./emitter");
const { checkProgram, serializeWhenExpr } = require("./checker");
const { KEYWORDS, coerceName } = require("./tokenizer");

// Contextual band words that lead a phase rule (`check take:`); excluded from the
// object-name prescan so a phase rule is never mistaken for an object declaration.
const BAND_WORDS = new Set(["before", "instead", "check", "do", "after", "report"]);

function main() {
    try {
        runCompilation();
    } catch (error) {
        reportCompileError(error);
        process.exit(1);
    }
}

function runCompilation() {
    const [, , inputFileArg, outputFileArg] = process.argv;

    if (!inputFileArg) {
        console.error("Usage: node src/lantern/index.js <input.lamp> [output.js]");
        process.exit(1);
    }

    const projectRoot = path.resolve(__dirname, "../..");
    const libSysDir = path.join(projectRoot, "lib", "sys");

    const inputFile = path.resolve(inputFileArg);
    const outputFile = outputFileArg
        ? path.resolve(outputFileArg)
        : path.join(path.dirname(inputFile), `${path.basename(inputFile, ".lamp")}.generated.js`);
    const libDirs = gatherLibDirs(libSysDir, inputFile, projectRoot);
    const sourceFiles = gatherLampFiles(libDirs, inputFile);
    const { nativeJsContents, nativeFunctionNames } = gatherNativeJs(libDirs);
    const allNodes = [];

    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
    const actionNames = new Set();
    const objectNames = new Set();
    const rawTemplates = [];
    for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, "utf8");
        for (const name of extractGlobalNames(source)) {
            globalNames.add(name);
        }
        for (const name of extractFunctionNames(source)) {
            functionNames.add(name);
        }
        for (const name of extractRelationNames(source)) {
            relationNames.add(name);
        }
        for (const name of extractActionNames(source)) {
            actionNames.add(name);
        }
        for (const name of extractObjectNames(source)) {
            objectNames.add(name);
        }
        rawTemplates.push(...extractRelationTemplates(source));
    }

    const relationTemplates = buildRelationTemplateDispatch(rawTemplates);

    for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, "utf8");
        const ast = parseSource(source, sourceFile, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames);
        allNodes.push(...ast.nodes);
    }

    if (!hasGameObject(allNodes)) {
        console.error("error: no game object defined.");
        process.exit(1);
    }

    const mergedProgram = { kind: "Program", nodes: deduplicateFunctions(allNodes) };
    checkProgram(mergedProgram, { nativeFunctionNames });

    const outputJs = emitProgram(mergedProgram, { nativeJsContents, mainFilePath: inputFile });

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, outputJs, "utf8");

    console.log(`Lantern compiled ${sourceFiles.length} file(s) to ${outputFile}`);
}

function reportCompileError(error) {
    const message = error && error.message ? error.message : String(error);
    const diagnostic = parseDiagnostic(message);

    if (!diagnostic) {
        console.error(`Compile error: ${message}`);
        return;
    }

    const { filePath, lineNumber, detail } = diagnostic;
    console.error(`Compile error: ${filePath}:${lineNumber}: ${detail}`);

    try {
        const fileText = fs.readFileSync(filePath, "utf8");
        const lines = fileText.split(/\r?\n/);
        const lineText = lines[lineNumber - 1] || "";
        const firstTokenColumn = Math.max(0, lineText.search(/\S|$/));
        console.error(`  ${lineNumber} | ${lineText}`);
        console.error(`    | ${" ".repeat(firstTokenColumn)}^`);
    } catch (_readError) {
        // Best-effort diagnostics only.
    }
}

function parseDiagnostic(message) {
    const match = message.match(/^(.*):(\d+):\s(.+)$/);
    if (!match) {
        return null;
    }

    return {
        filePath: match[1],
        lineNumber: Number(match[2]),
        detail: match[3],
    };
}

function gatherLibDirs(libSysDir, userFile, projectRoot) {
    const dirs = [libSysDir];
    const userSource = fs.readFileSync(userFile, "utf8");
    const libImports = extractLibImports(userSource, userFile);
    const userFileDir = path.dirname(userFile);
    for (const { name, filePath, lineNumber } of libImports) {
        const libDir = resolveLibDir(name, projectRoot, userFileDir);
        if (!libDir) {
            throw new Error(`${filePath}:${lineNumber}: library not found: ${name}`);
        }
        dirs.push(libDir);
    }
    return dirs;
}

function gatherLampFiles(libDirs, userFile) {
    const [sysDir, ...importedDirs] = libDirs;
    const sysFiles = fs.readdirSync(sysDir)
        .filter((entry) => entry.endsWith(".lamp"))
        .sort()
        .map((entry) => path.join(sysDir, entry));
    const libFiles = importedDirs.flatMap((dir) =>
        fs.readdirSync(dir)
            .filter((entry) => entry.endsWith(".lamp"))
            .sort()
            .map((entry) => path.join(dir, entry)),
    );
    return [...sysFiles, ...libFiles, userFile];
}

function gatherNativeJs(libDirs) {
    const nativeJsContents = [];
    const nativeFunctionNames = new Set();
    for (const dir of libDirs) {
        const indexPath = path.join(dir, "index.js");
        if (!fs.existsSync(indexPath)) continue;
        const content = fs.readFileSync(indexPath, "utf8");
        nativeJsContents.push(content);
        for (const match of content.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
            nativeFunctionNames.add(match[1]);
        }
    }
    return { nativeJsContents, nativeFunctionNames };
}

function extractLibImports(sourceText, filePath) {
    const imports = [];
    const lines = sourceText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const code = lines[i].replace(/#.*$/, "").trim();
        const match = code.match(/^lib\s+([A-Za-z_][A-Za-z0-9_]*)$/);
        if (match) {
            imports.push({ name: match[1], filePath, lineNumber: i + 1 });
        }
    }
    return imports;
}

function resolveLibDir(libName, projectRoot, userFileDir) {
    const internalPath = path.join(projectRoot, "lib", libName);
    if (fs.existsSync(internalPath) && fs.statSync(internalPath).isDirectory()) {
        return internalPath;
    }
    const localPath = path.join(userFileDir, "lib", libName);
    if (fs.existsSync(localPath) && fs.statSync(localPath).isDirectory()) {
        return localPath;
    }
    return null;
}

function hasGameObject(nodes) {
    return nodes.some((node) => node.kind === "ObjectDecl" && node.typeName === "game");
}

function extractFunctionNames(sourceText) {
    const names = new Set();
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const match = code.match(/^(?:native\s+)?function\s+[A-Za-z_][A-Za-z0-9_<>]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
        if (match) {
            names.add(match[1]);
        }
    }
    return names;
}

function extractGlobalNames(sourceText) {
    const names = new Set();
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const match = code.match(/^global\s+[A-Za-z_][A-Za-z0-9_<>]*\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/);
        if (match) {
            names.add(match[1]);
        }
    }
    return names;
}

function extractRelationNames(sourceText) {
    const names = new Set();
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const match = code.match(/^relation\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (match) {
            names.add(match[1]);
        }
    }
    return names;
}

// Object names are collected ahead of parsing so a bare single-word object
// reference in an expression (`self.taken == statue`) resolves to the object
// rather than the enum-label string fallback. Matches only top-level (unindented)
// `TYPE NAME` declarations — exactly two identifier tokens, optional trailing
// `:`, no `=`, and a non-keyword/non-band leading token — which excludes field
// assignments (indented), relation asserts (3+ tokens), and every keyword-led
// declaration.
function extractObjectNames(sourceText) {
    const names = new Set();
    for (const rawLine of sourceText.split(/\r?\n/)) {
        if (/^\s/.test(rawLine)) continue;
        const code = rawLine.replace(/#.*$/, "");
        if (code.includes("=")) continue;
        const match = code.match(/^([A-Za-z_][A-Za-z0-9_\\-]*)\s+([A-Za-z_][A-Za-z0-9_\\-]*)\s*:?\s*$/);
        if (!match) continue;
        if (KEYWORDS.has(match[1]) || BAND_WORDS.has(match[1])) continue;
        names.add(coerceName(match[2]));
    }
    return names;
}

// Action names are collected ahead of parsing so the parser can recognize a
// leading-band phase rule (`check take:`) — otherwise indistinguishable from an
// object declaration (`room kitchen:`) by token shape alone.
function extractActionNames(sourceText) {
    const names = new Set();
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const match = code.match(/^action\s+([A-Za-z_][A-Za-z0-9_]*)\s*:?/);
        if (match) {
            names.add(match[1]);
        }
    }
    return names;
}

// A `syntax "..."` line associates with the most recent `relation NAME:` — the
// only place a syntax line may legally appear, so proximity is unambiguous.
function extractRelationTemplates(sourceText) {
    const templates = [];
    let currentRelation = null;
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const relMatch = code.match(/^relation\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/);
        if (relMatch) {
            currentRelation = relMatch[1];
            continue;
        }
        const synMatch = code.match(/^syntax\s+"(.*)"$/);
        if (synMatch && currentRelation) {
            templates.push({ relationName: currentRelation, template: synMatch[1] });
        }
    }
    return templates;
}

function parseTemplateParts(template) {
    return template.trim().split(/\s+/).filter(Boolean).map((part) => {
        const slot = part.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/);
        return slot ? { kind: "slot", field: slot[1] } : { kind: "literal", text: part };
    });
}

// Maps each template's leading literal to its relation + parsed parts so the
// parser can dispatch a custom-syntax line on its first token. Enforces the
// "template begins with a literal" rule and rejects colliding leading literals.
function buildRelationTemplateDispatch(rawTemplates) {
    const dispatch = new Map();
    for (const { relationName, template } of rawTemplates) {
        const parts = parseTemplateParts(template);
        if (parts.length === 0 || parts[0].kind !== "literal") {
            throw new Error(`relation "${relationName}": syntax template must begin with a literal token`);
        }
        const leading = parts[0].text;
        if (dispatch.has(leading)) {
            throw new Error(`ambiguous relation syntax: leading token "${leading}" is used by more than one relation template`);
        }
        dispatch.set(leading, { relationName, parts });
    }
    return dispatch;
}

function deduplicateFunctions(nodes) {
    const seen = new Map();
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.kind !== "FunctionDecl") continue;
        const condKey = node.whenExpr === null ? null : serializeWhenExpr(node.whenExpr);
        const key = `${node.name}\0${condKey}`;
        seen.set(key, i);
    }
    return nodes.filter((node, i) => {
        if (node.kind !== "FunctionDecl") return true;
        const condKey = node.whenExpr === null ? null : serializeWhenExpr(node.whenExpr);
        const key = `${node.name}\0${condKey}`;
        return seen.get(key) === i;
    });
}

main();
