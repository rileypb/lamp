#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseSource } = require("./parser_rd");
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
    const runtimeModulePath = path.join(projectRoot, "src", "lamplighter");
    const runtimeRequirePath = toNodeRequirePath(path.relative(path.dirname(outputFile), runtimeModulePath));

    const libDirs = gatherLibDirs(libSysDir, inputFile, projectRoot);
    const sourceFiles = gatherLampFiles(libDirs, inputFile);
    const { nativeJsContents, nativeFunctionNames } = gatherNativeJs(libDirs);
    const allNodes = [];

    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
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
    }

    for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, "utf8");
        const ast = parseSource(source, sourceFile, globalNames, functionNames, relationNames);
        allNodes.push(...ast.nodes);
    }

    if (!hasGameObject(allNodes)) {
        console.error("error: no game object defined.");
        process.exit(1);
    }

    const mergedProgram = { kind: "Program", nodes: deduplicateFunctions(allNodes) };
    checkProgram(mergedProgram, { nativeFunctionNames });

    const outputJs = emitProgram(mergedProgram, { runtimeRequirePath, nativeJsContents });

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

function toNodeRequirePath(relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    if (normalized.startsWith(".")) {
        return normalized;
    }
    return `./${normalized}`;
}

main();
