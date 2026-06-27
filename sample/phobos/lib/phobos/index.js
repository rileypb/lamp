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

// --- Linguistic Module: progressive translation (ported from Siriusian.i7x) ------
// A textual thing's `content` is rendered word by word. Each word has a difficulty
// tier; a word translates to English once its tier has been scanned (its tier is in
// the SiriusianLevels list), otherwise it shows as Siriusian glyphs. With nothing
// scanned the whole text is alien — exactly the all-untranslated form siriusian()
// already produces. Scanning (a later slice) is the only thing that adds tiers.

function is_textual(x) {
    return !!(x && x.textual);
}

// The difficulty tier of a content word (Siriusian.i7x "the difficulty of"). The
// !/$/# prefixes mark proper-noun and control tiers (15/16/20) that fall outside the
// 1-5 scan range; every other word hashes to a 1-5 tier by the sum of its lowercased
// character codes, mod 5.
function token_difficulty(word) {
    const c0 = word.charAt(0);
    if (c0 === "!") return 15;
    if (c0 === "$") return 16;
    if (c0 === "#") return 20;
    let sum = 0;
    const s = word.toLowerCase();
    for (let i = 0; i < s.length; i += 1) sum += s.charCodeAt(i);
    return (sum % 5) + 1;
}

// Render `x.content` through the translation filter at the current scan state
// (English words bold, untranslated runs in fixed-width Siriusian). `/` tokens are
// paragraph breaks; `*`-prefixed tokens are literal. Mirrors "print translated form
// of (T - a thing)" — Siriusian words run together (no separating spaces), English
// words are spaced, and `lastSiriusian` inserts the space when the stream switches
// from a glyph run back to English. Emitted via write() (no per-sentence auto-break),
// so only the `/` markers break the prose into paragraphs.
function print_translated(x, levels) {
    const tokens = String((x && x.content) || "").split(/\s+/).filter((w) => w.length > 0);
    const scanned = lamplighter.listItems(levels).map(Number);
    const numLevels = scanned.length;
    const len = tokens.length;
    let out = "";
    let lastSiriusian = false;
    for (let i = 0; i < len; i += 1) {
        const w = tokens[i];
        if (w === "/") {
            out += lamplighter.outputMarker("par");
            lastSiriusian = false;
            continue;
        }
        if (w.charAt(0) === "*") {
            out += lamplighter.styled("fixed", w.slice(1));
            continue;
        }
        const cdl = token_difficulty(w);
        const glyph = siriusian_word(w);
        if (cdl === 15) {
            out += lamplighter.styled("fixed", "<" + glyph + ">");
            lastSiriusian = true;
        } else if (cdl === 16 || (cdl === 20 && numLevels < 5)) {
            out += lamplighter.styled("fixed", glyph);
            lastSiriusian = true;
        } else if (scanned.includes(cdl) || cdl === 20) {
            const englishWord = w.charAt(0) === "#" ? w.slice(1) : w;
            if (lastSiriusian) out += " ";
            out += lamplighter.styled("bold", englishWord);
            if (i !== len - 1) out += " ";
            lastSiriusian = false;
        } else {
            out += lamplighter.styled("fixed", glyph);
            lastSiriusian = true;
        }
    }
    lamplighter.write(out);
    lamplighter.write(lamplighter.outputMarker("line"));
}
