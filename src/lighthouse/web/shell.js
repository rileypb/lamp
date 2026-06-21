// Browser host shell (main thread).
//
// The browser counterpart of the stdio host (src/lamplighter/sandbox/host.js).
// It spawns the bundled game worker, hands it the shared input buffer via an
// `init` message, relays the worker's channels to the page, and services input
// requests by capturing one line from the player and filling the shared buffer.
//
// The host never blocks: the worker blocks on `Atomics.wait` for input while the
// main thread stays responsive and resolves the request asynchronously when the
// player submits. The host contains no game logic. See devdocs/sandbox.md.

(function () {
    "use strict";

    // Shared input buffer, byte-for-byte identical to the stdio host: 8-byte
    // header (ctrl[0] ready flag, ctrl[1] byte length) then UTF-8 line data.
    const INPUT_BUFFER_BYTES = 64 * 1024;
    const INPUT_DATA_OFFSET = 8;
    // Save transport buffer (host→worker replies): sized for whole save blobs.
    const SAVE_BUFFER_BYTES = 4 * 1024 * 1024;
    // localStorage key prefix; the runtime already namespaces the key by game.
    const SAVE_KEY_PREFIX = "lamp:save:";
    const WORKER_URL = "./game.worker.js";

    const transcript = document.getElementById("transcript");
    const inputLine = document.getElementById("input-line");

    const encoder = new TextEncoder();

    // The input element is the permanent tail of the transcript; all output is
    // inserted before it so the input always sits inline after the last output.
    // Output renders as text nodes only — never innerHTML — even though the text
    // is the author's own. Defense in depth, per the sandbox output channel rule.
    function appendText(value) {
        transcript.insertBefore(document.createTextNode(value), inputLine);
        scrollToBottom();
    }

    function appendClassed(value, className) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = value;
        transcript.insertBefore(span, inputLine);
        scrollToBottom();
    }

    function scrollToBottom() {
        transcript.scrollTop = transcript.scrollHeight;
    }

    // Cross-origin isolation is required for SharedArrayBuffer. Without it (no
    // service worker yet, or a host that strips the headers) there is no
    // synchronous input channel, so refuse to start rather than fail obscurely.
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        appendClassed(
            "This page is not cross-origin isolated, so the game cannot run. " +
                "Serve it with COOP/COEP headers (the bundled service worker " +
                "provides these once installed).\n",
            "shell-error"
        );
        return;
    }

    const inputBuffer = new SharedArrayBuffer(INPUT_BUFFER_BYTES);
    const ctrl = new Int32Array(inputBuffer, 0, 2);
    const data = new Uint8Array(inputBuffer, INPUT_DATA_OFFSET);
    const dataCapacity = INPUT_BUFFER_BYTES - INPUT_DATA_OFFSET;

    // At most one input request is outstanding at a time (the worker blocks until
    // it is satisfied). `awaitingInput` gates the submit handler so stray keypresses
    // before a request are ignored.
    let awaitingInput = false;

    function requestInput() {
        awaitingInput = true;
        inputLine.disabled = false;
        inputLine.focus();
    }

    function deliverLine(line) {
        const bytes = encoder.encode(line);
        const len = Math.min(bytes.length, dataCapacity);
        data.set(bytes.subarray(0, len), 0);
        Atomics.store(ctrl, 1, len);
        Atomics.store(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
    }

    // Save storage: a second shared buffer for the worker's brokered save/restore.
    // localStorage is synchronous, so a request is satisfied inline and the worker
    // (blocked on Atomics.wait) is released immediately. A length of -1 is the
    // "no such save" sentinel; the blob is opaque (obfuscated by the runtime).
    const saveBuffer = new SharedArrayBuffer(SAVE_BUFFER_BYTES);
    const sctrl = new Int32Array(saveBuffer, 0, 2);
    const sdata = new Uint8Array(saveBuffer, INPUT_DATA_OFFSET);
    const saveCapacity = SAVE_BUFFER_BYTES - INPUT_DATA_OFFSET;

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

    const worker = new Worker(WORKER_URL);

    worker.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg) return;
        switch (msg.type) {
            case "print":
                appendText(`${msg.value}\n`);
                break;
            case "write":
                appendText(msg.value);
                break;
            case "log":
                console.log(msg.value);
                break;
            case "readline":
                requestInput();
                break;
            case "prompt_readline":
                appendClassed(msg.prompt, "prompt-text");
                requestInput();
                break;
            case "save_write":
                try {
                    localStorage.setItem(SAVE_KEY_PREFIX + msg.key, msg.data);
                    replySave("ok");
                } catch (e) {
                    replySave(`error: ${e && e.message ? e.message : "save failed"}`);
                }
                break;
            case "save_read":
                replySave(localStorage.getItem(SAVE_KEY_PREFIX + msg.key));
                break;
            case "done":
                endGame(null);
                break;
            case "error":
                endGame(msg.message);
                break;
            default:
                break;
        }
    });

    worker.addEventListener("error", (event) => {
        endGame(event.message || "worker error");
    });

    inputLine.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!awaitingInput) return;
        const line = inputLine.value;
        awaitingInput = false;
        inputLine.value = "";
        inputLine.disabled = true;
        // Echo the player's command onto the prompt line, then a newline, as a
        // parser game records the typed command above its response.
        appendClassed(`${line}\n`, "player-echo");
        deliverLine(line);
    });

    // Clicking anywhere in the transcript focuses the input while it is awaited,
    // so the player does not have to aim for the inline field.
    transcript.addEventListener("click", () => {
        if (awaitingInput && window.getSelection().isCollapsed) inputLine.focus();
    });

    function endGame(errorMessage) {
        awaitingInput = false;
        inputLine.disabled = true;
        if (errorMessage) {
            appendClassed(`\n[error: ${errorMessage}]\n`, "shell-error");
        } else {
            appendClassed("\n[The game has ended.]\n", "shell-notice");
        }
    }

    // Hand the worker the shared buffers; the bootstrap starts the game on receipt.
    worker.postMessage({ type: "init", inputBuffer, saveBuffer });
})();
