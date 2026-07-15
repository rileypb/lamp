// Lighthouse — web bundle builder.
//
// Produces a directory bundle a player opens in a browser: the shell assets plus
// a single `game.worker.js` that contains the Lamplighter runtime, the browser
// `Worker` bootstrap, and the compiled game. Lighthouse only packages
// Lamplighter's bootstrap; it does not reimplement the sandbox. See
// devdocs/lighthouse.md and devdocs/sandbox.md.

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
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
        return { name: null, title: null, author: null, assets: [] };
    }
}

// Declared image assets (devdocs/freestyle-windows.md): copy the sidecar's exact
// declared set into `assets/` — name-keyed with the source extension, so the file
// name is stable and collision-free (the checker already enforces unique image
// names) — and write `assets.json` mapping name → bundle-relative path. The shell
// fetches the manifest at boot and resolves canvas_image ops through it. Always
// written (even empty), so the shell's fetch never depends on what the game
// declares.
function copyImageAssets(assets, absOut) {
    const manifest = {};
    const assetsDir = path.join(absOut, "assets");
    if (assets.length > 0) fs.mkdirSync(assetsDir, { recursive: true });
    for (const { name, sourcePath } of assets) {
        const fileName = `${name}${path.extname(sourcePath)}`;
        fs.copyFileSync(sourcePath, path.join(assetsDir, fileName));
        manifest[name] = `assets/${fileName}`;
    }
    fs.writeFileSync(path.join(absOut, "assets.json"), JSON.stringify(manifest), "utf8");
    return Object.keys(manifest).length;
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

// Custom shell directory (devdocs/custom-shells.md): `<game>.shell/` beside the
// game file — per-game, so multi-game directories don't collide. Root files whose
// names match stock assets override them; everything else copies verbatim into
// the bundle (subdirectories included).
function shellDirFor(absInput) {
    return path.join(path.dirname(absInput), `${path.basename(absInput, ".lamp")}.shell`);
}

// `--eject-shell`: seed the shell directory with the stock shell files to start
// customizing from. Never overwrites — re-running after edits is safe.
function ejectShellInto(shellDir) {
    fs.mkdirSync(shellDir, { recursive: true });
    for (const asset of SHELL_ASSETS) {
        const dest = path.join(shellDir, asset);
        if (!fs.existsSync(dest)) fs.copyFileSync(path.join(SHELL_DIR, asset), dest);
    }
}

// Copy the shell directory's non-override entries (custom.js/custom.css, sounds,
// art, subdirectories) into the bundle verbatim.
function copyShellExtras(shellDir, absOut) {
    const copied = [];
    for (const entry of fs.readdirSync(shellDir, { withFileTypes: true })) {
        if (!entry.isDirectory() && SHELL_ASSETS.includes(entry.name)) continue;
        fs.cpSync(path.join(shellDir, entry.name), path.join(absOut, entry.name), { recursive: true });
        copied.push(entry.name);
    }
    return copied.sort();
}

// Intermediates (the compiled game, the worker entry) go to a per-invocation temp
// dir, not a build/ folder inside the package: a globally installed lighthouse
// would otherwise write into npm's global node_modules, which may not be writable.
function buildWeb(inputFile, outDir, options = {}) {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "lighthouse-"));
    try {
        return buildWebInto(buildDir, inputFile, outDir, options);
    } finally {
        fs.rmSync(buildDir, { recursive: true, force: true });
    }
}

function buildWebInto(buildDir, inputFile, outDir, { encodeStrings = false, minify = true, release = true, ejectShell = false } = {}) {
    const absInput = path.resolve(inputFile);
    const absOut = path.resolve(outDir);
    fs.mkdirSync(absOut, { recursive: true });

    const shellDir = shellDirFor(absInput);
    if (ejectShell) ejectShellInto(shellDir);
    const hasShellDir = fs.existsSync(shellDir) && fs.statSync(shellDir).isDirectory();

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

    const meta = readGameMeta(metaPath);
    copyImageAssets(meta.assets || [], absOut);

    const hasCustomJs = hasShellDir && fs.existsSync(path.join(shellDir, "custom.js"));
    const hasCustomCss = hasShellDir && fs.existsSync(path.join(shellDir, "custom.css"));

    const title = escapeHtml(pageTitle(meta));
    for (const asset of SHELL_ASSETS) {
        // A shell-directory file matching a stock asset name overrides it
        // (devdocs/custom-shells.md — the "eject" path); index.html templating
        // runs either way.
        const override = hasShellDir ? path.join(shellDir, asset) : null;
        const src = override && fs.existsSync(override) ? override : path.join(SHELL_DIR, asset);
        const dest = path.join(absOut, asset);
        if (asset === "index.html") {
            let html = fs.readFileSync(src, "utf8").replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
            // Inject the custom-layer tags only when the shell dir supplied the
            // files (no dangling references in a stock bundle). Anchored on the
            // stock tags — a fully ejected index.html manages its own tags, so a
            // missing anchor is fine.
            if (hasCustomCss) {
                html = html.replace('<link rel="stylesheet" href="./shell.css">',
                    '<link rel="stylesheet" href="./shell.css">\n    <link rel="stylesheet" href="custom.css">');
            }
            if (hasCustomJs) {
                html = html.replace('<script src="./shell.js"></script>',
                    '<script src="./shell.js"></script>\n    <script src="custom.js"></script>');
            }
            fs.writeFileSync(dest, html, "utf8");
        } else {
            fs.copyFileSync(src, dest);
        }
    }

    const extras = hasShellDir ? copyShellExtras(shellDir, absOut) : [];

    return {
        outDir: absOut,
        files: ["game.worker.js", "assets.json", ...SHELL_ASSETS, ...extras],
        meta: { name: meta.name || null, title: meta.title || null, author: meta.author || null },
    };
}

module.exports = { buildWeb };
