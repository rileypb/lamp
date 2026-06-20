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

// Shared input buffer: 8-byte header (ready flag + byte length) then UTF-8 line
// data. 64 KiB comfortably holds a line of player input.
const INPUT_BUFFER_BYTES = 64 * 1024;
const INPUT_DATA_OFFSET = 8;

// Save transport buffer: same header layout, but sized for whole save blobs
// (state JSON) returned host→worker. 4 MiB is generous for any realistic IF save.
const SAVE_BUFFER_BYTES = 4 * 1024 * 1024;
// Provisional save location for the dev/CLI host; a durable per-user location is
// a later concern (see devdocs/state.md). Files are namespaced by game via the
// key the runtime supplies.
const SAVE_DIR = path.join(os.tmpdir(), "lamp-saves");

// Read one line from the host's stdin, character by character. The host is
// trusted and owns fd 0; the sandboxed game cannot touch it directly.
function readStdinLine() {
    const buf = Buffer.alloc(1);
    let line = "";
    while (true) {
        let n;
        try {
            n = fs.readSync(0, buf, 0, 1);
        } catch (err) {
            if (err.code === "EAGAIN") continue;
            throw err;
        }
        if (n === 0) break;
        const ch = buf.toString("utf8", 0, 1);
        if (ch === "\n") break;
        line += ch;
    }
    return line;
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

    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, {
            workerData: { generatedPath: path.resolve(generatedPath), inputBuffer, saveBuffer },
        });

        worker.on("message", (msg) => {
            if (msg.type === "print") {
                out.write(`${msg.value}\n`);
            } else if (msg.type === "write") {
                out.write(msg.value);
            } else if (msg.type === "log") {
                err.write(`${msg.value}\n`);
            } else if (msg.type === "readline") {
                const bytes = encoder.encode(readStdinLine());
                const len = Math.min(bytes.length, dataCapacity);
                data.set(bytes.subarray(0, len), 0);
                Atomics.store(ctrl, 1, len);
                Atomics.store(ctrl, 0, 1);
                Atomics.notify(ctrl, 0);
            } else if (msg.type === "prompt_readline") {
                out.write(msg.prompt);
                const line = readStdinLine();
                if (!process.stdin.isTTY) out.write(`${line}\n`);
                const bytes = encoder.encode(line);
                const len = Math.min(bytes.length, dataCapacity);
                data.set(bytes.subarray(0, len), 0);
                Atomics.store(ctrl, 1, len);
                Atomics.store(ctrl, 0, 1);
                Atomics.notify(ctrl, 0);
            } else if (msg.type === "save_write") {
                try {
                    fs.mkdirSync(SAVE_DIR, { recursive: true });
                    fs.writeFileSync(path.join(SAVE_DIR, `${msg.key}.json`), msg.data, "utf8");
                    replySave("ok");
                } catch (e) {
                    replySave(`error: ${e.message}`);
                }
            } else if (msg.type === "save_read") {
                const file = path.join(SAVE_DIR, `${msg.key}.json`);
                replySave(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
            } else if (msg.type === "error") {
                worker.terminate();
                reject(new Error(msg.message));
            }
        });

        worker.on("error", reject);
        worker.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`sandbox worker exited with code ${code}`));
        });
    });
}

module.exports = { playFile };
