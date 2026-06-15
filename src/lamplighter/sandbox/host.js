// Terminal/stdio host (dev run path).
//
// Spawns the game worker and relays its channels: `print` output to stdout,
// bridged `console` to stderr. This is the dev implementation of the transport
// host; Lighthouse provides browser/Electron hosts over the same protocol. See
// devdocs/sandbox.md.

const { Worker } = require("worker_threads");
const fs = require("fs");
const path = require("path");

// Shared input buffer: 8-byte header (ready flag + byte length) then UTF-8 line
// data. 64 KiB comfortably holds a line of player input.
const INPUT_BUFFER_BYTES = 64 * 1024;
const INPUT_DATA_OFFSET = 8;

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

    return new Promise((resolve, reject) => {
        const worker = new Worker(workerPath, {
            workerData: { generatedPath: path.resolve(generatedPath), inputBuffer },
        });

        worker.on("message", (msg) => {
            if (msg.type === "print") {
                out.write(`${msg.value}\n`);
            } else if (msg.type === "log") {
                err.write(`${msg.value}\n`);
            } else if (msg.type === "readline") {
                const bytes = encoder.encode(readStdinLine());
                const len = Math.min(bytes.length, dataCapacity);
                data.set(bytes.subarray(0, len), 0);
                Atomics.store(ctrl, 1, len);
                Atomics.store(ctrl, 0, 1);
                Atomics.notify(ctrl, 0);
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
