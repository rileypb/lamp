#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { parseSource } = require("./parser");
const { emitProgram } = require("./emitter");

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

    const sourceFiles = gatherSourceFiles(libSysDir, inputFile);
    const allNodes = [];

    for (const sourceFile of sourceFiles) {
        const source = fs.readFileSync(sourceFile, "utf8");
        const ast = parseSource(source, sourceFile);
        allNodes.push(...ast.nodes);
    }

    if (!hasGameObject(allNodes)) {
        console.log("error: no game object defined.");
        process.exit(1);
    }

    const mergedProgram = { kind: "Program", nodes: allNodes };
    const outputJs = emitProgram(mergedProgram, { runtimeRequirePath });

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

function gatherSourceFiles(libSysDir, userFile) {
    const sysFiles = fs.readdirSync(libSysDir)
        .filter((entry) => entry.endsWith(".lamp"))
        .sort()
        .map((entry) => path.join(libSysDir, entry));

    return [...sysFiles, userFile];
}

function hasGameObject(nodes) {
    return nodes.some((node) => node.kind === "ObjectDecl" && node.typeName === "game");
}

function toNodeRequirePath(relativePath) {
    const normalized = relativePath.split(path.sep).join("/");
    if (normalized.startsWith(".")) {
        return normalized;
    }
    return `./${normalized}`;
}

main();
