const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "../..");

// Isolate save-file I/O (the `save1` fixture) to a throwaway dir so tests never
// touch the real per-user save location.
const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-golden-saves-"));
process.on("exit", () => fs.rmSync(saveDir, { recursive: true, force: true }));
const lanternCli = path.join(projectRoot, "src", "lantern", "index.js");
const playCli = path.join(projectRoot, "src", "lamplighter", "play.js");
const testRoots = [
    path.join(projectRoot, "sample"),
    path.join(projectRoot, "tests", "fixtures"),
];
const expectedDir = path.join(projectRoot, "tests", "golden", "expected");
const tmpDir = path.join(projectRoot, "tests", "golden", "tmp");

// Dev utility: `node run-golden.js --update` rewrites the expected stdout (and
// generated JS) from current output instead of asserting. Review the git diff after.
const updateMode = process.argv.includes("--update");

function main() {
    const cases = discoverCases();
    const failures = [];

    for (const testCase of cases) {
        const name = path.basename(testCase.inputPath);
        try {
            const compileResult = compileCase(testCase.inputPath, testCase.generatedPath, testCase.expectCompileFailure);

            if (!testCase.expectCompileFailure && testCase.expectedJsPath) {
                if (updateMode) {
                    fs.copyFileSync(testCase.generatedPath, testCase.expectedJsPath);
                } else {
                    assertFileMatches(testCase.generatedPath, testCase.expectedJsPath, `${name} generated JavaScript`);
                }
            }

            const stdout = normalizeProjectPaths(testCase.expectCompileFailure
                ? compileResult.stdout
                : runGenerated(testCase.generatedPath, testCase.expectRuntimeFailure, testCase.stdinContent));
            if (updateMode) {
                fs.writeFileSync(testCase.expectedStdoutPath, stdout);
            } else {
                assertTextMatches(
                    stdout,
                    fs.readFileSync(testCase.expectedStdoutPath, "utf8"),
                    `${name} runtime stdout`,
                );
            }
        } catch (error) {
            failures.push({ name, message: error.message });
        }
    }

    // End-to-end: the `save1` fixture saves slot "slot1" before any turn is taken,
    // so the real CLI host must have written an unobfuscated metadata sidecar next
    // to the blob (devdocs/sandbox.md → "Save/restore broker protocol").
    if (!updateMode) {
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(saveDir, "Save_Demo__slot1.meta"), "utf8"));
            if (typeof meta.savedAt !== "string" || !meta.savedAt) throw new Error("sidecar missing savedAt");
            if (meta.turns !== 0) throw new Error(`sidecar turns: expected 0, got ${meta.turns}`);
            if (meta.name !== "slot1") throw new Error(`sidecar name: expected "slot1", got ${meta.name}`);
        } catch (error) {
            failures.push({ name: "save1 metadata sidecar", message: error.message });
        }
    }

    if (updateMode) {
        console.log(`Updated ${cases.length} golden(s).${failures.length ? ` ${failures.length} error(s):` : ""}`);
        for (const { name, message } of failures) {
            console.error(`ERROR: ${name}\n${message}\n`);
        }
        return;
    }

    if (failures.length === 0) {
        console.log(`Golden checks passed. (${cases.length} tests)`);
        return;
    }

    for (const { name, message } of failures) {
        console.error(`FAIL: ${name}`);
        console.error(message);
        console.error("");
    }
    console.error(`${failures.length} of ${cases.length} test(s) failed.`);
    process.exit(1);
}

function discoverCases() {
    return testRoots.flatMap(lampInputsIn).map(buildCase);
}

// Every `.lamp` input under a test root: files directly in it, plus files one level down in an
// immediate subdirectory (so a multi-file sample game in its own dir — e.g.
// `sample/phobos/phobos.lamp`, alongside its `lib/phobos/` — is discovered, while deeper library
// files are not). Sorted for stable ordering; expected files are keyed by the bare base name.
function lampInputsIn(rootDir) {
    if (!fs.existsSync(rootDir)) {
        return [];
    }
    const inputs = [];
    for (const entry of fs.readdirSync(rootDir).sort()) {
        const full = path.join(rootDir, entry);
        const stat = fs.statSync(full);
        if (stat.isFile() && entry.endsWith(".lamp")) {
            inputs.push(full);
        } else if (stat.isDirectory()) {
            for (const sub of fs.readdirSync(full).sort()) {
                const subPath = path.join(full, sub);
                if (sub.endsWith(".lamp") && fs.statSync(subPath).isFile()) {
                    inputs.push(subPath);
                }
            }
        }
    }
    return inputs;
}

function buildCase(inputPath) {
    const baseName = path.basename(inputPath, ".lamp");
    const generatedPath = path.join(tmpDir, `${baseName}.generated.js`);
    const expectedJsCandidate = path.join(expectedDir, `${baseName}.generated.js`);
    const expectedStdoutPath = path.join(expectedDir, `${baseName}.stdout.txt`);
    const expectedStdout = fs.readFileSync(expectedStdoutPath, "utf8");
    const expectedJsExists = fs.existsSync(expectedJsCandidate);
    const expectCompileFailure = !expectedJsExists && (
        expectedStdout.trimStart().startsWith("error:") ||
        expectedStdout.trimStart().startsWith("Compile error:")
    );
    const expectRuntimeFailure = expectedStdout.trimStart().startsWith("Runtime error:");
    const stdinPath = path.join(expectedDir, `${baseName}.stdin.txt`);
    const stdinContent = fs.existsSync(stdinPath) ? fs.readFileSync(stdinPath, "utf8") : null;

    return {
        inputPath,
        generatedPath,
        expectedJsPath: expectedJsExists ? expectedJsCandidate : null,
        expectedStdoutPath,
        expectCompileFailure,
        expectRuntimeFailure,
        stdinContent,
    };
}

function compileCase(inputPath, outputPath, expectCompileFailure) {
    try {
        const stdout = execFileSync("node", [lanternCli, inputPath, outputPath], {
            cwd: projectRoot,
            stdio: "pipe",
            encoding: "utf8",
        });
        return { stdout };
    } catch (error) {
        if (!expectCompileFailure) {
            throw error;
        }

        if (typeof error.stderr === "string") {
            return { stdout: error.stderr };
        }
        throw error;
    }
}

function runGenerated(generatedPath, expectRuntimeFailure = false, stdinContent = null) {
    try {
        return execFileSync("node", [playCli, generatedPath], {
            cwd: projectRoot,
            stdio: "pipe",
            encoding: "utf8",
            input: stdinContent !== null ? stdinContent : undefined,
            env: { ...process.env, LAMP_SAVE_DIR: saveDir },
        });
    } catch (error) {
        if (!expectRuntimeFailure) throw error;
        const stderr = typeof error.stderr === "string" ? error.stderr : "";
        const errorLine = stderr.split("\n").find((l) => /^Error: /.test(l));
        if (!errorLine) {
            throw new Error(`Runtime failure but could not extract error message from stderr:\n${stderr}`);
        }
        return `Runtime error: ${errorLine.slice("Error: ".length)}\n`;
    }
}

function assertFileMatches(actualPath, expectedPath, label) {
    const actual = fs.readFileSync(actualPath, "utf8");
    const expected = fs.readFileSync(expectedPath, "utf8");
    assertTextMatches(actual, expected, label);
}

function assertTextMatches(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(buildDiffMessage(label, expected, actual));
    }
}

function buildDiffMessage(label, expected, actual) {
    const expectedLines = splitLines(expected);
    const actualLines = splitLines(actual);
    const maxLines = Math.max(expectedLines.length, actualLines.length);

    const differingIndices = [];
    for (let i = 0; i < maxLines; i += 1) {
        if ((expectedLines[i] || "") !== (actualLines[i] || "")) {
            differingIndices.push(i);
        }
    }

    const sections = [];
    const maxDiffsToShow = 20;
    const shown = differingIndices.slice(0, maxDiffsToShow);

    for (const index of shown) {
        const expectedLine = expectedLines[index] || "";
        const actualLine = actualLines[index] || "";

        sections.push(`line ${index + 1}:`);
        sections.push(`  expected (${expectedLine.length}): ${showWhitespace(expectedLine)}`);
        sections.push(`  actual   (${actualLine.length}): ${showWhitespace(actualLine)}`);
        sections.push(`  marker         : ${buildCharMarker(expectedLine, actualLine)}`);
    }

    if (differingIndices.length > shown.length) {
        sections.push(`... ${differingIndices.length - shown.length} more differing line(s) omitted.`);
    }

    return [
        `Golden mismatch for ${label}`,
        `expected length=${expected.length}, actual length=${actual.length}`,
        "Whitespace legend: space=· tab=⇥ carriage-return=␍",
        ...sections,
    ].join("\n");
}

function splitLines(text) {
    const normalized = text.replace(/\r\n/g, "\n");
    return normalized.split("\n");
}

function showWhitespace(line) {
    return line
        .replace(/\t/g, "⇥")
        .replace(/ /g, "·")
        .replace(/\r/g, "␍");
}

function buildCharMarker(expectedLine, actualLine) {
    const expectedVisible = showWhitespace(expectedLine);
    const actualVisible = showWhitespace(actualLine);
    const maxLen = Math.max(expectedVisible.length, actualVisible.length);
    let marker = "";

    for (let i = 0; i < maxLen; i += 1) {
        marker += expectedVisible[i] === actualVisible[i] ? " " : "^";
    }

    return marker || "(empty)";
}

function normalizeProjectPaths(text) {
    return text.split(projectRoot + "/").join("");
}

main();
