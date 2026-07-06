// Headless end-to-end driver for a Lighthouse web bundle.
//
// Hosts game.worker.js in a Node worker_thread behind a `self` shim and plays the
// shell's side of the wire protocol (devdocs/sandbox.md): fills the SharedArrayBuffer
// input channel on readline/prompt_readline, services save_write/save_read/save_list
// from an in-memory store, answers the save/restore modal prompts (save_prompt →
// a fixed slot name, restore_prompt → the first stored blob), and accumulates
// transcript_* chunks. Node has everything the bundle needs (SharedArrayBuffer,
// Atomics, TextDecoder), so no browser is required; only shell.js's own DOM behavior
// stays outside this harness's reach.
//
// driveBundle(bundleDir, commands) resolves { output, saves, transcripts } once the
// worker posts "done", and rejects on a worker error, a timeout, or the scripted
// commands running dry (a deterministic script must end with quit).

const path = require("path");
const { Worker } = require("worker_threads");

// Runs inside the worker_thread: a minimal browser-Worker `self` for the bundle,
// bridging postMessage/addEventListener to the thread's parentPort.
const WORKER_SHIM = `
const { parentPort, workerData } = require("worker_threads");
const listeners = [];
globalThis.self = {
    addEventListener(type, fn) { if (type === "message") listeners.push(fn); },
    postMessage(msg) { parentPort.postMessage(msg); },
};
parentPort.on("message", (msg) => {
    for (const fn of listeners) fn({ data: msg });
});
require(workerData.bundlePath);
`;

const CTRL_BYTES = 8;

function driveBundle(bundleDir, commands, {
    timeoutMs = 30000,
    saveSlotName = "e2e",
    capabilities = { windows: { docks: ["top", "bottom", "left", "right"] } },
} = {}) {
    return new Promise((resolve, reject) => {
        const inputBuffer = new SharedArrayBuffer(CTRL_BYTES + 4096);
        const saveBuffer = new SharedArrayBuffer(CTRL_BYTES + 1024 * 1024);
        const inCtrl = new Int32Array(inputBuffer, 0, 2);
        const inData = new Uint8Array(inputBuffer, CTRL_BYTES);
        const saveCtrl = new Int32Array(saveBuffer, 0, 2);
        const saveData = new Uint8Array(saveBuffer, CTRL_BYTES);
        const encoder = new TextEncoder();

        const saves = new Map();
        const transcripts = new Map();
        const windowMessages = [];
        let openTranscript = null;
        let output = "";
        const queue = [...commands];

        const worker = new Worker(WORKER_SHIM, {
            eval: true,
            workerData: { bundlePath: path.resolve(bundleDir, "game.worker.js") },
        });

        const timer = setTimeout(() => {
            fail(new Error(`bundle drive timed out after ${timeoutMs}ms; output so far:\n${output}`));
        }, timeoutMs);

        function finish(fn, value) {
            clearTimeout(timer);
            worker.terminate().then(() => fn(value));
        }
        function fail(err) {
            finish(reject, err);
        }

        function replyInput(line) {
            const bytes = encoder.encode(line);
            inData.set(bytes, 0);
            Atomics.store(inCtrl, 1, bytes.length);
            Atomics.store(inCtrl, 0, 1);
            Atomics.notify(inCtrl, 0);
        }

        function replySave(text) {
            if (text == null) {
                Atomics.store(saveCtrl, 1, -1);
            } else {
                const bytes = encoder.encode(text);
                saveData.set(bytes, 0);
                Atomics.store(saveCtrl, 1, bytes.length);
            }
            Atomics.store(saveCtrl, 0, 1);
            Atomics.notify(saveCtrl, 0);
        }

        worker.on("message", (msg) => {
            switch (msg.type) {
                case "write":
                    output += msg.value;
                    break;
                case "status":
                case "log":
                    break;
                case "window_set":
                case "window_update":
                    windowMessages.push(msg);
                    break;
                case "readline":
                case "prompt_readline": {
                    if (msg.type === "prompt_readline") output += msg.prompt;
                    if (queue.length === 0) {
                        fail(new Error(`script ran dry (game asked for more input); output so far:\n${output}`));
                        return;
                    }
                    const line = queue.shift();
                    output += `${line}\n`;
                    replyInput(line);
                    break;
                }
                case "save_write":
                    saves.set(msg.key, msg.data);
                    replySave("ok");
                    break;
                case "save_read":
                    replySave(saves.has(msg.key) ? saves.get(msg.key) : null);
                    break;
                case "save_list":
                    replySave(JSON.stringify([...saves.keys()].filter((k) => k.startsWith(msg.prefix || ""))));
                    break;
                case "save_prompt":
                    replySave(JSON.stringify({ name: saveSlotName }));
                    break;
                case "restore_prompt": {
                    const first = [...saves.values()][0];
                    replySave(first != null ? first : null);
                    break;
                }
                case "transcript_start":
                    openTranscript = msg.key;
                    transcripts.set(msg.key, "");
                    replySave("ok");
                    break;
                case "transcript_write":
                    if (openTranscript !== null) {
                        transcripts.set(openTranscript, transcripts.get(openTranscript) + msg.data);
                    }
                    break;
                case "transcript_stop":
                    openTranscript = null;
                    break;
                case "done":
                    finish(resolve, { output, saves, transcripts, windowMessages });
                    break;
                case "error":
                    fail(new Error(`worker error: ${msg.message}; output so far:\n${output}`));
                    break;
                default:
                    break;
            }
        });

        worker.on("error", fail);

        // Capabilities ride init exactly as the real shell sends them; the default
        // is the web shell's four-dock set, overridable to simulate other hosts
        // (e.g. the TUI's top/bottom-only set).
        worker.postMessage({ type: "init", inputBuffer, saveBuffer, capabilities });
    });
}

module.exports = { driveBundle };
