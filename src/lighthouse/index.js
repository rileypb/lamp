// Lighthouse — web bundle builder.
//
// Produces a directory bundle a player opens in a browser: the shell assets plus
// a single `game.worker.js` that contains the Lamplighter runtime, the browser
// `Worker` bootstrap, and the compiled game. Lighthouse only packages
// Lamplighter's bootstrap; it does not reimplement the sandbox. See
// devdocs/lighthouse.md and devdocs/sandbox.md.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const LANTERN_CLI = path.join(PROJECT_ROOT, "src", "lantern", "index.js");
const WORKER_BOOTSTRAP = path.join(PROJECT_ROOT, "src", "lamplighter", "sandbox", "worker-browser.js");
const SHELL_DIR = path.join(__dirname, "web");
const SHELL_ASSETS = ["index.html", "shell.css", "shell.js", "sw.js"];

// Compile the game to a body-only module via the standard Lantern CLI rather than
// reimplementing its prescan/parse pipeline. The output references `lamplighter`,
// `require`, and `console` as free globals.
function compileGame(inputFile, buildDir, { encodeStrings = false } = {}) {
    const generatedPath = path.join(buildDir, `${path.basename(inputFile, ".lamp")}.generated.js`);
    const args = [LANTERN_CLI, inputFile, generatedPath];
    if (encodeStrings) args.push("--encode-strings");
    execFileSync("node", args, { stdio: "inherit" });
    return generatedPath;
}

// Wrap the body-only module as the `runGame` factory the bootstrap expects. The
// `lamplighter`/`require`/`console` parameters bind the emitted code's free
// globals to the controlled values the bootstrap supplies — the browser analogue
// of the dev `vm` context. esbuild leaves the shadowed `require` calls (e.g. a
// native lib's `require("fs")`) untouched, so they hit the throwing shim at
// runtime instead of being resolved at build time.
function wrapAsWorkerEntry(generatedCode) {
    return [
        `const { runGame } = require(${JSON.stringify(WORKER_BOOTSTRAP)});`,
        "runGame(function (lamplighter, require, console) {",
        generatedCode,
        "});",
        "",
    ].join("\n");
}

function buildWeb(inputFile, outDir, { encodeStrings = false } = {}) {
    const absInput = path.resolve(inputFile);
    const absOut = path.resolve(outDir);
    const buildDir = path.join(PROJECT_ROOT, "build");
    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(absOut, { recursive: true });

    const generatedPath = compileGame(absInput, buildDir, { encodeStrings });
    const generatedCode = fs.readFileSync(generatedPath, "utf8");

    const entryPath = path.join(buildDir, `${path.basename(absInput, ".lamp")}.worker-entry.js`);
    fs.writeFileSync(entryPath, wrapAsWorkerEntry(generatedCode), "utf8");

    esbuild.buildSync({
        entryPoints: [entryPath],
        outfile: path.join(absOut, "game.worker.js"),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
    });

    for (const asset of SHELL_ASSETS) {
        fs.copyFileSync(path.join(SHELL_DIR, asset), path.join(absOut, asset));
    }

    return { outDir: absOut, files: ["game.worker.js", ...SHELL_ASSETS] };
}

module.exports = { buildWeb };
