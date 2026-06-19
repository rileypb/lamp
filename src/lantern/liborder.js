// Resolves the load order of a library's `.lamp` files.
//
// Load order is observable: it sets the registration order of same-band,
// same-tier action/rulebook rules (and which same-signature function wins on a
// cross-file override). The historical default — alphabetical by filename — is
// implicit and brittle: renaming a file can silently change rule precedence. A
// library may instead pin order explicitly with a `load.order` manifest listing
// filenames (one per line; `#` comments and blank lines ignored). Listed files
// load first in that order; any remaining `.lamp` files follow alphabetically,
// so adding a file needs no manifest edit. A manifest entry naming a file that
// is not present is an error, so the manifest can't silently drift.
//
// See devdocs/architecture.md ("Known Architectural Issues" → G).

const fs = require("fs");
const path = require("path");

const MANIFEST_NAME = "load.order";

// Pure ordering over a directory's already-sorted `.lamp` filenames and the
// manifest text (or null when there is no manifest). `manifestLabel` is only
// used in the drift error message.
function orderLampFiles(sortedLampFiles, manifestText, manifestLabel = MANIFEST_NAME) {
    if (manifestText == null) return [...sortedLampFiles];

    const available = new Set(sortedLampFiles);
    const ordered = [];
    const seen = new Set();
    for (const rawLine of manifestText.split(/\r?\n/)) {
        const name = rawLine.replace(/#.*$/, "").trim();
        if (!name) continue;
        if (!available.has(name)) {
            throw new Error(`${manifestLabel}: lists "${name}", which is not a .lamp file in this library`);
        }
        if (!seen.has(name)) {
            ordered.push(name);
            seen.add(name);
        }
    }
    for (const name of sortedLampFiles) {
        if (!seen.has(name)) ordered.push(name);
    }
    return ordered;
}

// Filesystem entry point: reads a lib dir's `.lamp` files and its optional
// `load.order`, returning filenames in load order.
function orderedLampFiles(dir) {
    const lampFiles = fs.readdirSync(dir).filter((entry) => entry.endsWith(".lamp")).sort();
    const manifestPath = path.join(dir, MANIFEST_NAME);
    const manifestText = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, "utf8") : null;
    return orderLampFiles(lampFiles, manifestText, manifestPath);
}

module.exports = {
    orderLampFiles,
    orderedLampFiles,
    MANIFEST_NAME,
};
