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

    for (const testCase of cases) {
        const compileResult = compileCase(testCase.inputPath, testCase.generatedPath, testCase.expectCompileFailure);

        if (!testCase.expectCompileFailure) {
            assertFileMatches(testCase.generatedPath, testCase.expectedJsPath, `${path.basename(testCase.inputPath)} generated JavaScript`);
        }

        const stdout = testCase.expectCompileFailure ? compileResult.stdout : runGenerated(testCase.generatedPath);
        assertTextMatches(
            stdout,
            fs.readFileSync(testCase.expectedStdoutPath, "utf8"),
            `${path.basename(testCase.inputPath)} runtime stdout`,
        );
    }

    console.log("Golden checks passed.");
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
                    const expectedJsPath = path.join(expectedDir, `${baseName}.generated.js`);
                    const expectedStdoutPath = path.join(expectedDir, `${baseName}.stdout.txt`);

                    return {
                        inputPath,
                        generatedPath,
                        expectedJsPath,
                        expectedStdoutPath,
                        expectCompileFailure: !fs.existsSync(expectedJsPath),
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

        if (typeof error.stdout === "string") {
            return { stdout: error.stdout };
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
        throw new Error(`Golden mismatch for ${label}`);
    }
}

main();
