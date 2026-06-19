#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { tokenize } = require("./tokenizer");
const { prescanDeclarations } = require("./prescan");
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
    const [inputFileArg, outputFileArg] = args.filter((arg) => !arg.startsWith("--"));

    if (!inputFileArg) {
        console.error("Usage: node src/lantern/index.js <input.lamp> [output.js] [--encode-strings]");
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

    // Tokenize each file once; the token stream feeds both the declaration
    // prescan and the parse below, so the lexer runs exactly once per file.
    const tokenizedFiles = sourceFiles.map((sourceFile) => ({
        sourceFile,
        tokens: tokenize(fs.readFileSync(sourceFile, "utf8"), sourceFile),
    }));

    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
    const actionNames = new Set();
    const objectNames = new Set();
    const tagNames = new Set();
    const rulebookParams = new Map();
    const rawTemplates = [];
    for (const { tokens } of tokenizedFiles) {
        const decls = prescanDeclarations(tokens);
        for (const name of decls.globalNames) globalNames.add(name);
        for (const name of decls.functionNames) functionNames.add(name);
        for (const name of decls.relationNames) relationNames.add(name);
        for (const name of decls.actionNames) actionNames.add(name);
        for (const name of decls.objectNames) objectNames.add(name);
        for (const name of decls.tagNames) tagNames.add(name);
        for (const [name, params] of decls.rulebookParams) rulebookParams.set(name, params);
        rawTemplates.push(...decls.relationTemplates);
    }

    const relationTemplates = buildRelationTemplateDispatch(rawTemplates);

    for (const { sourceFile, tokens } of tokenizedFiles) {
        const ast = parseTokens(tokens, sourceFile, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames, tagNames, rulebookParams);
        allNodes.push(...ast.nodes);
    }

    if (!hasGameObject(allNodes)) {
        console.error("error: no game object defined.");
        process.exit(1);
    }

    const mergedProgram = { kind: "Program", nodes: deduplicateFunctions(allNodes) };
    checkProgram(mergedProgram, { nativeFunctionNames });

    const outputJs = emitProgram(mergedProgram, { nativeJsContents, mainFilePath: inputFile, encodeStrings });

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
    const sysFiles = orderedLampFiles(sysDir).map((entry) => path.join(sysDir, entry));
    const libFiles = importedDirs.flatMap((dir) =>
        orderedLampFiles(dir).map((entry) => path.join(dir, entry)),
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
        for (const name of extractTopLevelFunctionNames(content)) {
            nativeFunctionNames.add(name);
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
