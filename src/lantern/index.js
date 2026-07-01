#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { tokenize } = require("./tokenizer");
const { prescanDeclarations, prescanTypes } = require("./prescan");
const { parseTokens } = require("./parser_rd");
const { orderedLampFiles } = require("./liborder");
const { extractTopLevelFunctionNames } = require("./native_scan");
const { emitProgram } = require("./emitter");
const { checkProgram, serializeWhenExpr } = require("./checker");

function main() {
    try {
        runCompilation();
    } catch (error) {
        reportCompileError(error);
        process.exit(1);
    }
}

function runCompilation() {
    const args = process.argv.slice(2);
    const encodeStrings = args.includes("--encode-strings");
    const releaseBuild = args.includes("--release");
    const { localeFlag, positionals } = parseArgs(args);
    const [inputFileArg, outputFileArg] = positionals;

    if (!inputFileArg) {
        console.error("Usage: node src/lantern/index.js <input.lamp> [output.js] [--locale <tag>] [--encode-strings]");
        process.exit(1);
    }

    const projectRoot = path.resolve(__dirname, "../..");
    const libSysDir = path.join(projectRoot, "lib", "sys");

    const inputFile = path.resolve(inputFileArg);
    const userFileDir = path.dirname(inputFile);
    const userSource = fs.readFileSync(inputFile, "utf8");

    // The locale pack (language data: articles, case, list prose) auto-loads
    // right after lib/sys and replaces the slot a swap targets. Selection order:
    // the --locale flag wins, else a `locale "…"` source declaration, else the
    // en-US default. See devdocs/text.md (three-layer split) and devdocs/i18n.md.
    const localeTag = localeFlag ?? extractLocaleDecl(userSource) ?? "en-US";
    const libLocaleDir = resolveLibDir(localeTag, projectRoot, userFileDir);
    if (!libLocaleDir) {
        console.error(`error: locale pack not found: ${localeTag} (looked for lib/${localeTag})`);
        process.exit(1);
    }
    const outputFile = outputFileArg
        ? path.resolve(outputFileArg)
        : path.join(path.dirname(inputFile), `${path.basename(inputFile, ".lamp")}.generated.js`);
    const libDirs = gatherLibDirs(libSysDir, libLocaleDir, userSource, inputFile, userFileDir, projectRoot);
    const sourceFiles = gatherLampFiles(libDirs, inputFile, localeTag);
    const { nativeJsContents, nativeFunctionNames } = gatherNativeJs(libDirs);
    const allNodes = [];

    // Tokenize each file once; the token stream feeds both the declaration
    // prescan and the parse below, so the lexer runs exactly once per file.
    const allTokenized = sourceFiles.map((sourceFile) => ({
        sourceFile,
        tokens: tokenize(fs.readFileSync(sourceFile, "utf8"), sourceFile),
    }));
    // A `--release` build drops files marked `not_for_release` (debug-only — e.g. advent's
    // debug verbs in lib/advent/debug.lamp), so a shipped game can't be cheated past puzzles.
    const tokenizedFiles = releaseBuild
        ? allTokenized.filter(({ tokens }) => !tokensMarkNotForRelease(tokens))
        : allTokenized;
    const includedFiles = tokenizedFiles.map((f) => f.sourceFile);

    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
    const actionNames = new Set();
    const objectNames = new Set();
    const typeNames = new Set();
    const fieldNames = new Set();
    const tagNames = new Set();
    const verbNames = new Set();
    const rulebookParams = new Map();
    const rawTemplates = [];
    // Type and field names first, across all files, so nested-object detection in
    // any file sees types/fields declared elsewhere (e.g. a game nesting an `item`
    // whose type — and whose `article` field — live in lib/advent).
    for (const { tokens } of tokenizedFiles) {
        const t = prescanTypes(tokens);
        for (const name of t.typeNames) typeNames.add(name);
        for (const name of t.fieldNames) fieldNames.add(name);
    }
    for (const { tokens } of tokenizedFiles) {
        const decls = prescanDeclarations(tokens, typeNames, fieldNames);
        for (const name of decls.globalNames) globalNames.add(name);
        for (const name of decls.functionNames) functionNames.add(name);
        for (const name of decls.relationNames) relationNames.add(name);
        for (const name of decls.actionNames) actionNames.add(name);
        for (const name of decls.objectNames) objectNames.add(name);
        for (const name of decls.tagNames) tagNames.add(name);
        for (const name of decls.verbNames) verbNames.add(name);
        for (const [name, params] of decls.rulebookParams) rulebookParams.set(name, params);
        rawTemplates.push(...decls.relationTemplates);
    }

    const relationTemplates = buildRelationTemplateDispatch(rawTemplates);

    for (const { sourceFile, tokens } of tokenizedFiles) {
        const ast = parseTokens(tokens, sourceFile, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames, tagNames, rulebookParams, verbNames, typeNames, fieldNames);
        allNodes.push(...ast.nodes);
    }

    if (!hasGameObject(allNodes)) {
        console.error("error: no game object defined.");
        process.exit(1);
    }

    const mergedProgram = { kind: "Program", nodes: deduplicateFunctions(allNodes) };
    checkProgram(mergedProgram, { nativeFunctionNames });

    const warnings = [];
    const emittedJs = emitProgram(mergedProgram, { nativeJsContents, mainFilePath: inputFile, encodeStrings, warnings });
    for (const warning of warnings) {
        console.error(warning);
    }

    // Build identity: a content hash over the compilation source inputs (not the
    // emitted JS, so it is invariant under --encode-strings). The runtime stamps
    // it into saves and refuses to restore a save from a different build. See
    // devdocs/state.md → Save versioning.
    const buildId = computeBuildId(includedFiles, nativeJsContents);
    const outputJs = `lamplighter.setBuildId(${JSON.stringify(buildId)});\n${emittedJs}`;

    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, outputJs, "utf8");

    console.log(`Lantern compiled ${includedFiles.length} file(s) to ${outputFile}${releaseBuild ? " (release)" : ""}`);
}

// A file marks itself debug-only with a top-level `not_for_release` directive; a `--release`
// build drops it. Detected from the token stream (the directive is a keyword token).
function tokensMarkNotForRelease(tokens) {
    return tokens.some((t) => t.type === "KEYWORD" && t.value === "not_for_release");
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

function gatherLibDirs(libSysDir, libLocaleDir, userSource, userFile, userFileDir, projectRoot) {
    const dirs = [libSysDir, libLocaleDir];
    const libImports = extractLibImports(userSource, userFile);
    for (const { name, filePath, lineNumber } of libImports) {
        const libDir = resolveLibDir(name, projectRoot, userFileDir);
        if (!libDir) {
            throw new Error(`${filePath}:${lineNumber}: library not found: ${name}`);
        }
        dirs.push(libDir);
    }
    return dirs;
}

// A reproducible build fingerprint: sha256 over the sorted contents of every
// source input (paths excluded so it is machine-independent). Identical source
// yields the same id; any change yields a different one. 64 bits is ample for
// detecting "different build". See devdocs/state.md.
function computeBuildId(sourceFiles, nativeJsContents) {
    const contents = [
        ...sourceFiles.map((file) => fs.readFileSync(file, "utf8")),
        ...nativeJsContents,
    ].sort();
    const hash = crypto.createHash("sha256");
    for (const content of contents) {
        hash.update(content, "utf8");
        hash.update(" ");
    }
    return hash.digest("hex").slice(0, 16);
}

function gatherLampFiles(libDirs, userFile, localeTag) {
    const [sysDir, ...importedDirs] = libDirs;
    const sysFiles = libDirFiles(sysDir, localeTag);
    const libFiles = importedDirs.flatMap((dir) => libDirFiles(dir, localeTag));
    return [...sysFiles, ...libFiles, userFile];
}

// A library's load-ordered `.lamp` files, followed by its locale override file
// for the active locale (`<dir>/locales/<tag>.lamp`) when present. The override
// loads after the library's own defaults, so a translation pack's
// `NAME: "…"` message overrides win last (the game file, loaded last overall,
// can still override the translation). For the default en-US locale no library
// ships such a file, so load order is unchanged.
function libDirFiles(dir, localeTag) {
    const files = orderedLampFiles(dir).map((entry) => path.join(dir, entry));
    const overridePath = path.join(dir, "locales", `${localeTag}.lamp`);
    if (fs.existsSync(overridePath)) files.push(overridePath);
    return files;
}

function gatherNativeJs(libDirs) {
    const nativeJsContents = [];
    const nativeFunctionNames = new Set();
    for (const dir of libDirs) {
        const indexPath = path.join(dir, "index.js");
        if (!fs.existsSync(indexPath)) continue;
        const content = fs.readFileSync(indexPath, "utf8");
        nativeJsContents.push(content);
        for (const name of extractTopLevelFunctionNames(content)) {
            nativeFunctionNames.add(name);
        }
    }
    return { nativeJsContents, nativeFunctionNames };
}

// Splits argv into the optional `--locale <tag>` / `--locale=<tag>` value and
// the remaining positionals (input/output paths). Other `--` flags (e.g.
// --encode-strings) are handled by their own `includes` checks and dropped here.
function parseArgs(args) {
    let localeFlag = null;
    const positionals = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === "--locale") {
            localeFlag = args[i + 1];
            i += 1;
            continue;
        }
        if (arg.startsWith("--locale=")) {
            localeFlag = arg.slice("--locale=".length);
            continue;
        }
        if (arg.startsWith("--")) continue;
        positionals.push(arg);
    }
    return { localeFlag: localeFlag || null, positionals };
}

// Reads a `locale "tag"` source declaration (the first one wins). Comment- and
// whitespace-tolerant like extractLibImports; returns null when absent.
function extractLocaleDecl(sourceText) {
    for (const line of sourceText.split(/\r?\n/)) {
        const code = line.replace(/#.*$/, "").trim();
        const match = code.match(/^locale\s+"([^"]+)"$/);
        if (match) return match[1];
    }
    return null;
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

// Collapses functions that share a name *and* `when` condition to a single
// definition, keeping the last (so an author file, parsed last, overrides a
// library function — the intended override path). Two such definitions in the
// *same* file are a mistake, not an override, and raise a compile error.
function deduplicateFunctions(nodes) {
    const groups = new Map();
    nodes.forEach((node, index) => {
        if (node.kind !== "FunctionDecl") return;
        const condKey = node.whenExpr === null ? null : serializeWhenExpr(node.whenExpr);
        const key = `${node.name}\0${condKey}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ node, index });
    });

    const keepIndex = new Map();
    for (const [key, group] of groups) {
        const seenFiles = new Set();
        for (const { node } of group) {
            if (seenFiles.has(node.filePath)) {
                const detail = node.whenExpr ? ` with the same 'when' condition` : "";
                throw new Error(`${node.filePath}:${node.lineNumber}: duplicate definition of function "${node.name}"${detail}`);
            }
            seenFiles.add(node.filePath);
        }
        keepIndex.set(key, group[group.length - 1].index);
    }

    return nodes.filter((node, index) => {
        if (node.kind !== "FunctionDecl") return true;
        const condKey = node.whenExpr === null ? null : serializeWhenExpr(node.whenExpr);
        const key = `${node.name}\0${condKey}`;
        return keepIndex.get(key) === index;
    });
}

main();
