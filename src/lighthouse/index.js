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
function compileGame(inputFile, buildDir, { encodeStrings = false, release = false } = {}) {
    const generatedPath = path.join(buildDir, `${path.basename(inputFile, ".lamp")}.generated.js`);
    const metaPath = path.join(buildDir, `${path.basename(inputFile, ".lamp")}.meta.json`);
    const args = [LANTERN_CLI, inputFile, generatedPath, "--meta", metaPath];
    if (encodeStrings) args.push("--encode-strings");
    if (release) args.push("--release");
    execFileSync("node", args, { stdio: "inherit" });
    return { generatedPath, metaPath };
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

// Reads the game-identity sidecar Lantern emits (--meta), so the page title uses the
// author-parsed name/title/author rather than a lossy source re-scan here. Degrades
// gracefully to an empty record if the sidecar is missing or unreadable.
function readGameMeta(metaPath) {
    try {
        return JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
        return { name: null, title: null, author: null };
    }
}

// The page title: the display `title` when the game set one (it may hold spaces and
// punctuation the identifier can't), else the game object's identifier name.
function pageTitle({ name, title, author }) {
    const displayName = title || name;
    if (displayName && author) return `${displayName} by ${author}`;
    if (displayName) return displayName;
    return "Lamp Game";
}

function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildWeb(inputFile, outDir, { encodeStrings = false, minify = true, release = true } = {}) {
    const absInput = path.resolve(inputFile);
    const absOut = path.resolve(outDir);
    const buildDir = path.join(PROJECT_ROOT, "build");
    fs.mkdirSync(buildDir, { recursive: true });
    fs.mkdirSync(absOut, { recursive: true });

    const { generatedPath, metaPath } = compileGame(absInput, buildDir, { encodeStrings, release });
    const generatedCode = fs.readFileSync(generatedPath, "utf8");

    const entryPath = path.join(buildDir, `${path.basename(absInput, ".lamp")}.worker-entry.js`);
    fs.writeFileSync(entryPath, wrapAsWorkerEntry(generatedCode), "utf8");

    // minify mangles identifiers and strips whitespace/comments. It is safe with
    // the sandbox `require` shadow (esbuild renames consistently) and leaves
    // property names like `lamplighter.decode` intact. Off via --no-minify for
    // readable output when debugging the bundle.
    esbuild.buildSync({
        entryPoints: [entryPath],
        outfile: path.join(absOut, "game.worker.js"),
        bundle: true,
        format: "iife",
        platform: "browser",
        target: "es2020",
        minify,
        legalComments: "none",
    });

    const title = escapeHtml(pageTitle(readGameMeta(metaPath)));
    for (const asset of SHELL_ASSETS) {
        const src = path.join(SHELL_DIR, asset);
        const dest = path.join(absOut, asset);
        if (asset === "index.html") {
            const html = fs.readFileSync(src, "utf8").replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
            fs.writeFileSync(dest, html, "utf8");
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    return { outDir: absOut, files: ["game.worker.js", ...SHELL_ASSETS] };
}

module.exports = { buildWeb };
