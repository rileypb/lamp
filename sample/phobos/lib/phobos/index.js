// Siriusian glyph cipher, ported from Phobos's Siriusian.i7x ("Siriusian version
// of"). Deterministic from the English text and deliberately NON-invertible: two
// independent lossy steps — (1) only digits, even-position chars, and the last
// char survive; (2) the glyph table is many-to-one — so the English can't be
// recovered from the glyphs (the game stores the original separately). This
// renders the fully-untranslated form; the Linguistic Module's progressive,
// per-word, scan-level reveal is a separate later feature (KIM). Verified against
// the in-game door label: siriusian("This way to the secret base") === "ſĺĺļĿŀĹıŧĹŁĽ".

// Substitution table for ordinals 97..122 (a..z), index = ordinal - 97. a..t cycle
// through the same ten glyphs twice; u..z are unique. (From the Table of Siriusian
// Substitutions.)
const SIRIUSIAN_GLYPHS = "ĹĺĻļĽľĿŀŁłĹĺĻļĽľĿŀŁłЃΐſŧīı";

function siriusian_word(word) {
    const s = String(word).toLowerCase();
    const len = s.length;
    const kept = [];
    for (let c = 1; c <= len; c++) {
        const ord = s.charCodeAt(c - 1);
        if (ord >= 48 && ord <= 57) kept.push(ord);          // digits always kept
        else if (c % 2 === 0 || c === len) kept.push(ord);   // even positions + last char
    }
    const shifted = [];
    for (const n0 of kept) {
        let n = n0;
        if (n > 57 && n < 190) n = n + len;                  // Caesar shift by length
        while (n > 122) n -= 26;
        while (n < 97) n += 26;
        shifted.unshift(n);                                  // prepend → reverse order
    }
    let out = "";
    for (const n of shifted) {
        if (n >= 97 && n <= 122) out += SIRIUSIAN_GLYPHS[n - 97];
    }
    return out;
}

// Render an English phrase as untranslated Siriusian: cipher each whitespace-
// separated word and concatenate (no separators — the all-untranslated form).
function siriusian(text) {
    return String(text).split(/\s+/).filter((w) => w.length > 0).map(siriusian_word).join("");
}
