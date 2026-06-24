// Terminal/stdio host (dev run path).
//
// Spawns the game worker and relays its channels: `print` output to stdout,
// bridged `console` to stderr. This is the dev implementation of the transport
// host; Lighthouse provides browser/Electron hosts over the same protocol. See
// devdocs/sandbox.md.

const { Worker } = require("worker_threads");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createPlainBackend } = require("./backends/plain");
const { createTuiBackend } = require("./backends/tui");

// Shared input buffer: 8-byte header (ready flag + byte length) then UTF-8 line
// data. 64 KiB comfortably holds a line of player input.
const INPUT_BUFFER_BYTES = 64 * 1024;
const INPUT_DATA_OFFSET = 8;

// Save transport buffer: same header layout, but sized for whole save blobs
// (state JSON) returned host→worker. 4 MiB is generous for any realistic IF save.
const SAVE_BUFFER_BYTES = 4 * 1024 * 1024;

// Durable per-user save location, following each platform's app-data convention,
// so saves survive across sessions. `LAMP_SAVE_DIR` overrides it (used by tests to
// stay out of the real user directory, and by anyone wanting a custom location).
// Files are namespaced by game via the key the runtime supplies. See
// devdocs/state.md.
function defaultSaveDir() {
    const home = os.homedir();
    if (process.platform === "darwin") {
        return path.join(home, "Library", "Application Support", "lamp", "saves");
    }
    if (process.platform === "win32") {
        return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "lamp", "saves");
    }
    return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "lamp", "saves");
}
const SAVE_DIR = process.env.LAMP_SAVE_DIR || defaultSaveDir();

// Enumerate the metadata sidecars for slots under `prefix` (this game's key
// namespace), newest first. Reads only the unobfuscated `.meta` files, never the
// blobs; skips foreign games (prefix mismatch) and unreadable/corrupt sidecars.
// ISO `savedAt` strings sort lexicographically by time. See devdocs/sandbox.md.
function listSaveMeta(dir, prefix) {
    let entries;
    try {
        entries = fs.readdirSync(dir);
    } catch (e) {
        return [];
    }
    const rows = [];
    for (const entry of entries) {
        if (!entry.endsWith(".meta")) continue;
        const key = entry.slice(0, -".meta".length);
        if (!key.startsWith(prefix)) continue;
        try {
            rows.push(JSON.parse(fs.readFileSync(path.join(dir, entry), "utf8")));
        } catch (e) {
            // Skip a corrupt or unreadable sidecar rather than fail the whole list.
        }
    }
    rows.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    return rows;
}

function playFile(generatedPath, { out = process.stdout, err = process.stderr } = {}) {
    const workerPath = path.join(__dirname, "worker.js");
    const inputBuffer = new SharedArrayBuffer(INPUT_BUFFER_BYTES);
    const ctrl = new Int32Array(inputBuffer, 0, 2);
    const data = new Uint8Array(inputBuffer, INPUT_DATA_OFFSET);
    const dataCapacity = INPUT_BUFFER_BYTES - INPUT_DATA_OFFSET;
    const encoder = new TextEncoder();

    const saveBuffer = new SharedArrayBuffer(SAVE_BUFFER_BYTES);
    const sctrl = new Int32Array(saveBuffer, 0, 2);
    const sdata = new Uint8Array(saveBuffer, INPUT_DATA_OFFSET);
    const saveCapacity = SAVE_BUFFER_BYTES - INPUT_DATA_OFFSET;

    // Reply to a brokered save op: a string payload, or null → length -1 sentinel.
    function replySave(text) {
        if (text === null) {
            Atomics.store(sctrl, 1, -1);
        } else {
            const bytes = encoder.encode(text);
            const len = Math.min(bytes.length, saveCapacity);
            sdata.set(bytes.subarray(0, len), 0);
            Atomics.store(sctrl, 1, len);
        }
        Atomics.store(sctrl, 0, 1);
        Atomics.notify(sctrl, 0);
    }

    // Deliver one line of player input into the shared buffer, releasing the worker
    // (blocked on Atomics.wait). A render backend calls this when a line is ready.
    function deliverLine(line) {
        const bytes = encoder.encode(line);
        const len = Math.min(bytes.length, dataCapacity);
        data.set(bytes.subarray(0, len), 0);
        Atomics.store(ctrl, 1, len);
        Atomics.store(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
    }

    // The render backend owns all terminal I/O. An interactive TUI when out/stdin are
    // a TTY (and LAMP_NO_TUI is unset); otherwise plain stdio — so pipes, redirection,
    // and the golden harness stay on the deterministic plain path.
    const useTui = out.isTTY && process.stdin.isTTY && !process.env.LAMP_NO_TUI;
    const backend = useTui ? createTuiBackend({ out, err }) : createPlainBackend({ out, err, fs });
    backend.start();

    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, {
            workerData: { generatedPath: path.resolve(generatedPath), inputBuffer, saveBuffer },
        });

        worker.on("message", (msg) => {
            if (msg.type === "write") {
                backend.write(msg.value, msg.styles);
            } else if (msg.type === "log") {
                backend.log(msg.value);
            } else if (msg.type === "status") {
                backend.setStatus(msg.left, msg.right);
            } else if (msg.type === "readline") {
                backend.requestLine(null, deliverLine);
            } else if (msg.type === "prompt_readline") {
                backend.requestLine(msg.prompt, deliverLine);
            } else if (msg.type === "save_write") {
                try {
                    fs.mkdirSync(SAVE_DIR, { recursive: true });
                    fs.writeFileSync(path.join(SAVE_DIR, `${msg.key}.sav`), msg.data, "utf8");
                    // Unobfuscated metadata sidecar: a save picker reads it to label
                    // slots without decoding the blob. See devdocs/sandbox.md.
                    if (msg.meta) {
                        fs.writeFileSync(path.join(SAVE_DIR, `${msg.key}.meta`), JSON.stringify(msg.meta), "utf8");
                    }
                    replySave("ok");
                } catch (e) {
                    replySave(`error: ${e.message}`);
                }
            } else if (msg.type === "save_read") {
                const file = path.join(SAVE_DIR, `${msg.key}.sav`);
                replySave(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
            } else if (msg.type === "save_list") {
                replySave(JSON.stringify(listSaveMeta(SAVE_DIR, msg.prefix)));
            } else if (msg.type === "error") {
                backend.stop();
                worker.terminate();
                reject(new Error(msg.message));
            }
        });

        worker.on("error", (e) => {
            backend.stop();
            reject(e);
        });
        worker.on("exit", (code) => {
            backend.stop();
            if (code === 0) resolve();
            else reject(new Error(`sandbox worker exited with code ${code}`));
        });
    });
}

module.exports = { playFile, listSaveMeta };
