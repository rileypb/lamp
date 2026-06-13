const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "../..");
const lanternCli = path.join(projectRoot, "src", "lantern", "index.js");
const testRoots = [
    path.join(projectRoot, "sample"),
    path.join(projectRoot, "tests", "fixtures"),
];
const expectedDir = path.join(projectRoot, "tests", "golden", "expected");
const tmpDir = path.join(projectRoot, "tests", "golden", "tmp");

function main() {
    const cases = discoverCases();
    const failures = [];

    for (const testCase of cases) {
        const name = path.basename(testCase.inputPath);
        try {
            const compileResult = compileCase(testCase.inputPath, testCase.generatedPath, testCase.expectCompileFailure);

            if (!testCase.expectCompileFailure && testCase.expectedJsPath) {
                assertFileMatches(testCase.generatedPath, testCase.expectedJsPath, `${name} generated JavaScript`);
            }

            const stdout = testCase.expectCompileFailure ? compileResult.stdout : runGenerated(testCase.generatedPath);
            assertTextMatches(
                stdout,
                fs.readFileSync(testCase.expectedStdoutPath, "utf8"),
                `${name} runtime stdout`,
            );
        } catch (error) {
            failures.push({ name, message: error.message });
        }
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
    return testRoots
        .flatMap((rootDir) => {
            if (!fs.existsSync(rootDir)) {
                return [];
            }

            return fs.readdirSync(rootDir)
                .filter((entry) => entry.endsWith(".lamp"))
                .sort()
                .map((entry) => {
                    const baseName = path.basename(entry, ".lamp");
                    const inputPath = path.join(rootDir, entry);
                    const generatedPath = path.join(tmpDir, `${baseName}.generated.js`);
                    const expectedJsCandidate = path.join(expectedDir, `${baseName}.generated.js`);
                    const expectedStdoutPath = path.join(expectedDir, `${baseName}.stdout.txt`);
                    const expectedStdout = fs.readFileSync(expectedStdoutPath, "utf8");
                    const expectedJsExists = fs.existsSync(expectedJsCandidate);
                    const expectCompileFailure = !expectedJsExists && (
                        expectedStdout.trimStart().startsWith("error:") ||
                        expectedStdout.trimStart().startsWith("Compile error:")
                    );

                    return {
                        inputPath,
                        generatedPath,
                        expectedJsPath: expectedJsExists ? expectedJsCandidate : null,
                        expectedStdoutPath,
                        expectCompileFailure,
                    };
                });
        });
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

function runGenerated(generatedPath) {
    return execFileSync("node", [generatedPath], {
        cwd: projectRoot,
        stdio: "pipe",
        encoding: "utf8",
    });
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

main();
