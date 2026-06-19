// String codec shared by Lantern (encode, build time) and Lamplighter (decode,
// runtime). Its only purpose is to make player-facing prose inconvenient for a
// casual reader to lift from a shipped bundle — NOT a security mechanism: the
// key and the decoder ship together, so it is trivially reversible by anyone who
// looks. See devdocs/lighthouse.md.
//
// Uses only globals available in every environment a game runs in — Node (build
// + dev worker) and the browser Worker: TextEncoder/TextDecoder, atob/btoa, and
// Uint8Array. Deliberately avoids Buffer, which the game sandbox withholds.

// Fixed XOR key. Scrambles the bytes so the base64 does not decode straight to
// readable text; reversible by design.
const KEY = [0x4c, 0x61, 0x6d, 0x70];

function xorBytes(bytes) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
        out[i] = bytes[i] ^ KEY[i % KEY.length];
    }
    return out;
}

function bytesToBinary(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return binary;
}

function binaryToBytes(binary) {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function encode(text) {
    const scrambled = xorBytes(new TextEncoder().encode(text));
    return btoa(bytesToBinary(scrambled));
}

function decode(encoded) {
    const scrambled = binaryToBytes(atob(encoded));
    return new TextDecoder().decode(xorBytes(scrambled));
}

module.exports = { encode, decode };
