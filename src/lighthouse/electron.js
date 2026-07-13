// Lighthouse — Electron project builder.
//
// Wraps the web bundle as an Electron *project directory* the author runs with
// `npx electron .` (or `npm install && npm start`) and packages with the tool of
// their choice — no Electron dependency enters Lamp itself. The bundle is
// buildWeb's output verbatim minus sw.js: under app:// the page is already
// cross-origin isolated (main.js injects the headers), so the service worker is
// inert and shipping it would imply a mechanism that isn't in play. See
// devdocs/lighthouse.md ("Electron").

const fs = require("fs");
const path = require("path");
const { buildWeb } = require("./index");

const TEMPLATE_DIR = path.join(__dirname, "electron");
const TEMPLATES = ["main.js", "preload.js"];
const ELECTRON_RANGE = "^43.0.0";

function npmPackageName(rawName) {
    const name = String(rawName)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^[._-]+|[._-]+$/g, "");
    return name || "lamp-game";
}

function buildElectron(inputFile, outDir, options = {}) {
    const absOut = path.resolve(outDir);
    const appDir = path.join(absOut, "app");
    const web = buildWeb(inputFile, appDir, options);

    fs.rmSync(path.join(appDir, "sw.js"), { force: true });
    for (const template of TEMPLATES) {
        fs.copyFileSync(path.join(TEMPLATE_DIR, template), path.join(absOut, template));
    }

    const baseName = path.basename(inputFile, ".lamp");
    const pkg = {
        name: npmPackageName(web.meta.name || baseName),
        productName: web.meta.title || web.meta.name || baseName,
        version: "1.0.0",
        private: true,
        main: "main.js",
        scripts: { start: "electron ." },
        devDependencies: { electron: ELECTRON_RANGE },
    };
    if (web.meta.author) pkg.author = web.meta.author;
    fs.writeFileSync(path.join(absOut, "package.json"), JSON.stringify(pkg, null, 2) + "\n", "utf8");

    const appFiles = web.files.filter((f) => f !== "sw.js").map((f) => path.join("app", f));
    return { outDir: absOut, files: [...TEMPLATES, "package.json", ...appFiles] };
}

module.exports = { buildElectron };
