#!/usr/bin/env node
// Unit tests for the custom-shell event channel (devdocs/custom-shells.md):
// shellSend's plain-string encoding, the drop-without-a-channel contract, and
// the shellAvailable capability query. The host side (LampShell, tag injection,
// the shell directory packaging) is covered by the lighthouse e2e.
// Run with: npm run test:shell

const assert = require("assert");
const lamp = require("../../src/lamplighter");

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(`  ${err.stack || err.message}`);
    }
}

lamp.bootstrapBuiltins();

let events = [];
function installChannel() {
    events = [];
    lamp.setShellChannel((msg) => events.push(msg));
}

test("shellSend emits shell_event with plain strings (styles stripped)", () => {
    installChannel();
    lamp.shellSend("sound", lamp.styled("bold", "sting"));
    lamp.shellSend(lamp.styled("italic", "theme"), "noir");
    assert.deepStrictEqual(events, [
        { type: "shell_event", name: "sound", payload: "sting" },
        { type: "shell_event", name: "theme", payload: "noir" },
    ]);
});

test("no channel: shellSend drops silently", () => {
    lamp.setShellChannel(null);
    assert.doesNotThrow(() => lamp.shellSend("sound", "sting"));
    installChannel();
    assert.deepStrictEqual(events, [], "nothing buffered from the channel-less send");
});

test("shellAvailable reads the capability; absent means false", () => {
    lamp.setHostCapabilities(null);
    assert.strictEqual(lamp.shellAvailable(), false);
    lamp.setHostCapabilities({ windows: { docks: ["top"] } });
    assert.strictEqual(lamp.shellAvailable(), false, "a windows-only host has no custom layer");
    lamp.setHostCapabilities({ shell: true });
    assert.strictEqual(lamp.shellAvailable(), true);
    lamp.setHostCapabilities({ shell: false });
    assert.strictEqual(lamp.shellAvailable(), false, "the stock web shell declares shell: false");
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll shell tests passed.");
