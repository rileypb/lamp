// Game-worker bootstrap (dev/CLI adapter).
//
// Runs a compiled game inside a worker_threads worker, in a restricted vm
// context that withholds host capabilities (require of anything but the runtime,
// process, Buffer, network, timers). The trusted Lamplighter runtime lives in
// this module's scope and is injected into the context as the controlled API
// surface; author code (compiled game + inlined native JS) can reach only what
// the runtime exposes. See devdocs/sandbox.md.

const { parentPort, workerData } = require("worker_threads");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const lamplighter = require("../index.js");

// Synchronous input over shared memory: post a request, block on Atomics.wait
// until the host fills the buffer, then decode the line. ctrl[0] is the ready
// flag (0 pending, 1 ready); ctrl[1] is the byte length; bytes follow at offset
// 8. The game thread may block here because it is a worker, not the main thread.
function installInputChannel(inputBuffer) {
    if (!inputBuffer) return;
    const ctrl = new Int32Array(inputBuffer, 0, 2);
    const data = new Uint8Array(inputBuffer, 8);
    const decoder = new TextDecoder();

    function blockForLine() {
        Atomics.wait(ctrl, 0, 0);
        const len = Atomics.load(ctrl, 1);
        const copy = new Uint8Array(len);
        copy.set(data.subarray(0, len));
        return decoder.decode(copy);
    }

    lamplighter.setInputChannel(() => {
        Atomics.store(ctrl, 0, 0);
        parentPort.postMessage({ type: "readline" });
        return blockForLine();
    });

    lamplighter.setPromptChannel((prompt) => {
        Atomics.store(ctrl, 0, 0);
        parentPort.postMessage({ type: "prompt_readline", prompt });
        return blockForLine();
    });
}

// Save storage is a brokered capability like input: the sandboxed game cannot
// touch the filesystem, so it posts a request and blocks on a dedicated buffer
// for the host's reply. Outbound data rides the message (any size); the reply
// (a write status, or read contents) rides the buffer. A length of -1 is the
// "no such save" sentinel. See devdocs/sandbox.md / devdocs/state.md.
function installSaveChannel(saveBuffer) {
    if (!saveBuffer) return;
    const ctrl = new Int32Array(saveBuffer, 0, 2);
    const data = new Uint8Array(saveBuffer, 8);
    const decoder = new TextDecoder();

    function blockForReply() {
        Atomics.wait(ctrl, 0, 0);
        const len = Atomics.load(ctrl, 1);
        if (len < 0) return null;
        const copy = new Uint8Array(len);
        copy.set(data.subarray(0, len));
        return decoder.decode(copy);
    }

    lamplighter.setSaveChannel({
        write(key, text) {
            Atomics.store(ctrl, 0, 0);
            parentPort.postMessage({ type: "save_write", key, data: text });
            const status = blockForReply();
            if (status !== "ok") throw new Error(status || "save failed");
        },
        read(key) {
            Atomics.store(ctrl, 0, 0);
            parentPort.postMessage({ type: "save_read", key });
            return blockForReply();
        },
    });
}

function main() {
    const { generatedPath } = workerData;
    const code = fs.readFileSync(generatedPath, "utf8");

    lamplighter.setPrint((value) => parentPort.postMessage({ type: "print", value: String(value) }));
    lamplighter.setWrite((value) => parentPort.postMessage({ type: "write", value: String(value) }));

    installInputChannel(workerData.inputBuffer);
    installSaveChannel(workerData.saveBuffer);

    const sandboxRequire = (id) => {
        throw new Error(`module '${id}' is not available in the game sandbox`);
    };

    const bridgedConsole = {
        log: (...args) => parentPort.postMessage({ type: "log", value: args.map(String).join(" ") }),
        error: (...args) => parentPort.postMessage({ type: "log", value: args.map(String).join(" ") }),
    };

    const context = {
        // The trusted runtime is the game's only API surface; author code (compiled
        // game + inlined native JS) references it as a free global.
        lamplighter,
        require: sandboxRequire,
        console: bridgedConsole,
        // Explicitly withheld host capabilities. A fresh vm context lacks these
        // already; naming them documents the denied surface and guards against
        // future host globals leaking in.
        process: undefined,
        Buffer: undefined,
        fetch: undefined,
        setTimeout: undefined,
        setInterval: undefined,
    };
    vm.createContext(context);

    try {
        vm.runInContext(code, context, { filename: path.basename(generatedPath) });
        parentPort.postMessage({ type: "done" });
    } catch (err) {
        parentPort.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
}

main();
