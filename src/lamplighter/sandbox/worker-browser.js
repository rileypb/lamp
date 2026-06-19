// Game-worker bootstrap (browser `Worker` adapter).
//
// The browser analogue of `worker.js`. A browser `Worker` is already a DOM-less,
// origin-isolated context, so it *is* the restricted context that the dev path
// builds with `vm.runInContext` — there is no `vm`, `fs`, `worker_threads`, or
// `require` to withhold. This bootstrap therefore only has to: strip the
// network/code-loading globals the browser does grant a worker, drive the same
// Lamplighter transport seam the stdio host drives (`setPrint`/`setWrite`/
// `setInputChannel`/`setPromptChannel`), and hand author code the same
// throwing `require` shim and bridged `console` it gets in dev.
//
// Lamplighter owns this file; Lighthouse only packages it (esbuild bundles this
// module + the runtime + the wrapped game into one worker script). See
// devdocs/sandbox.md and devdocs/lighthouse.md.

const lamplighter = require("../index.js");

// Strip the network and code-loading globals a browser grants a worker, before
// any author code runs. This is the browser equivalent of the dev context
// withholding `require`/`fs`/`fetch`. Mirrors the set named in devdocs/sandbox.md
// ("fetch, XMLHttpRequest, WebSocket, importScripts, and their equivalents") and
// is the single place to extend that denied surface.
const NETWORK_GLOBALS = ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "EventSource"];
for (const name of NETWORK_GLOBALS) {
    try {
        Object.defineProperty(self, name, { value: undefined, configurable: true, writable: true });
    } catch (_err) {
        // A non-configurable global cannot be redefined; leave it and rely on the
        // worker's own origin isolation. Nothing here should depend on the strip
        // succeeding for correctness, only for defense in depth.
    }
}

// Author code (compiled game + inlined native JS) may reference `require` as a
// free name. In the worker it resolves to this shim, which denies every module —
// the runtime is injected directly, not required. Matches `sandboxRequire` in
// worker.js.
function sandboxRequire(id) {
    throw new Error(`module '${id}' is not available in the game sandbox`);
}

// Console output is not a host capability; bridge it to the host as `log`
// messages so it surfaces without granting the worker the real console.
const bridgedConsole = {
    log: (...args) => self.postMessage({ type: "log", value: args.map(String).join(" ") }),
    error: (...args) => self.postMessage({ type: "log", value: args.map(String).join(" ") }),
};

// Synchronous input over shared memory, identical layout to worker.js: ctrl[0]
// is the ready flag (0 pending, 1 ready), ctrl[1] is the byte length, UTF-8 bytes
// follow at offset 8. The game thread blocks here with `Atomics.wait` because it
// is a worker; the host (main thread) stays responsive, obtains the line
// asynchronously, fills the buffer, and notifies.
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
        self.postMessage({ type: "readline" });
        return blockForLine();
    });

    lamplighter.setPromptChannel((prompt) => {
        Atomics.store(ctrl, 0, 0);
        self.postMessage({ type: "prompt_readline", prompt });
        return blockForLine();
    });
}

// The build step (Lighthouse) wraps the body-only game module as a factory
// `(lamplighter, require, console) => { <game body> }` and passes it here. We run
// it with the controlled trio, mirroring the free globals the dev `vm` context
// supplies. The game starts only after the host's `init` message delivers the
// shared input buffer, so input is ready before the parser loop can block on it.
let gameFactory = null;
let pendingInputBuffer = null;
let started = false;

function startIfReady() {
    if (started || !gameFactory || pendingInputBuffer === null) return;
    started = true;

    lamplighter.setPrint((value) => self.postMessage({ type: "print", value: String(value) }));
    lamplighter.setWrite((value) => self.postMessage({ type: "write", value: String(value) }));
    installInputChannel(pendingInputBuffer);

    try {
        gameFactory(lamplighter, sandboxRequire, bridgedConsole);
        self.postMessage({ type: "done" });
    } catch (err) {
        self.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
    }
}

self.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "init") {
        // No SharedArrayBuffer means the page is not cross-origin isolated; fail
        // loudly rather than silently losing synchronous input.
        if (!(msg.inputBuffer instanceof SharedArrayBuffer)) {
            self.postMessage({
                type: "error",
                message: "no SharedArrayBuffer: the page must be cross-origin isolated (COOP/COEP)",
            });
            return;
        }
        pendingInputBuffer = msg.inputBuffer;
        startIfReady();
    }
});

// Entry point the bundled game registers itself through.
function runGame(factory) {
    gameFactory = factory;
    startIfReady();
}

module.exports = { runGame };
