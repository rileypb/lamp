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
    const WORKER_URL = "./game.worker.js";

    const transcript = document.getElementById("transcript");
    const form = document.getElementById("input-form");
    const inputLine = document.getElementById("input-line");

    const encoder = new TextEncoder();

    // Output renders as text nodes only — never innerHTML — even though the text
    // is the author's own. Defense in depth, per the sandbox output channel rule.
    function appendText(value) {
        transcript.appendChild(document.createTextNode(value));
        scrollToBottom();
    }

    function appendClassed(value, className) {
        const span = document.createElement("span");
        span.className = className;
        span.textContent = value;
        transcript.appendChild(span);
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
                appendText(msg.prompt);
                requestInput();
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

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!awaitingInput) return;
        const line = inputLine.value;
        awaitingInput = false;
        inputLine.value = "";
        inputLine.disabled = true;
        // Echo the player's command into the transcript, as a parser game shows
        // the typed line above its response.
        appendClassed(`${line}\n`, "player-echo");
        deliverLine(line);
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

    // Hand the worker the shared buffer; the bootstrap starts the game on receipt.
    worker.postMessage({ type: "init", inputBuffer });
})();
