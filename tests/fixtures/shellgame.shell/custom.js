// The fixture's custom layer (devdocs/custom-shells.md): registers a handler on
// the LampShell hook surface. Its presence makes Lighthouse inject the script
// tag, which is what turns capabilities.shell on. The handler's DOM behavior is
// a manual-pass concern, like the rest of shell.js.
LampShell.on("sound", function (payload) {
    console.log("sound cue:", payload);
});
