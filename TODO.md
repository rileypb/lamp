# TODO

Top recommended next steps, grouped by status and roughly in priority order
within each group. Each item notes *why*, *where*, and what it's *blocked by*.
Sourced from the staged roadmaps and prerequisite lists in
`devdocs/game_parser.md`, `devdocs/rulebooks.md`, and `devdocs/relations.md`.

> The 2026-06-19/20 architecture review (issues A–G) is **fully resolved** — see
> `devdocs/architecture.md` → "Known Architectural Issues" for the per-issue
> record. The only optional remnant is item 6 below.

> Feature backlog awaiting triage: `lurking_todo.md` catalogs candidate verbs,
> grammar, world-model traits, turn-cycle/daemon, and message ideas mined from
> `lurkinghorror.txt`. Text substitution (Slices 1–7) is **all DONE**; the full
> per-slice record lives in `devdocs/text.md`.

## Active

### Code review 2026-07-01 — triage `REVIEW.md`
A full design review of `src/` + `lib/` is recorded in `REVIEW.md` (layering,
duplication, JS→Lamp opportunities, missing features). Top items to act on, in
its suggested order:
1. ~~**[H] Thread the actor into `resolveCandidates`**~~ **DONE (2026-07-01):**
   "me"/"myself" now resolve to the commanding actor passed through
   `resolveSlots(instance.actor)`, not `getGlobal("player")`, closing the
   world-model-contract violation and the latent NPC-actor bug (REVIEW §1.1).
   `selfword1` byte-invariant; new regression golden `selfword2` (an action runs
   `run_command("x me", robot)` → the robot's "me" is the robot, not the player).
2. ~~**[H] Align the `text` primitive sets**~~ **DONE (2026-07-01):** the emitter's
   `PRIMITIVE_TYPES` now includes `text` (a plain string in a `text` field/param
   was misread as an object reference → spurious "unknown object" compile error —
   reproduced before fixing), and runtime `PRIMITIVE_ZEROS` gives `text` the `""`
   zero, so an unset text field prints empty, not `undefined`. specs.md
   "Unset field values" updated. Regression golden `textfield1`; suite
   byte-invariant (REVIEW §4.3b).
3. ~~**[H] Parser prose below the locale layer**~~ **DONE (2026-07-01):** added a
   locale-owned `setParserLanguage` seam (mirroring `setListFormatter`) covering the
   noun-phrase vocabulary (articles/pronouns/self-words) and the two prose renderers
   (disambiguation prompt, unbound-pronoun message). The runtime keeps only neutral
   fallbacks; `lib/en-US` installs the English set (byte-invariant — `disambigproper1`/
   `advent5`/`parser_it` unchanged), `lib/fr-FR` installs French (articles so
   "le manteau" strips; French prompt). This also sidesteps the interpolable-message
   problem the "route through message()" idea hit — the renderer takes the runtime
   value as an argument. Golden `frparser1`; i18n.md/game_parser.md updated (REVIEW §1.2).
4. ~~Checker hardening (REVIEW §4.3a/c)~~ **DONE (2026-07-01):** a call to an
   undefined name (not a declared function/native, rulebook, `pick`, or a
   `function`-typed local) is now a compile error instead of a runtime
   ReferenceError (`isKnownCallable`, used by `checkCallStatement` and
   `checkExprCalls`). And `checkExprCalls` now recurses generically into every
   child expression (replacing the hand-kept key list), so a call nested in a
   member-access object, a list element, or a text substitution is validated too.
   Goldens `call_undefined` (§4.3a) + `call_nested_arity` (§4.3c); whole suite
   (incl. phobos) byte-invariant, proving no undeclared-native calls existed.
   Minor pre-existing caveat surfaced: a checker error on a call *inside a `[...]`
   substitution* reports line 1 (the substitution is re-tokenized as its own
   source) — a diagnostics-location bug tracked with item 4 below, not fixed here.
5. JS→Lamp:
   - ~~port `wire_parts` to Lamp~~ **DONE (2026-07-02):** `wire_parts` is now a pure
     Lamp function in `lib/advent/parts.lamp` (`for p in physical.all: for w in
     part_of p ?all: contains w p`), the native deleted from `lib/advent/index.js`.
     `parts1` + the full phobos game byte-invariant (REVIEW §3.1).
   - ~~list append (§4.1a)~~ **DONE (2026-07-02):** `append(list, item)` sys native
     (in place, like `shuffle`; durable across undo/save). With `map_strings` + a
     `for` loop this makes filter/collect plain Lamp — so `contents_of`/
     `listable_contents`/`describe_supporters` (which filter `item.all` by
     `holder`/`.scenery`) are now portable off JS. Golden `append1`; specs.md updated.
   - ~~an `x is TYPE` membership test (§4.1b)~~ **DONE (2026-07-02):** `is` is now a
     keyword infix operator (`EXPR is TYPE` → bool, `isTypeOrSubtype`; null-guarded via
     runtime `isType`). The type name is validated at compile time (typo → error, like
     an undefined call). `is_container` is ported off JS to `return x is container`
     (native deleted). Goldens `is1` (hierarchy/none/if/not) + `is_unknown_type`
     (compile error); specs.md documents the operator/precedence/reserved word.
   - ~~port the remaining `lib/advent/index.js` list helpers~~ **DONE (2026-07-02):**
     `contents_of`, `listable_contents`, and `describe_supporters` are now pure Lamp in
     `rooms.lamp` (using `item.all` + `holder` + `append` + `is`), the three natives
     deleted. `supporter_phrase` is promoted to a declared locale native (en-US + fr-FR
     `functions.lamp`, following `contained_phrase`) so the now-Lamp `describe_supporters`
     can call it. Suite byte-invariant (`nestlist1`/`frnested1`/`openclose1`/phobos).
     `lib/advent/index.js` now holds only genuinely-native code (containment seam
     `holder`, door/part wiring, scope providers, debug introspection).
   - ~~the `holder` native-vs-Lamp decision (§3.2)~~ **DONE (2026-07-02): moved to Lamp.**
     `holder` is now `function physical holder(physical x): return contains ?only x` in
     rooms.lamp (return type corrected `container`→`physical`, the relation's `place`
     type), the native wrapper deleted. The engine still uses its own `containerOf`
     internally (scopeOf/moveObject/scope providers) — only the author-facing wrapper
     moved. Suite byte-invariant. `lib/advent/index.js` now holds only irreducibly-native
     code (door/part wiring, scope providers/barrier, debug introspection).
6. ~~**[M] Lighthouse page-title metadata drift (§1.5)**~~ **DONE (2026-07-02):**
   Lighthouse no longer re-scans source with the Lantern tokenizer for the page
   title. Lantern writes a game-identity JSON sidecar (name/title/author, from the
   parsed AST) when given `--meta <path>`; Lighthouse passes it and reads it, so the
   `<title>` uses the display `title` field (was: the identifier — e.g. Phobos showed
   "Phobos", now "Phobos - A Galaxy Jones Story"). Removes Lighthouse's tokenizer
   dependency. New test `titled.lamp` in `tests/lighthouse` + existing cloak title
   test (name-fallback) both pass; plain compiles write no sidecar (flag-gated).
7. ~~**[M] `gender` vocabulary mismatch (§1.8)**~~ **DONE (2026-07-02) — reframed as
   free-text pronouns.** Rather than reconcile the enum vocabularies, dropped the gender
   enum from the pronoun path entirely: an object carries free-text `pronouns` (a preset
   key `she`/`he`/`they`/`it`, or a full custom set `subject/object/det/pron/reflexive`
   like `xe/xem/xyr/xyrs/xemself`), and en-US's `[they]`/`[we]` families + verb agreement
   read it — so any pronouns work and singular "they" takes a plural verb. Maximally
   inclusive, and the three-way mismatch is gone (no enum to disagree on). Grammatical
   gender (a noun's language property, for fr-FR le/la — legitimately closed) is split
   into a separate `grammatical_gender` field that only gendered locales read. New golden
   `pronouns1` (she / singular-they / neopronoun); `showme1` re-baselined (renamed fields);
   206 others byte-invariant. **Scope-2 DONE (2026-07-02): fr-FR rewired to pronoun sets
   too.** A French object's `pronouns` (preset `il`/`elle`/`iel`/…, or a full custom set)
   drives il/elle/iel rendering; empty falls back to `grammatical_gender` + number, so the
   five French goldens are byte-invariant. Golden `frpronouns1` (elle / iel / custom
   neopronoun). Note: French verb/participle agreement is still not modeled (the pack's
   `conjugate` is identity), so a custom set surfaces in pronouns but not accord.
   **Remaining follow-up:** decide whether grammatical gender should be locale-owned data
   rather than an advent field (low priority). **Also flag:** `sample/phobos/web` (the
   committed deploy bundle) is now a stale
   snapshot — still self-consistent and correct, but a Phobos redeploy should
   `npm run build:phobos` to pick up the pronoun change (and the §1.5 page-title fix).
8. ~~**[M] Duplicated action-selector resolver (§2.1)**~~ **DONE (2026-07-02):** the
   identical selector set-algebra that lived in both `checker.js`
   (`resolveSelectorActions`, over `actionSchema`) and `emitter.js`
   (`resolveSelector`, over `allActionNames`) is extracted to one
   `src/lantern/selector.js` `resolveSelector(node, actionNames, tagMembers,
   makeError)`. Both passes call it with their own universe/tag maps and an error
   factory, so each keeps its diagnostic format (checker prefixes "type error:",
   emitter stays bare) but the drift-prone algebra exists once. Suite byte-invariant
   (209 tests), incl. the `selector_unknown_tag`/`selector_bad_slot` error goldens.
9. ~~**[M] Quadratic per-command scope computation (§5.1)**~~ **DONE (2026-07-02):**
   `scopeOf(actor)` was recomputed per matching grammar candidate, and each call
   scanned all `contains` edges per instance (O(instances² × edges)/command). Two
   fixes: (a) `runCommand` memoizes one `actorScope()` across candidates (sound —
   nothing mutates the world until a candidate resolves and returns; world-scope
   actions keep their own pool); (b) `scopeOf` builds a `target → container` Map once
   (`buildContainmentIndex`, exact by the `unique` invariant) and `containerOf(inst,
   index)` reads it in O(1). The index is built fresh from the edges each computation
   (no drift, no coupling to the snapshot-restore path); one-off callers keep the
   query path. Fixpoint BFS left as optional. Suite byte-invariant (209 + state/save/
   parser/lighthouse).
10. ~~**[M] QUIT/RESTART recognition split (§1.6)**~~ **DONE (2026-07-02):** QUIT, RESTART,
   and end-of-story RESTORE were recognized by `to_lower(line) == "…"` string-compares in
   `startup.lamp` — a second, un-localizable recognizer parallel to the grammar path. Now
   `quit`/`q` and `restart` are `out_of_world` grammar actions (like undo/save/restore); their
   bodies set a `session_over` global the command loop reads and unwinds on (QUIT → `run()`
   exits; RESTART arms `request_restart()`). RESTART's confirmation/availability moved into the
   action body. The end-of-story prompt uses a new `run_meta_command` primitive (out-of-world
   verbs only; in-world/unrecognized input silently ignored) so the ended game can't run
   LOOK/TAKE. The three `is_*_command` recognizers deleted. `restart1`/`endrestore1`
   byte-invariant; new golden `metaend1`. This retires the last parallel command-recognition
   mechanism — every player word now resolves through one grammar path. (Full verb localization
   for fr-FR is a separate, unbuilt feature.)
11. ~~**[L] proper/plural mechanism + [M] contract-surface doc + two [L] runtime notes**~~ **DONE
   (2026-07-02):** cleared the remaining triaged findings in one batch. **§1.7** — advent's
   proper/plural now lives in `bool proper`/`bool plural` on `physical`; the `type article`, its
   enum members, and the `article article` field are deleted, all usages migrated (phobos +
   locale fixtures), and the locales' `is_proper`/`is_plural` simplified to a plain boolean read.
   `showme1` re-baselined; else byte-invariant. **§1.3** — the runtime↔world contract block now
   enumerates the full hardcoded surface (`understand`/`private_name`/`printed_name`, `act`/`undo
   limit`, `game.name`/`author`). **§5.2** — the anonymous-relation-edge snapshot throw now has a
   clear message naming the field/global, documented in state.md (no per-edge serialization).
   **§5.3** — `formatValue` returns `String(value)` so the stream's "run is a string" invariant
   is deliberate.
12. ~~**[M] Checker doesn't validate object-body field assignments**~~ **DONE (2026-07-02):**
   `checkObjectDecl` now errors on a field the object's type never declares (was: silently
   skipped, so a typo'd field was a no-op) and on an unknown object *type* (was: also silent,
   which would otherwise make every field read as unknown). Both mirror the undefined-call/`is`
   checks (§4.3 family). The stricter check immediately caught a real dead field — `start foyer`
   on `sample/study.lamp`'s standalone `game` (lib/sys `game` has no `start`; that's advent-only,
   and study places the player via its own `holder` field) — now removed. New compile-error
   golden `unknown_field`; suite otherwise byte-invariant (211).
All triaged REVIEW findings are now resolved. Overlaps with existing
items: the type topo-sort and the bare-object-assignment emitter bug are already
tracked below; REVIEW §1.4 argues for raising the priority of the
library-contributed consistency pass (door-check follow-up B / item 7).

### Phobos 1:1 parity (drives advent/Lamp features)
Goal: a **1:1 port** of Phobos to prove out Lamp (memory `phobos-1to1-goal`). The authoritative,
tickable checklist lives in `sample/phobos/PORTING.md` → "Remaining for 1:1 parity"; work it one
item at a time. **TOUCH/FEEL DONE** (`Can't Touch This.i7x`): the advent machinery — the TOUCH/FEEL
verb (prints a thing's `feels` text or the default reply), the `feels` string +
`feelable`/`far_away`/`obstructed`/`edificial` traits on `physical`, the unfeelable/out-of-reach
refusals, and the trait-driven TAKE refusals (golden `touch1`; specs.md) — **plus the per-object
`feels` text on every ported Phobos object** (with `far_away` on Mars/Stickney Crater, `edificial`
on the ship, and a state-dependent `instead touch` for the commandos); residual feels ride with the
not-yet-ported sub-objects. **Backdrops DONE** (`Walls/Floors/Ceilings/PBR Common.i7x`): advent
gained a general `backdrop` type surfaced in scope in every room by a second scope provider (golden
`backdrop1`; specs.md), and Phobos's `lib/phobos/backdrops.lamp` adds walls/floor/ceiling with the
**per-room** descriptions from Phobos Polish.i7x (the I7 `Table of Walls/Floors/Ceilings` mirrored as
room fields read by the generic instead rules — stone/gray-tile/white-tile/rubber), an `outdoors`
room flag (the flight deck) for the no-walls / ground / open-sky wording, and the ship's `low_ceiling`
(its ceiling is touchable). Also fixed a latent locale bug (`feel` was missing from the verb vocab, so
`[feel]` didn't conjugate). **SAY/ANSWER free-text DONE** (`Guard.i7x`): lib/conversation gained a
`say` action (`say/answer [topic]`, a free-text `string` topic distinct from ASK/TELL's subject;
golden `conversation1`), used by the guard for the assert-humanity alliance (no gift) and the loyalty
yes/no window (specs.md). **Distracted→shot DONE** (`Guard.i7x`): mid-commando-fight, doing anything
but ATTACK/SHOOT gets Galaxy shot — a `before any except attack except shoot` action-selector rule
(the `before` band preempts every other rule regardless of load order), mapping Inform's "doing
something other than attacking or shooting". **Noun forms of FLY DONE** (`Base.i7x`): bare `fly`
(simply-flying) + a `fly_thing` noun action (`fly`/`drive`/`operate`/`pilot`/`launch [target]`) sharing
a `fly_the_ship()` helper — "fly/operate ship/panel" launches, the Moon Sled (now a real scenery
object) is "out of fuel", else "can't fly that". **Blowing-up-base flavour audit DONE** (`Guard.i7x`):
the guard-leading dialogue is now verbatim (was paraphrased) + the missed reactor "Hurry! Before we
are caught!" nag. Remaining parity items: custom can't-go/hit/take messages, power/action banners,
banner placement seam, the remaining examinable in-prose sub-objects (signs/poster), handprint-scanner
parts, examine-self / X ME, the bare-word SAY shortcuts (needs a command-rewrite
hook, below) and the audit passes. (**FROTZ DONE** — GJ Basics.i7x Easter egg `frotz [thing]` in
lib/phobos/frotz.lamp; three message branches + a new advent `bool lit` on `physical` that annotates
the inventory row `(providing light)`, golden `providinglight1`. `indescribable` objects intentionally
skipped — debug-style suppression, not needed for the port; the "button asides" it was bundled with
are just attack_refusal rows, already ported.) (Now ported: all `$` swear censorship; the two guard combat
scenes — arrival shoot-on-sight + powered suit-deflect, spy-death button overrides; the goofy random
PA broadcasts; the guard Interjections; and the **named third-person viewpoint** — `viewpoint_named`
global so `[We]` renders the player's name ("Galaxy can't reach that.") with later refs pronominalized,
runtime per-render flag + locale `we()`, default-false so byte-invariant; and the **custom refusals**
— advent `take_refusal`/`attack_refusal` fields + direction-aware `can't go that way`, Phobos data in
`lib/phobos/refusals.lamp`; and the **remaining in-prose scenery** — signs/poster/pods/counters/tile
(`lib/phobos/scenery.lamp`) + the PA System backdrop — which needed a new general `private_name`
engine flag (Inform "privately-named": suppress identifier tokens so a `locker_sign` object doesn't
answer to "locker"; golden `privatename1`); and the **`part_of` relation** (`lib/advent/parts.lamp`:
a part is in scope wherever its whole is, via a `wire_parts` startup native that materializes
containment; scoped the closed-container barrier to real `container` types so a closed door doesn't
hide its scanner part — golden `parts1`), used by the handprint scanners / suit light / RESET button; and the **power banner** — the POWER
figlet flashed when the Galaxy Suit spends a charge, `power_banner()` in scoring.lamp, printed by the
smash + guard-deflect paths. The unused action banner isn't ported; and the **banner placement** —
advent extracted a callable `print_banner()` + an `auto_banner` opt-out field on `game`, so Phobos
prints the title banner between its intro and the reveal, default-true so other games are invariant;
and **examine-self disguise variants** — plus a general `me`/`myself` parser self-word that resolves
to the current `player` global (follows a reassigned protagonist; golden `selfword1`), which also
fixed feel/attack/examine ME reaching the player's own text; and the **player naming split** — the
player's `printed_name` is now the full proper "Galaxy Jones" (`article proper`) for identification
(`[the player]`, disambiguation), while narration keeps the short first name via a new
`viewpoint_name` global, and a runtime fix makes disambiguation prompts honor proper-naming —
"the Galaxy Suit or Galaxy Jones?" — golden `disambigproper1`.)
Smaller: SAY/ANSWER free-text, custom can't-go/hit/take messages, power/action banners, banner
placement seam, examinable in-prose sub-objects, and a per-extension audit. **Description-fidelity
audit DONE:** diffed all 107 ported `description`s against the I7 source (normalized cipher/markup/
conditionals, cross-checked every I7 ending against the port to catch tail truncations). Fixes: the
**Galaxy Suit** (dropped "SMASH, or PUNCH" + the "neat light" note + the italic fine print), the
**KIM** (dropped the paragraph break between its two paragraphs), the **dead Siriusian guard** (was a
softer invented rewrite — restored the I7 "sprawled… oil and blood… staining the floor" + serial),
and the **Linguistic Module** (restored exact I7 wording). Everything else matched. **KIM `[KIM
state]` DONE:** examining the KIM while it's adhered mid-hack now appends the live puzzle state (which
scanner/target it's stuck to, the button-array blurb, and the keypad itself via the existing
`show_keypad_*` renderers) — an `instead examine` rule + `kim_state()` in hacking.lamp, mirroring I7's
`To say KIM state`. **Audit sweeps DONE** (Actions / Improved Pushing / GJ Basics / PBR Common /
Polish): ported the SHOOT flavour (`fire`/`at` synonyms, "can't see the point", `shoot me` → "Don't be
morbid", `shoot <door>` → "…dissipates against the door", no-firearm), a score-based **status line**
(general advent: "[score] of [max] points" when `max_score > 0`), the **remove-suit refusal**, and the
two Polish library-message overrides (`drop_not_carrying`, `parser_cant_see` → third-person, in
lib/phobos/messages.lamp); Improved Pushing / PBR Common / color-toggles / two-noun shoot-with grammar
ruled N/A or acceptable simplifications. **Final line-by-line parity pass DONE:** (1) re-themed
advent's hardcoded second-person default reports to `[We]`-adaptive — byte-identical for the default
2nd-person viewpoint, third-person for Phobos — plus `lib/phobos/messages.lamp` overrides for the
contracted ones (`take_already_carrying`/`wear_already_worn`/`doff_not_worn`); (2) feels/refusal
text-fidelity check filled the attack-refusal gaps the original port skipped (green/purple/flight
doors + green/purple scanners + walls/floor/ceiling + force field + ship + pods + sign), the
unconscious-commando refusal, and the tile's `feels`. **The Phobos 1:1 port is now feature- and
text-complete.** **KIM
location-gating DONE:** the KIM now physically adheres to its target (the
hack moves it onto the handprint scanner / the walls, out of inventory, via `adhere_kim`), so PRESS
and the state display are gated on Galaxy still being in the hack room (`kim_hack_room`); leaving the
room implicitly retrieves it ("(first taking the KIM) / Galaxy retrieves the KIM from the X", a
`before go` rule) and so does TAKE — mirroring I7's "leaving the KIM behind is impossible" / "the KIM
is enclosed by the location". Fixes the bug where `press` drove a puzzle from another room. (NOTE:
`test endgame` runs the FULL winning walkthrough, so the hack *solve* path IS golden-covered; only the
edge behaviours — pressing from another room, examining the KIM mid-hack — are verified manually.)
**Infra DONE:** golden
discovery now walks one level into subdirs, so `sample/phobos/phobos.lamp` is a golden (`test
endgame` → the full winning transcript) — the whole game is a deterministic regression check.
**Web release DONE (2026-07-01):** Phobos ships on GitHub Pages at `<pages>/phobos/` as a
**pre-built committed bundle** (`sample/phobos/web`, built with `npm run build:phobos` —
release + `--encode-strings`) that the deploy workflow copies without rebuilding, so Lamp
changes on `main` can't break the published game (unlike Cloak, which rebuilds each push as
a live Lighthouse check). To update the published Phobos: rebuild, commit the bundle. Banner
title is the full `"Phobos - A Galaxy Jones Story"` (the game `title` field). **Next:** merge
the `restart` branch to `main` to trigger the first deploy; a manual browser pass on the
Pages URL (modals, transcript download, [more] paging — the layer headless checks don't cover).

### 0. README onboarding — DONE / follow-ups
Top-level `README.md` now describes the system and how to run Lantern, the
terminal player (Lamplighter), `lantern-exe`, and a Lighthouse web build. Possible
follow-ups: document the `.lamp` language with a minimal "hello world" walkthrough;
note any required Node.js minimum version (none declared in `package.json` today);
link the README from `devdocs/`.

### 1. SAVE / RESTORE — remaining items (Slice 3)
UNDO, dev-host SAVE/RESTORE, the durable CLI save location, and browser
localStorage persistence are **done** (snapshot core + state-provider registry,
versioned save header + strict restore gate, `setSaveChannel` seam, named-slot
`save`/`restore` verbs; tests `tests/state`/`tests/save`/`tests/lighthouse`, design
in `devdocs/state.md`). A native CLI file dialog is **not** pursued (it breaks the
headless/piped/test path); the browser download/upload picker is the right home.
**Decided (2026-06-22): make save/restore UX a host seam** (parallel to
`promptLine`), not hardcoded prose and not a host takeover. Runtime keeps the
blob lifecycle (`captureSave`/`restoreSave`, `buildId` gate, obfuscation,
`saveSlotKey`); each host renders its own UX. The browser shell owns name entry
and a **restore picker** of existing slots (backed by localStorage, where the
store already lives); the CLI degrades to a text name-prompt with `^L`-lists.
**No standalone `saves` verb** — enumeration is an affordance *inside* the restore
flow (the IF-traditional model: `RESTORE` opens the interpreter's picker), not a
command. The seam's restore call is "host, let the player choose a slot, return
the chosen blob (or cancel)"; the runtime validates against `buildId` and applies,
and never needs the slot list itself. Full design recorded in `devdocs/state.md`
→ "Save/restore UX: a host seam (Slice 3b)"; UX mockup at
`src/lighthouse/web/mockup-save-restore.html` (throwaway).
**Built so far** (host-seam, via the broker protocol in `devdocs/sandbox.md`): the
turn counter; the `meta` sidecar on `save_write` (`{ name, savedAt, turns }`,
unobfuscated, both hosts); `save_list`/`listSaves()` (this game's slots, newest first);
and the **browser save dialog + restore picker** (`save_prompt`/`restore_prompt`
deferred modals in `shell.js`/`shell.css`; runtime detects them by `promptSave`/
`promptRestore` on the channel and otherwise uses the CLI text prompt). Unit tests in
`tests/save`, e2e sidecar in the `save1` golden; the browser modals are source-grep +
manual only (the headless gap).
**Layering-smell fix DONE (2026-06-30):** `save`/`restore` are now **out-of-world Lamp
actions in `lib/advent/save.lamp`** over runtime blob-lifecycle primitives
(`save_available`/`save_has_picker`/`save_pick_name`/`save_to_slot`,
`restore_has_picker`/`restore_pick_blob`/`restore_read_slot`/`restore_apply_blob`; lib/sys
natives). lib owns the verbs + text-host wording; the browser modal stays a host seam
(reached via `*_has_picker`/`*_pick_*`). `save1` golden byte-invariant; `tests/save`
rewritten to the primitives. Done *without* the Lamp-callback `registerOutOfWorld` hook —
the `out_of_world` action mechanism was enough (same pattern as SCRIPT/TRANSCRIPT). UNDO
left as a native verb (no prompt, single line — little to gain).
**Remaining:**
- **CLI text-host polish:** `^L`-lists-saves at the name prompt + overwrite-confirmation
  (surface `listSaves` as a Lamp native + the in-`lib` prompt flow — now unblocked, the
  verbs live in lib), and a CLI `save_delete`.
- **Cancel/error sentinels** (`-1`/`-2`): generalize `save_write`'s `ok`/`error` text
  reply so cancel and failure are distinguishable on every message.
- Optional browser **file export/import** (download/upload) layered over localStorage.

### 2. Parser v2 — every-turn & timed rules + out-of-world actions
**Every-turn rules DONE:** advent declares an `every_turn_rules` rulebook the command
loop **follows once per turn** (`if run_command(...): if story == ongoing: follow
every_turn_rules()`). `run_command` now returns **true iff a turn was spent** (an action
ran), so parse failures / disambiguation prompts / out-of-world verbs fire nothing.
Games add side-effect `rule every_turn_rules:` (don't `stop`, so all run). Golden
`everyturn1` (countdown daemon that ends the story + the parse-failure-spends-no-turn
case); Phobos wires the suit auto-power-down **and the self-destruct doom-clock** on it.
Docs: specs.md "Every-turn rules". The **doom-clock** (`sample/phobos/lib/phobos/
countdown.lamp`) is the first real proof of the counter-in-an-every-turn-rule pattern: a
turn counter ticks down, the PA announces it (Siriusian) once Galaxy is inside the base,
and at zero it sets `story = lost` and ends the game with custom `end_story_rules` text.
**Out-of-world actions DONE (the mechanism):** a Lamp action body may carry an
`out_of_world` line; such an action runs its bands normally but bypasses the turn clock —
no undo checkpoint, no turn-count advance, and `run_command` returns false so every-turn
rules don't fire (parser/ast/emitter + runtime `setOutOfWorld`; `runCommand` checkpoints/
advances only when an in-world action runs — so parse failures no longer advance either).
Unlike the runtime's built-in single-word meta-verbs (`undo`/`save`/`restore`), these carry
full grammar/slots (`showme [target]`). Golden `outofworld1`; specs.md "Out-of-world
actions". This is the foundation for advent's **debug commands** (next) and for Phobos's
about/help/credits (which can now drop their turn).
**Remaining for v2:** **timed/scheduled events** (fire-once-at-turn-N — today done with a
counter in an every-turn rule, as the doom-clock shows; a built-in scheduler is the
convenience layer).
- **Fold in here — DONE (2026-06-30): all meta-verbs are now Lamp actions.** `undo`,
  `save`, and `restore` moved out of the runtime into `lib/advent/save.lamp` as
  `out_of_world` actions over runtime primitives (`undo_turn`, the `save_*`/`restore_*`
  set; see item 1). No `registerOutOfWorld` Lamp-callback hook was needed — the
  `out_of_world` action mechanism sufficed — so the native single-token meta-verb table
  (`outOfWorldCommands`/`registerOutOfWorld`) was **deleted**, unifying all player-command
  recognition through the grammar path.
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

### 3. RESTART — DONE (2026-07-01, Option C: in-process pre-startup baseline)
RESTART discards the game and starts over from `on startup`, **implemented in-process** —
no host respawn, no killed process. `run()` captures `captureState()` once as
`initialBaseline` (post-construction, *pre*-`fireEvent("startup")`), then on RESTART
`restoreState(initialBaseline)` + `clearUndoHistory()` + re-fires startup (intro reprints,
startup randomness re-rolls). This reuses the **state-provider registry** (the trusted
enumeration of all mutable state behind undo/save/restore); immutable program structure
(types/grammar/rules/template registry) is untouched because it never changes during play.
**Recognition mirrors QUIT** (session-control, so the library loop recognizes it, not the
parser): `is_restart_command` in `lib/advent/startup.lamp` → availability check → the
Infocom **confirmation** ("Do you wish to restart? (Y is affirmative): "; Y/YES confirms,
else "Ok.") → the `request_restart()` primitive → break; run() does the restore-and-re-fire.
Accepted mid-play **and** at the end-of-story prompt (no confirmation there — the player is
already answering an explicit prompt). **The end-of-story prompt is the full Infocom triad**
("Please type RESTART, RESTORE, or QUIT."): RESTORE routes through the normal restore verb,
`story` comes back with the snapshot, and the handler's session loop (an outer
`while playing:`) resumes the command loop — golden `endrestore1`; fr-FR `quit_prompt`
updated to match.
**Why viable now (once crashed):** pre-startup capture used to render templates against an
unbuilt world (phobos's `scan_levels` cipher threw); the persistable-templates work
(branded `{$tmpl:id,env}`, no render at capture) removed that. Capture is try/catch-guarded
— a game whose pre-startup template can't render leaves `initialBaseline` null and
`restart_available()`/`request_restart()` report it unavailable rather than crashing at
load. **Baseline not persisted** (construction is deterministic; a save gates on identical
build and a fresh session recaptures an identical baseline) — and it survives SAVE/RESTORE
in-session because it is a plain module var, not a state provider (verified manually).
**Host respawn (the earlier plan) not taken:** it resets immutable structure + native state
that don't change during play, at the cost of per-host lifecycle machinery; Option C is
host-agnostic and reuses the proven snapshot core. Regression golden `restart1` (mutate +
move rooms → RESTART → intro reprints, counter reset, back in the start room). Full
rationale in `devdocs/state.md` → "RESTART (Option C — in-process pre-startup baseline)".
**Where:** `src/lamplighter/index.js` (`run`/`requestRestart`/`restartAvailable`),
`lib/sys/{functions,index}` (`restart_available`/`request_restart`), `lib/advent/startup.lamp`.
**Follow-ups:** none — the confirmation prompt and end-of-story RESTORE are both done.

### 4. Runtime error diagnostics — Lamp-ish failures, not JS stacks
Make a failure during play trace back to a precise Lamp line (where available) or a
clear Lamp-ish cause, instead of a raw JS exception. **Done (first cut):** a clear
"no starting room" error (seam guard in `lib/advent/startup.lamp`; `game.start`
defaults to `none` so the check fires); `exe.js` no longer prints `execFileSync`'s
"Command failed" wrapper; and unset **primitive** fields now read as their zero
(`string`→`""`, `int`/`real`→`0`, `bool`→`false`) instead of JS `undefined`, so an
unset `string` prints "" not the literal "undefined" (`collectDefaults` backfills
zeros from the field schema; specs.md "Unset field values"). **Next:** a `LampError`
class with tagged propagation across
the worker boundary + one `formatDiagnostic` shared by all hosts (separate authoring
errors from engine bugs); more seam guards (move-to-none, describe none-room, unfilled
action slot, bad `start` target, list-index range); then either a `--debug-locations`
breadcrumb or **source maps** (recommended) to attach a `.lamp` line to *any* throw,
and debug-mode `field`/`index` accessors that turn raw `none` dereferences into
messages like "tried to read 'lighted' of nothing". Full design + roadmap in
`devdocs/errors.md`. Relates to item 6 (malformed-world startup check) — a core-runtime
guard needs that world contract.

## Optional / hardening

### 5. Lighthouse web bundle — headless e2e test DONE (2026-07-01, zero new deps)
Web v1 is **built, verified live, shell-polished, hardened for distribution, and
now end-to-end tested headlessly in CI**. `tests/lighthouse/drive-bundle.js` hosts
the built `game.worker.js` in a Node `worker_thread` behind a `self` shim (Node has
`SharedArrayBuffer`/`Atomics`/`TextDecoder` — no Playwright/Puppeteer needed) and
plays the shell's side of the wire protocol; `npm run test:lighthouse` drives the
**minified** cloak bundle through play, SAVE/RESTORE via the `save_prompt`/
`restore_prompt` picker protocol, transcript capture (closing message screen-only),
RESTART + confirmation (intro must print twice), undo-cleared-after-restore, and a
clean `done`. The driver fails fast on worker error / timeout / script-ran-dry.
**Only remaining uncovered layer:** `shell.js`'s own DOM behavior (modals,
scrolling, [more] paging, the transcript download click) — manual browser pass.
Still open: whether to default `--encode-strings` on for distribution builds.
**Where:** `tests/lighthouse/{run-lighthouse,drive-bundle}.js`.

### 6. Malformed-world startup check (optional hardening)
Carryover from arch issue C. When the parser is used, assert at startup that a
`physical` type and a `contains` relation exist, so a world library missing the
runtime↔world contract names fails loudly instead of resolving nothing deep in
`scopeOf`/`containerOf` (which now returns null when no `contains` relation is
defined). Low priority. **Where:** `src/lamplighter/index.js` (`run`).

## Design (not scheduled)

### 7. Core-vs-plugin: actions as core and/or an extensible compiler
Proposal recorded in `devdocs/compiler-extensibility.md`: resolve the
"IF baked into the compiler" coupling (arch doc → "Layer boundaries and IF
coupling") by (1) promoting actions+bands to first-class general core, and/or
(2) making Lantern plugin-extensible so a library contributes the action syntax.
Recommended de-risking first step: refactor Lantern into *core + one first-party
plugin* owning the action/IF constructs (no third-party grammar yet), which also
lets the base `action` type move out of the runtime bootstrap. No code until the
direction is chosen. **Where:** `src/lantern/*` (pipeline), `src/lamplighter/index.js`.

### 8. Content windows (status line is the first cut)
The traditional **status line is built on both hosts**: `lib/advent` composes room +
turn count and pushes it via the `status_line`/`turns_taken` primitives; the runtime
ships `{ left, right }` over a `status` message; the **web shell** renders a fixed-width
reverse-video bar, and the **CLI** renders it via an interactive **TUI render backend**
(alt-screen + raw mode; plain stdio for pipes/tests; `LAMP_NO_TUI` forces plain).
Design in `devdocs/windows.md`; backend seam in `devdocs/sandbox.md`. Branch
`CLI-status-bar`.
**CLI TUI:** styled transcript text, in-line editing (←/→, Home/End, Delete), ↑/↓
command history, mouse-wheel scroll (SGR reporting; Shift for native selection),
wrapping an over-long typed command (hard-wrapped by column), and multi-byte/emoji
input (UTF-8 chunk reassembly + code-point editing + display-width column math) are
**done**. Still deferred: batched redraws and keeping the transcript on exit
(alt-screen clears it now).
**Bigger (deferred):** generalize to arbitrary named content windows (the status line
collapses into one), a host capability handshake + headless fallback, and author
override of the status content (e.g. score games). **Where:**
`src/lighthouse/web/`, `src/lamplighter/sandbox/backends/`, `lib/sys`, `lib/advent`.

## Active (design decided 2026-06-25)

### Containment as a `contains` relation (replaces the `holder` field)
**Decision (2026-06-25):** make containment a one-to-many relation `contains`
(`from physical place` → `to physical contained unique`), the *single source of
truth*; `holder` becomes a query helper, not a stored field. This **reverses
world-model.md D1** (containment was the `holder` field; `scopeOf` walked
`inst.holder`) and the "world-iterating consumers never walk graph edges" note
(`index.js:7`) — relation IS now canonical. Per-decision choices: write via a new
core **`move X to Y`** statement (desugars to an assert of `contains Y X`); the
one-container invariant enforced by a **relation-level `unique` cardinality
modifier** on the `to` endpoint (asserting auto-evicts the prior edge); the
`supports` relation **stays separate** (still synced on containment change).
Only `scopeOf` reads `holder` in the runtime (buildVocabIndex does not), so the
core edit is contained. Names (default): `contains`/`place`/`contained`, keyword
`unique`. **Sequence:**
1. ~~Relation `unique` cardinality modifier — parser tag + `addRelation` auto-eviction + unit tests.~~ **DONE (2026-06-25):** `unique` contextual tag in `parseRelationBody` (combines with `inverted` in any order) → AST `uniqueFields` → emitter 7th `defineRelation` arg → runtime `addRelation` evicts colliding edges via `removeRelation` (remove handlers fire, names drop) before insert; dedup still short-circuits identical asserts. Tests: parser units + golden `relation24` (eviction, `?only` one-container invariant, move fires remove+add). Docs: specs.md (decl grammar, `defineRelation`/`addRelation` contract, contextual-keyword lists), relations.md (Cardinality section).
2. ~~`move X to Y` — tokenizer/parser/emitter/checker, desugars to a `contains` assertion.~~ **DONE (2026-06-25):** `move` is a reserved keyword (tokenizer KEYWORDS); `parseMoveStatement` parses `move EXPR to EXPR` → AST `MoveStatement{contained,container}` → emitter `lamplighter.moveObject(contained, container)` → runtime `moveObject` asserts `contains` with container=source/contained=target (endpoint names read from the registry; errors if no `contains` relation), relying on `unique` to evict the prior container. Checker threads both operands into call-checking. Tests: parser units + golden `move1` (orientation + relocate-evicts). Docs: specs.md (reserved words, `moveObject` API, `move` statement section). Note: `move` is now reserved (can't name a function/action `move`); updated a prescan test that used it as a sample name.
3. ~~Rewrite `scopeOf` to walk `contains`; update D1 + the line-7 note.~~ **DONE (2026-06-25):** new `containerOf(inst)` seam reads containment from the `contains` relation (endpoint names from the registry), **per-object falling back to the legacy `holder` field** when an object has no `contains` edge (transitional dual-read, chosen to keep all holder-based fixtures green). `scopeOf` rewritten to walk `containerOf`. Updated the registry comment (`index.js:7`), the D1 contract block (`index.js` + world-model.md: containment is now the `contains` relation, transitionally holder). Test: golden `scope_contains` (item placed via `contains`, no `holder`, resolves by scope; unplaced control rejected). All 141 golden green — no existing fixture touched. **Remaining for step 4:** remove the holder fallback once advent + fixtures migrate.
4. `lib/advent` migration — **planned 2026-06-25**, sub-sequenced so each commit stays green and stdout is invariant (no pinned generated-JS to regen). **Key discovery:** raw `.holder` *field* reads (advent AND cloak.lamp's ~12 own-rule reads, scattered fixtures) go stale the moment writes switch to `contains`, so a naive flip is a huge atomic change. **Bridge (decouples advent from fixtures):** (a) step-3 `containerOf` holder fallback covers field-placed/never-moved items; (b) a transitional advent handler `on contains add: self.contained.holder = self.place` keeps the legacy field correct for anything still reading it. No sample/fixture registers its own holder-change handler (checked), so the bridge can't collide.
   - ~~**4a (advent internals, ~6 files, no fixture changes).**~~ **DONE (2026-06-25):** declared `relation contains` in globals.lamp; added `native function container holder(physical x)` → index.js `holder(x){return lamplighter.containerOf(x);}` (exported `containerOf`); added the sync-bridge `on contains add: self.contained.holder = self.place`; rewrote all advent `.holder` reads → `holder(X)` and writes → `move X to Y`; converted `on person.holder change`→`on contains add: if self.contained==player: describe_room(self.place)` and the supports handler → `on contains remove: remove supports _ self.contained`; ported `contents_of`/`describe_supporters` to `containerOf`. Holder field kept on the types. **All 141 golden unchanged** (no fixture touched, no regen). Two `let here = holder(...)` workarounds needed: `go`'s relation-query slots (function calls disallowed in slots) and `in_darkness` (parser rejects `holder(p).lighted` — see parser item below).
   - ~~**4b (fixtures/samples → contains placement).**~~ **DONE (2026-06-25):** migrated all advent-world fixtures (advent3,4,5,6,7,10,11,12,15,16,19, save1, undo1, undo2, understand1, selector_unknown_tag, study_advent) — `holder X` placements → top-level `contains X obj`; cloak.lamp + advent12 + selector_unknown_tag own-rule `.holder` reads → `holder()`. Standalone parser1/parser_it (own world, use run_command/scope) fully migrated: dropped their `holder` field, declared a local `relation contains`, added `function physical holder(physical x): return contains ?only x`, reads→`holder()`, writes→`move`. All 141 golden stdout-invariant (one expected-output update: selector_unknown_tag's echoed source line). **study.lamp intentionally NOT migrated:** it's a self-contained world that drives actions via `try` (never `run_command`/`scopeOf`), so it doesn't use the runtime containment contract or the `containerOf` fallback and won't break in 4c; migrating would need a `physical`/common-supertype restructure (its `person`/`item` share no parent) for purely cosmetic consistency. Could revisit as a separate sample-polish task.
   - ~~**4c (drop the bridge).**~~ **DONE (2026-06-25):** removed `container holder` from advent `item`/`person`, the `on contains add` sync handler, and the `containerOf` holder fallback (now returns null when no `contains` edge / no relation). `holder()` is pure-`contains`. Updated index.js contract comments + world-model.md (transitional language removed; `contains` is the sole containment representation). Verified no `.holder` field refs remain in advent or the runtime. **All 141 golden + state/save/parser/tokenizer/prescan/native-scan/liborder green** — dropping the field broke nothing, confirming nothing depended on it. **Containment migration (steps 1–4) COMPLETE.** Optional leftovers: migrate `sample/study.lamp` (self-contained, deferred above) and item 6's startup guard.
   - **Open (confirm before 4a):** relation shape `contains`/`place`/`contained unique` with `from physical` (lets a person hold inventory); `holder()` native-backed-by-`containerOf` (vs pure `contains _ x ?only`); the sync-bridge approach (vs migrating every fixture read atomically in 4a).
5. Nesting syntax (below) on top — desugars `room R:`/`item hook:` to `contains R hook`.
**Where:** `src/lantern/{tokenizer,parser_rd,emitter,checker}.js`, `src/lamplighter/index.js`, `lib/advent/*`, `devdocs/{relations,world-model}.md`.

## Smaller / opportunistic
- ~~**Adaptive contractions (`[we're]`/`[don't]`/`[that's]`) — mechanism.**~~ **DONE (2026-07-04,
  en-US):** the full D9 token set is live — **D9a** subject-pronoun (`[we're]`/`[we've]`/`[we'll]`/
  `[we'd]` + referent siblings `[they're]`/…, spelling out for a `viewpoint_named` third person:
  "Galaxy is", then "She'll" once pronominalized), **D9b** negated-auxiliary (`[don't]`/`[aren't]`/
  `[weren't]`/`[haven't]`), **D9c** demonstrative (`[that's]` → that's/those are). Zero-arg sugar
  (parser `PRONOUN_SUGAR_FNS`, apostrophe allowed) + en-US natives reading the `{person, plural}`
  agreement. Golden `contractions1`; suite byte-invariant.
  **French-contraction strategy — DECIDED (2026-07-05):** English and French "contractions" are
  *different phenomena* (English fuses pronoun+aux / aux+not, adapting to person/number; French has
  phonological *elision* — l'/j'/n'/qu' — triggered by the next word, plus prep+article du/au, and
  *discontinuous* negation "ne … pas" that is syntax, not a token). So we do **not** port `[we're]`/
  `[don't]` to French. Three layers, in order:
  1. **Contractions stay en-US locale sugar; advent's shared defaults stay contraction-free** (the
     current resting state — correct, zero work). An English game that wants them (Phobos, 3rd-person
     named) uses them in *its own* message overrides (compiled only for that game). No fr-FR stubs —
     a fused pronoun+verb has no honest identity fallback (unlike a verb, whose `conjugate()` is
     identity in fr-FR).
  2. **French's real needs, separately** (when French adaptive text matters): generalize the existing
     `elides()` into elision sugar (`[l' X]`); prep+article (du/des/au/aux); and the **foundational
     gap — French verb conjugation** (fr-FR `conjugate()` is currently identity; nothing French
     adapts well until this exists — bigger impact than contractions).
  3. **Architectural direction (bigger):** move default message *text* out of advent into the locale
     packs (advent = keys + world logic; en-US owns English prose + English sugar; fr-FR owns French
     prose + French sugar). Then locale sugar never leaks cross-locale and the shared-re-theme problem
     disappears; also fixes partial-translation mixing.
  **Follow-through:** demonstrate layer 1 by adding contraction overrides to Phobos's messages; scope
  layer 2's French verb conjugation as the next French investment.
- ~~**Action-verb synonyms + adjacent-slot check.**~~ **DONE (2026-07-04):** reviewed a batch of
  added verb synonyms (look around; take: pick up/pick X up; drop: throw/put down/put X down;
  wear: don/put on/put X on; doff: doff/take X off; kiss: smooch; drink: sip/gulp/quaff/swig) —
  all safe and verified, including the `put`/`take` overlaps that share leading literals across
  drop/wear/put_on/doff (the runtime backtracks over every structurally-matching grammar). **Two
  were broken:** the reversed datives `"give [recipient] [gift]"` / `"show [recipient] [shown]"`
  silently never matched — two adjacent slots with no literal between them, which `matchGrammar`
  can't split (the first slot greedily eats the rest). Removed them (the `... to ...` forms remain).
  **Guard added:** `checkNoAdjacentSlots` in the checker rejects any action `syntax:`/`understand`
  template with adjacent slots at compile time (relation `syntax` exempt — parsed at compile time).
  Golden `adjacent_slots`; 218 goldens; specs.md documents the rule. **Possible future feature:**
  adjacent-slot (dative) grammar support would need noun-phrase-boundary parsing in the matcher.
- ~~**KISS action.**~~ **DONE (2026-07-04):** `kiss [target]` — a social action universally
  refused by default (mirrors ATTACK): `check kiss` always `stop failed kiss_pointless` (reason
  auto-created), and `report failed kiss` prints the retheme-able `kiss_refused` message ("[We]
  [do] not think [the act.target] would appreciate that."). A game overrides per-object with
  `instead kiss when self.target == X`. Registered `kiss` as a conjugation verb (en-US/fr-FR) so
  custom responses can use `[kiss]`. Golden `kiss1` (default block + override); 217 goldens,
  existing byte-invariant.
- ~~**`[those]` number-agreeing demonstrative.**~~ **DONE (2026-07-03):** a `[those]` bare-word
  substitution (Inform's `[regarding X][those]` idiom) renders "that"/"those" by the number of
  the context subject, reading the same agreement descriptor as the adaptive pronouns/verbs;
  `[Those]` capitalizes. Added `those` to the parser sugar set and a `those()` native to en-US
  (and fr-FR, masculine number-only — French demonstratives also inflect for gender, not modeled).
  Rewrote the 9 advent "…that." refusals (take/drop/wear/doff/examine/put-on ×2/drink/eat) as
  `[regarding self.X][those]`, so a plural object now reads "those". Golden `those1`; 216 goldens
  byte-invariant (existing fixtures use singular objects). **Follow-up:** fr-FR `those()` needs
  gender (celui-là/celle-là/ceux-là/celles-là) when French demonstratives get modeled.
- ~~**EAT action (mirrors DRINK).**~~ **DONE (2026-07-03):** `eat [food]` consumes an `edible`
  thing (removes its `contains` edge), refuses anything else (`not_edible`, auto-created reason).
  Added `bool edible` to `physical`; golden `eat1`; `showme1` re-baselined (dump lists `edible`).
  Also registered `drink`/`eat` as conjugation verbs in en-US/fr-FR — `[drink]`/`[eat]` now inflect
  in third person (`report *_other`: "Galaxy eats the apple"), retroactively fixing DRINK's latent
  uninflected 3rd-person report (2nd-person was already correct, so byte-invariant).
- ~~**Auto-created stop_reasons (declare-by-use).**~~ **DONE (2026-07-03):** failure reasons no
  longer need a `stop_reason X` declaration — the prescan harvests reason names from `stop failed X`
  (and `self.reason = X`) producer sites, adds them to `objectNames` so every reason (single- OR
  multi-word) resolves uniformly as an object, and index.js injects a synthetic `stop_reason X`
  singleton for each (deduped against explicit declarations, guarded on the `stop_reason` type
  existing). This also fixed the pre-existing quirk where an undeclared *multi-word* reason
  (`not_drinkable` → `getObject("not drinkable")`) crashed at runtime while single-word ones
  silently fell back to strings. Removed the 26 advent declarations (globals/doors/conversation).
  **Typo net:** generalized `checkObjectNameComparison` so a `self.reason == REASON` (or any
  object-typed comparison) against a name that no producer creates is a compile error, not a
  silent never-match — catches reason typos, single- and multi-word. Golden `autoreason1`; 214
  goldens + all suites byte-invariant; specs.md updated. (Samples keep their explicit declarations,
  which still work via dedup.)
- ~~**DRINK action completion.**~~ **DONE (2026-07-03):** the DRINK verb was in-progress and
  compiled but was unusable — it referenced two undeclared names (property/enum reads aren't
  checked). Added `bool drinkable = false` to `physical` (types.lamp, next to `feelable`/
  `edificial`) and `stop_reason not_drinkable` (globals.lamp). Fixed the `do drink` body (the
  invalid `remove … from` → `remove contains _ self.liquid`, so a drunk liquid leaves play).
  Golden `drink1` (refuse a non-drinkable rock, drink a potion, confirm it's consumed); `showme1`
  re-baselined (its field dump now lists `drinkable`).
- ~~**`!=` inequality operator.**~~ **DONE (2026-07-02):** `a != b` desugars to `not (a == b)`
  at parse time (tokenizer emits a `NEQ` token on `!=`; a bare `!` still errors — Lamp spells
  negation `not`), reusing the existing equality + negation machinery, so no emitter/checker/AST
  changes. Same precedence as `==`; works in conditions, guards, and template substitutions.
  Golden `neq1`; specs.md "Comparison" updated. **Optional follow-up:** ~54 existing
  `not (X == Y)` sites in lib/advent (+ samples) could be simplified to `X != Y` — byte-invariant,
  but a noisy multi-file churn, so left for a dedicated pass if wanted.
- ~~**SCRIPT / TRANSCRIPT (scripting) — advent transcript command.**~~ **DONE
  (2026-06-30):** `SCRIPT`/`SCRIPT ON`/`TRANSCRIPT`/`TRANSCRIPT ON` start, `SCRIPT OFF`/
  `TRANSCRIPT OFF` stop, mirroring the session's output + the player's prompts/commands to
  a host-written text file (filename prompted, like SAVE). **Built with the mechanism/policy
  split the SAVE/RESTORE layering-smell fix wants** (it's the worked example for migrating
  those): the **runtime owns only the mechanism** — capture hooks (`hostWrite` chokepoint +
  `promptLine`/`readLine` for input), the `setTranscriptChannel` host seam, and four
  primitives `transcript_start`/`transcript_stop`/`transcript_running`/`transcript_available`
  (lib/sys natives); the **library owns the policy** — `lib/advent/transcript.lamp` declares
  `script_on`/`script_off` as `out_of_world` actions carrying the grammar, the `prompt(...)`
  for the filename, and named/overridable wording, so a non-advent game can reword, localize,
  or omit it. The host seam reuses the save reply buffer for a synchronous `start` +
  fire-and-forget `write`/`stop` (`worker.js`/`host.js`; CLI writes `<key>.txt` under
  `LAMP_TRANSCRIPT_DIR`). Unit tests `tests/transcript` (the primitives + capture mechanism),
  e2e golden `transcript1`; docs in `devdocs/state.md` ("Transcript (scripting)") +
  `devdocs/sandbox.md` ("Transcript broker protocol"). **Browser transcript DONE
  (2026-07-01):** `worker-browser.js` wires the same channel (save-buffer sharing, same
  broker messages) and the shell accumulates the mirrored text in memory, triggering a
  `<name>.txt` **download** when the transcript closes (SCRIPT OFF, or game end with one
  open — the analogue of the CLI's close-on-exit; a page closed mid-transcript loses it).
  Verified end-to-end by driving the phobos release bundle through the worker protocol
  (the item-5 harness); static wiring assertions in `tests/lighthouse`. Remaining:
  Electron, if that host ever lands. **Applied
  the same split to SAVE/RESTORE *and* UNDO (2026-06-30; see items 1–2), retiring the
  native meta-verb dispatch table (`outOfWorldCommands`/`registerOutOfWorld`) entirely — so
  all player commands now resolve through one grammar path.**
- **End-the-game machinery: isolate the globals behind a function call.** Ending the game
  today means game code writing globals directly — `story` (enum, lib/advent/globals.lamp) and
  `ending_override` (the ending-specific banner, sample/phobos/control_room.lamp + phobos.lamp
  `end_story_rules`). Replace with a single entry point, e.g. `end_game(outcome, banner)`, that
  sets the globals internally so callers never touch them (the I7 analogue of `end the story
  saying "…"`). Keeps the win/lose contract in one place and makes the Guard's many death
  endings one-liners. Lives in advent (where `story`/`end_story_rules` live). **Where:**
  `lib/advent/globals.lamp`, sample end rules.
- **Read-only render flag (text engine).** Some renders are *inspections*, not real output,
  and must not advance site-durable state (`[first time]`/`[Nth time]` counters,
  `[cycling]`/`[random]` cursors): **SHOWME** renders a field's template to display it
  (`lib/advent/index.js` `formatDebugValue` → `renderText`), and **SAVE** freezes text-thunk
  fields at capture (`encodeValue`). A stateful field value would advance as a side effect of
  merely inspecting or saving it. Plan: a runtime global boolean (e.g. `renderReadOnly`) set
  around such evaluations; the site-advance helpers (`variationAdvance`/`variationPick`, the
  first-time counter) read state but skip the mutation when set. Surfaced by SHOWME; deferred.
  See `devdocs/text.md` ("read-only render flag").
- ~~**Snapshot freezes live templates → stale after undo/save/restore.**~~ **Phase 1 DONE
  (2026-07-01).** `captureState`/`encodeValue` used to freeze a `text`-thunk field by
  rendering it to a string, so after a snapshot-restore the field was a dead scalar that no
  longer tracked the state it read — undo, save, and restore all exhibited it (repro
  `bump.lamp`; not undo-specific, no context-dependent sugar needed). **Fixed** by
  persistable templates (`devdocs/text-persistence.md`): the emitter gives each no-capture
  template literal a build-stable id + module-load `registerTemplate`, a stored `text`
  serializes as `{$tmpl:id}`, and restore rebuilds a **live** thunk (`instantiateTemplate`).
  Covers construction descriptions **and rule-assigned templates** reading globals or a
  **named instance** (`[clock.hour]`) — the emitter tracks lexical scope (`localScope`,
  maintained by `emitStatementList`, consulted in `capturesName`) so a named instance
  persists as a module const unless a local shadows it (Phases 1.5 + 2a) — **and templates
  capturing `self`** when `self` is a persistent instance (Phase 2b): the capture predicate
  collects captured names, `{self}` brands with a `(self) =>` factory + `env:[self]`, and
  `encodeValue` `{$ref}`s the env, freezing if `self` is a transient action. **This is full
  I7 parity** — what persists live is what I7 persists; what still freezes (transient-`self`,
  `let`/shadowed-name capture, runtime-composed `a + b`) is what I7 also can't. Regression
  goldens `textlive1`/`textlive2`/`textlive3`. Also removed the render-at-capture cursor
  side-effect. (A no-shadow-on-objects checker rule was tried for 2a and **reverted** —
  object names are too numerous to reserve against locals, e.g. `let count` collides with an
  object.) A **compile-time warning** (built) fires when a field/global is assigned a
  template that will freeze on save (captures a `let`/loop var/shadowed name), naming the
  binding (`maybeWarnFrozenTemplate`; test `tests/textwarn`) — a `{self}` capture is not
  warned (brandable; ambiguous at compile time). **Nothing left** — full I7 parity. **Where:**
  `src/lantern/emitter.js` (`localScope`/`capturesName`/`collectTemplateCaptures`/
  `maybeWarnFrozenTemplate`), `src/lamplighter/index.js` (`templateRegistry`,
  `instantiateTemplate`, `encodeValue`/`decodeValue`).
- **advent debug commands (Inform-style) — in progress** (`lib/advent/debug.lamp`).
  Built on `out_of_world` + a new **`world_scope`** action modifier (object slots resolve
  against every `physical` object, not just scope — parser/ast/emitter + runtime
  `setWorldScope`; specs.md). **PURLOIN [thing] DONE** (golden `purloin1`): pulls any item
  into inventory wherever it is (another room, a closed container). **SHOWME [thing] DONE**
  (golden `showme1`): dumps an object's identity, location, own fields, and contents — via a
  `describe_object` native (the instance is a plain record, so `Object.keys` gives its
  fields); reaches out-of-scope objects too. **GONEAR [room-or-thing] DONE** (golden
  `gonear1`): teleports the player to a room, or to the room enclosing a thing (pure-Lamp
  `room_of` walks the holder chain to the top); the destination auto-describes. One verb for
  both (GOTO left free for authors). **BUG — `gonear <door>` is broken:** a door is contained
  in no room (it's surfaced by the door scope provider, present in two rooms), so `room_of`
  walks to a door and finds no enclosing room → gonear fails / goes nowhere. Fix: special-case
  doors in `room_of`/gonear — pick one of the door's two sides (e.g. read a side off the
  `doorway`/`connects` edges). Found while teleporting around Phobos. **Where:** the gonear/
  `room_of` logic in `lib/advent/debug.lamp` (+ maybe a door-side query). **TREE + SCOPE DONE** (golden `treescope1`): TREE dumps
  the whole world's containment tree (a `world_tree` native); SCOPE lists what is in the
  player's scope right now (`scope_listing` over the now-exposed `scopeOf`). (ABSTRACT is
  skipped — deprecated in I7.) **Release-build flag DONE** (`test:release`): a `.lamp` file
  marks itself debug-only with a top-level **`not_for_release`** directive (new keyword,
  inert in a normal build); **`--release`** excludes every such file (the compiler drops
  them from the token stream before parsing; build fingerprint over the included files).
  `lib/advent/debug.lamp` and `sample/phobos/lib/phobos/debug.lamp` (Phobos's `late`/`scanall`,
  moved there) are marked. **`--release` threaded DONE:** `exe.js` forwards compile flags
  (e.g. `lantern-exe game.lamp --release`); **Lighthouse `build:web` builds release by
  default** (web bundles are distribution — `--debug` opts back in), so the Pages deploy
  ships without debug verbs. **TEST runner DONE** (I7's `test NAME with "a/b/c"`): a `test_script`
  holds a `"/"`-joined command string; `test [name]` splits it (`split_on` sys native) and queues
  the commands through the **real** command loop via a runtime input queue that `promptLine` drains
  (echoing each; front-insertion so a nested `test name` expands in place) — every-turn rules fire
  as in normal play. Golden `test1`. **Faithful Phobos walkthroughs DONE:** `test most` (collect +
  scan all 5 docs + solve every keypad → control room) and `test endgame` (+ the guard win → victory),
  plus quick `test talk`/`test win`. Made deterministic by a `debug_mode` global (mirrors I7's
  `DEBUG is true`; set in the not-for-release debug file) that fixes the purple code (buttons 1-5) and
  the blue arrangement (press 1/2); a release build leaves them random. **Possible next:**
  richer SHOWME (e.g. relations); a debug-only `RELATIONS`/`RULES` dump.
- ~~**Galaxy Suit + power-up (Phobos)**~~ **DONE** (`sample/phobos/lib/phobos/suit.lamp`):
  worn suit, POWER UP/DOWN, and a powered smash. The **ATTACK/HIT/SMASH/PUNCH verb is in
  advent** (any `item`; default declines via `attack_violence`; golden `attack1`); the suit
  layers the powered door-smash via `instead attack` (purple resists), falling through to
  advent's default otherwise — a testing shortcut past the hacking puzzles. The every-turn
  **auto-power-down** is now wired (item 2's `every_turn_rules`; the power-up turn is
  skipped via a flag). Deferred: the power banner (rides on scoring) and the locker-smash
  variant.
- ~~**Cyberhelmet + Cybercarapace (Phobos, Cyborg.i7x)**~~ **DONE (first slice)**
  (`sample/phobos/lib/phobos/cyborg.lamp`): the two disguise wearables (helmet in the North
  Barracks cabinet, carapace loose in the armory via `initial_appearance`), each with an
  `after wear` rule that prints its own message (replacing advent's 2nd-person default — `after`
  precedes and `stop`s the report band) plus the "She is now disguised as a Siriusian cyborg."
  completion when both are worn. The player OPENs the (closed) cabinet to reveal the helmet.
  **Purple door → endgame (the disguise payoff) — being sliced.** **Slices 1+2 DONE**
  (`hacking.lamp`): the visual-identity gate (hacking the purple door needs both wearables)
  + the **16-button select-five keypad** (`press [n]`, toggle lit/dark, wrong-fifth resets,
  the right five opens the door → the control room). **Slice 2:** the code is **random**
  (`ensure_control_parts` shuffles 1-16, takes five, lazily); each button has a distinct
  Siriusian glyph, the **fully-scanned commander's log** reveals the five code glyphs, and the
  **keypad shows every button's glyph** so the player decodes glyph → number by matching
  (NOT-FOR-RELEASE `scanall` debug for testing). **Control Room furniture DONE**
  (`base.lamp`, Base.i7x "Book - Control Room"): the central control panel, screens, chair,
  collective buttons, and launch/self-destruct buttons ported as **scenery (EXAMINE only)** with
  their descriptions + synonyms (bare "button" disambiguates the three; green→launch,
  red→self-destruct, controls→panel). The generic **PUSH verb is now in advent** (`push
  [target]`, any item; default "Nothing obvious happens."; `instead push` to respond; golden
  `push1`) — so the control-room buttons are pushable, just inert until their endgame `instead
  push` rules land. The Phobos keypad action was renamed **`press_key`** (was `press`) so PUSH
  (items) and PRESS (keypad keys) never collide — faithful to Inform, where pushing understands
  push/press but the keypad's "press [key]" is a separate, hacking-gated action. Deferred: advent
  has no **part-of** relation (each fixture is a standalone object, not "part of" the panel), no
  **TOUCH**/`feels` verb, no **SIT**/enterable supporter (the chair). The **buttons' push
  behaviour is now ported** (`control_room.lamp`, base/no-guard variants): **launch** = the
  immediate loss (ends the story via a new `ending_override` global = I7's `end the story saying`,
  reused by Guard deaths later), **self-destruct** = starts the sequence + sets
  `self_destruct_pushed` and points Galaxy at the reactor (re-push = "already initiated"). The
  **reactor arming levers are now ported** (`base.lamp` furniture + `control_room.lamp` PULL rules):
  a generic **PULL verb is in advent** (golden `pull1`); a single lever springs back, both are
  "too far apart for one person" — arming needs two people. The **flight deck + escape ship are
  ported** (`base.lamp` scenery/ship/interior + `flight_deck.lamp` ENTER/FLY): new advent generics
  — an **`enter` action** (golden `enter1`) and **`inward`/`outward` directions** (typed in/out).
  FLY decides the ending — a loss if the self-destruct isn't armed (reachable now), the heroic win
  once `self_destruct_in_progress` is set (both via `ending_override`); a not-for-release **`arm`**
  debug verb makes the win testable. **The Guard — conversation foundation DONE:** a new third
  library **`lib/conversation`** (subjects + `ask`/`tell`, kept out of core advent — opt in with
  `lib conversation`; golden `conversation1`) drives the guard's ~43 ASK topics (`guard.lamp`,
  subjects carry their `reply` — no table primitive). EXAMINE now targets any `physical` so NPCs are
  examinable. **All guard speech is Siriusian/scan-aware** (like signs): the ASK/TELL replies and
  every spoken scene line (greeting, gift reactions, alliance, lever/flee/death, control-room PAs)
  render the English source through `siriusian()` via a `g_say` helper / `instead ask` override
  (write()-based, so multi-sentence lines aren't broken per sentence). Readable only as far as
  Galaxy has scanned. **Guard persuasion + alliance DONE** (`guard_persuasion.lamp`): new advent **GIVE/SHOW**
  verbs (golden `give1`); a pleasing action (give/drop pistol, give log, give chocolate) → pleased →
  removing the disguise fires the **alliance reveal** (sets `self_destruct_pushed`); death-on-detection
  + greeting; not-for-release `disguise` debug verb. **Guard endgame DONE** (`guard_endgame.lamp`):
  the guard **leads** Galaxy to the reactor (NPC movement via co-location every-turn rules) and pulls
  the left lever; Galaxy pulls the right → arms the self-destruct (retires the `arm` crutch); the guard
  leads back; two **commandos** burst in (a `commando` type) — ATTACK (unconscious) or SHOOT (dead, new
  `shoot` action needing the pistol); downing both kills the guard (it shielded her) and opens the way
  to the ship → win. advent's **examine + attack now target `physical`** (people attackable/examinable;
  byte-invariant). **`test endgame` plays the whole game to victory with no debug shortcuts.** The
  **Guard arc is complete.** Deferred: **scoring** (carry the unconscious commandos for points), the
  "distracted → shot" mid-fight punishment (here she just can't flee), the SAY/ANSWER free-text asides,
  and the handprint-scanner part-object. (The helmet's number-translation — the doom-clock count
  reads in plain numerals while the Cyberhelmet is worn — is done, in countdown.lamp.)
- ~~**OPEN / CLOSE actions for containers (advent)**~~ **DONE**
  (`lib/advent/actions.lamp`): OPEN/CLOSE (`shut`) over `box`es — opt in with `closable
  true`; opening reveals newly-visible contents and unseals them for scope (closing
  reseals), a `locked` box refuses ("seems to be locked"), already-open/closed and
  non-openable are reported. Reports use `[We] [open]/[close]` (viewpoint-aware). Box gained
  a `locked` field; golden `openclose1`; 170 green, byte-invariant. Phobos's cabinet and
  locker use it (the locker stays `locked` until the hack clears it, so OPEN can't bypass the
  puzzle). **Deferred:** LOCK/UNLOCK verbs and OPEN/CLOSE on **doors** (own go/hack
  mechanism; different `closed`/`locked` defaults — revisit with the door work).
- **`--encode-strings`: encode name literals inside inlined native JS (backlog).** Today
  the encoder rewrites name literals only in *emitter-emitted* code; strings inside a lib's
  `index.js` are inlined verbatim, so structural names a native references by literal stay
  plaintext in the encoded build (in `lib/advent`: relation names `connects`/`doorway` via
  `wire_doors`/the door scope-provider, type names `door`/`item`, and the `oxford comma`/
  `viewpoint …` globals). **Not a runtime bug** (names decode back to the same plaintext
  registry keys at load, so encoded doored games run fine) and **not author content** (only
  framework names leak; the game's prose + own names are encoded) — accepted + documented in
  `devdocs/lighthouse.md`, and the encode test (`tests/encode/run-encode.js`) excludes the
  native-called verbs (`getGlobal`/`type`/`addRelation`/`queryRelationValue`). **To close
  it:** either (1) **targeted literal substitution** in the inlined native source using the
  encoder's existing name→code map (fragile — risks matching a name in a native comment/
  unrelated string, and breaks the "native JS is verbatim" contract; would need careful
  scoping/tests), or (2) **runtime indirection** so natives reference relations/types by an
  opaque handle instead of a name literal (cleaner, broader native↔runtime API refactor).
  **Where:** `src/lantern/emitter.js` + `src/strcodec.js` (option 1), or the
  `lamplighter` native API (option 2).
- ~~**Door subsystem for advent (Phobos port).**~~ **DONE.** A `door` type (in
  `types.lamp`, after its parent `item`) declares its two sides as `<direction>
  <room>` fields (destination semantics — `north RoomB` = "go north to reach it");
  the `wire_doors` native (called at startup) materializes two directed `connects`
  edges + two `doorway` edges. Scope via a general **scope-provider seam**
  (`registerScopeProvider` + `scopeOf` union) — advent registers a provider
  surfacing the current room's doors (also the seam for future backdrops /
  `place-in-scope`). Closed door blocks `go` (`door_closed` reason). **Option A
  consistency check** in `checker.js`: a door must set exactly two directional
  `room` fields (keyed on field signature, not the type name, so a user `door` is
  unaffected). Tests: golden `doors1` (block / two-sided scope / open+pass /
  traverse) + `door_too_many` (compile error); 157 golden + state + save green.
  Phobos's 6 doors wired in `sample/phobos/lib/phobos/base.lamp` (base sealed until
  a HACK/unlock verb exists). Docs: specs.md (Doors section, `door`/`doorway`,
  `registerScopeProvider`, `door_closed`). **Follow-ups:** (B) a general
  library-contributed consistency pass (decoupled; reusable for room-reachability /
  edge-collision / action-slot invariants — first slice of item 7); standard
  OPEN/CLOSE/LOCK/UNLOCK door verbs; door **parts** (handprint scanners) as
  `contains` vs. a distinct `part_of` relation; door-closed message is a plain
  print (i18n gap — names a non-slot local).
- **Region/subset-scoped backdrops (advent).** Today advent's `backdrop` type is
  **everywhere** — the scope provider in `lib/advent/index.js` returns *every*
  `backdrop` instance regardless of the actor's location (`type("backdrop").all`),
  matching I7's default "the X is everywhere." But I7 backdrops can also be present
  in only *some* rooms (a specific room, a list, or a region). Add a way to scope a
  backdrop to a **subset of rooms**, so the provider surfaces a given backdrop only
  where it belongs. Likely shape: a `present_in` relation (`backdrop` → `room`,
  many-to-many) that the provider consults — empty set = everywhere (back-compat), a
  non-empty set = only those rooms; or, later, a `region` grouping over rooms.
  Parallels how the **door** provider is already room-scoped (it queries the
  `doorway` relation for the current room). Not needed by Phobos (its walls/floor/
  ceiling are genuinely everywhere), so it's a general-engine enhancement. **Where:**
  `lib/advent/index.js` (provider) + `lib/advent/globals.lamp` or `types.lamp` (the
  relation), specs.md "Backdrops".
- **Phobos third-person presentation + Siriusian cipher (port) — in progress.**
  **Room heading DONE:** advent factors the heading into an overridable
  `room_heading_rules(room r)` rulebook (default byte-identical) + `room`
  `preposition`/`always_indefinite` fields; Phobos contributes a name-embedded
  third-person intro that runs on into the description ("Galaxy is in **the passage
  end**. <desc>"). Golden `room_heading1`; 158 green; docs in specs.md. **Third-person
  viewpoint DONE:** the story viewpoint now supports third-person gendered narration —
  person/number from the globals `viewpoint_person`/`viewpoint_plural`
  (`lib/sys/globals.lamp`, defaults 2/false, byte-invariant), and **gender read off the
  player object** (`player.gender`, the same source the subject pronouns use — not a global,
  so it tracks the main character) by the locale's `viewpoint()` (both en-US and fr-FR).
  advent's hard-coded "You see " contents intro became the `[We] [see]` sugar. Phobos sets
  `viewpoint_person = 3` + `gender "female"` on `yourself`, so the contents listing reads
  "She sees a … here." and examine-nothing "She sees nothing unusual …". (text.md D7.)
  **Initial appearance DONE:** `item.initial_appearance` (a paragraph shown in the room until
  the item is first taken) + a `handled` flag set on take; `listable_contents` pulls
  not-yet-handled initial-appearance items out of the "[We] [see] … here." list (they stay
  in scope). Phobos's loose documents use it ("A form hangs on the wall beneath the sign.");
  golden `initial_appearance1`; byte-invariant (empty default). **Remaining for
  presentation:** (a) contents reword "Also here is/are …" — needs a parallel **contents
  seam** (advent's frame can't add the copula from a message override alone, like the
  heading); (b) the still-2nd-person **parser feedback** ("You can't see any such thing."
  — `parser_cant_see`/`parser_no_understand`); (c) deferred (agreed): third-person
  **action reports** — but NOT take/drop (Phobos leaves "Taken."/"Dropped." as-is);
  examine-undescribed / disguise variant; nested-location parenthetical. **Siriusian
  display cipher DONE:**
  `siriusian(text)` native in `sample/phobos/lib/phobos/index.js` (non-invertible:
  drop odd chars / shift-by-len / reverse / many-to-one glyphs); used as
  `[siriusian("…")]`; **the full Passage End description renders byte-for-byte like
  the I7 transcript** (label + door-state conditional). **Reading DONE (Linguistic
  Module slice 1):** the **progressive scan-level reveal** is ported
  (`lib/phobos/linguistics.lamp` + `print_translated`/`is_textual`): a `document`
  (textual) type with `content`/`scan_level`; examine/read renders the content
  word-by-word — each word translates to English once its difficulty tier is in the
  global `scan_levels`, else fixed-width Siriusian (`!`/`$`/`#` = proper-noun/control
  tiers that stay alien; `/` = paragraph break); emitted via `write()` so only `/`
  breaks the prose. **Scanning DONE (slice 2):** the **SCAN verb + Linguistic Module
  item** (carried from start) marks a `document` `scanned` and flips its tier on in
  `scan_levels` (a fixed five-slot `list<bool>`, so adding a tier is element assignment —
  no append, no new natives; the scan target is typed `document` so it reads fields
  directly). Guards: already-scanned, not-carrying-Module. Undo reverts scan state.
  **All five textual documents DONE** (Texts.i7x): the diary (tier 2, full content1+content2,
  9 paragraphs) plus the sign-out form (1), science notebook (3), reactor manual (4), and
  commander's log (5) — **full tier coverage, so full translation is reachable** (the log's
  tier-20 `#` security-key words reveal only once all five tiers are scanned). `[']` escapes
  word-final possessives; the form alone carries a physical description shown before its
  content. **All room descriptions DONE** (Base.i7x, in `base.lamp`): static
  `[siriusian("…")]` signage + `[if <door>.closed]` state; the North Barracks `cabinet` added
  so its conditional resolves. **Scan-aware Siriusian labels DONE:** `siriusian("…")` now runs the
  same per-word filter the documents use (extracted into a string-returning `translate(text, levels)`,
  shared by `print_translated` and `siriusian`, against the global `scan_levels`), so signs/labels
  translate word-by-word as Galaxy scans (the blue keypad's digit glyphs use the raw `siriusian_word`
  to stay alien — that's the puzzle; all-alien labels stay byte-identical in plain transcripts).
  **Remaining:** the remaining in-prose sub-objects (signs,
  poster, reactor levers) as examinable objects; the `obscure`/`revealed` real-name swap. (The
  log's control-code reveal is done — purple-door slice 2. The **Control Room furniture** —
  central control panel, screens, chair, launch/self-destruct buttons — is now ported as
  examinable scenery; see the cyborg/endgame item.)
  ~~**Migration (native phobos JS → Lamp)**~~ **DONE** (memory
  `phobos-native-to-lamp-migration`). Phase 1: general lib/sys primitives `length`/
  `char_at`/`code_at`/`substring` (codepoint-based, 0-indexed) + the `mod`/`div` operators;
  golden `strops1`. Phase 2: the whole Siriusian cipher + `token_difficulty` +
  `print_translated` rewritten in pure Lamp on those primitives, **byte-identical** to the
  deleted native (door label + diary); the cipher's reversal is string-prepend (`out = g +
  out`), no list append. `textual`/`content`/`scan_level`/`scanned` added to `item` by
  **reopening the type in Phobos** (advent untouched, `document` dropped); `is_textual` is
  now the pure-Lamp guard `self.target.textual`. `lib/phobos/index.js` is gone. **`x is
  Type`** operator still deferred (not needed). **Test gap:** the filter is phobos-lib-
  specific, so no golden (the Phobos sample isn't golden-discoverable — would need extending
  golden discovery to `sample/<dir>/`). See `sample/phobos/PORTING.md`.
- **BUG: assignment to a bare object-name field target emits undefined JS.**
  `SomeObject.field = value` (where `SomeObject` is a bare object reference, not a
  local/global/`self`) emits `lamplighter.setField(SomeObject, …)` with
  `SomeObject` as an undefined JS identifier → runtime `ReferenceError`. *Reads*
  resolve correctly (`getObject(...)`); only the **assignment-target head**
  doesn't. Fix: in `emitStatement`'s `AssignStatement` branch
  (`src/lantern/emitter.js:822`), resolve an object-name head via `getObject` like
  expression position does (thread the object-name set in). Workaround: bind to a
  `let` or use `self.<slot>`. Found porting Phobos hacking.
- **Hacking subsystem (Phobos port) — in progress.** The KIM tool + `hack` verb +
  green-door instant bypass are done (`sample/phobos/lib/phobos/hacking.lamp`):
  `hack green door` opens it and `go north` then works. **`press <n>` input
  unblocked (option B DONE):** primitive-typed action slots are implemented
  (`resolveSlots`/`literalSlotValue`; golden `numslot1`). **Yellow door DONE:** the
  `press` action (gated on `adhered`), the 9-button `list` state, the per-key
  flip-sets, the keypad display, and solve→open all work end-to-end
  (`lib/phobos/hacking.lamp`); dogfoods number slots + list literals + element
  assignment. **Red door DONE:** a second nine-button Lights-Out reusing the same
  engine (shared `nine_solved()` goal) but starting with button 6 lit and a distinct
  harder flip-set; solves end-to-end (sequence 1,2,3,5,7) and opens south to the
  armory. **Blue door DONE:** a *sort-by-swap* (different mechanic) — nine shuffled
  Siriusian digit-glyph labels (`number_order`), press two to swap their labels, goal
  is to sort. Dogfooded the **general `random(n)` native** and the **general
  `shuffle(list)` native** (both lib/sys, on the engine's seeded/save-captured RNG; goldens
  `random1`/`shuffle1`); `shuffle_labels()` calls `shuffle(number_order)`. **Locker DONE:**
  a four-button toggle (each press flips only
  itself; start `{red,blue,blue,red}` → press 1 and 4) that opens a **container** and
  reveals the **diary** sealed inside. Dogfooded a general advent feature — a **closed
  container hides + seals its contents** (`contents_of` closed-check + core
  **`registerScopeBarrier`** seam; golden `closedbox1`); South Barracks ported in full.
  **Remaining doors:** purple (pick-5-of-16, needs the scan/control-code system —
  deferred). `read` is now an advent synonym for `examine` (reading the diary shows its
  description). Locker deferreds: pod scenery, locker synonyms.
  Also deferred: `score 1` per solve
  (Galaxy Banner + notification, with scoring); the RESET button (re-press undoes,
  so not required). Globals use natural multi-word names (`kim_adhered_to`,
  `nine_buttons`) now that the multi-word-global bug is fixed (see below).
- **Library file ordering / cross-file type topo-sort.** Lantern emits type
  definitions in file-glob (alphabetical) order with no cross-file topological
  sort, so a subtype declared in an alphabetically-earlier file than its parent
  fails at load (`Parent type is not defined: …`). Hit while adding `doors.lamp`
  (worked around by putting the `door` type in `types.lamp`). Fix options: (a)
  **topologically sort type declarations by inheritance before emit** (automatic,
  robust — the only ordering constraint is parent-before-subtype; objects /
  relations / globals already resolve order-independently); or (b) a **library
  manifest** declaring file order. Lean (a). **Where:** `src/lantern/{index,emitter}.js`. See `sample/phobos/PORTING.md`. **Where:** `lib/advent/`,
  `src/lantern/*`, `src/lamplighter/index.js`, devdocs.
- ~~**Scoring / rank subsystem (motivated by the Phobos port).**~~ **DONE.** advent now has a
  general score subsystem (`lib/advent/scoring.lamp`): `score`/`max_score` globals, `award_points(n)`
  (+ the standard notification), and the out-of-world **SCORE** verb (`request_score`). Phobos
  (`lib/phobos/scoring.lamp`) wraps it as **`galaxy_score(n)`**, which flashes the "Galaxy Jones"
  ASCII figlet (`fixed()` monospace) on every point-gain, and maps the final score to a **rank**
  (Cyborg Bait → Queen of Mars) shown in the end banner. `max_score = 11` (six puzzle solves,
  alliance, arming, the launch, and **+1 per unconscious commando carried into the ship** — so
  Queen of Mars *requires saving both*: punch + carry them, don't shoot; shooting both caps at 9,
  faithful to I7). `test endgame` saves both → all eleven → Queen of Mars. The suit-smash bypass
  earns nothing. Two fixtures that used `score` as a local verb were renamed (outofworld1 → `ping`).
  **Deferred:** the power/action banners (Powerup/Galaxy Banner extras).
- **Localization to French — in progress (`devdocs/i18n.md`).** Goal: a playable French
  Cloak of Darkness. **Part 1 DONE (2026-06-26):** the compile-time **locale switch** —
  `--locale <tag>` flag (also `--locale=<tag>`) > a `locale "<tag>"` source declaration >
  the `en-US` default; picks the locale dir filling the post-`sys` slot. New `locale` keyword
  → inert `LocaleDecl` (read in a pre-pass, mirroring `lib` gathering); a library may ship
  per-locale override files `lib/<lib>/locales/<tag>.lamp` (loaded after its defaults, so
  `NAME:"…"` message overrides win last-wins; en-US default unchanged). Clear "pack not found"
  error. Tests: parser units (LocaleDecl + reject unquoted); 148 golden invariant.
  **Part 2 DONE (2026-06-26):** `lib/fr-FR` grammar pack — gendered articles (le/la/l'/les,
  un/une/des, elision before vowel/h via a `gender` field), French list prose (" et ", no serial
  comma), copula est/sont, metropolitan number words (soixante-dix/quatre-vingts), case
  transforms. Defines every native `lib/en-US` does; verbs aren't conjugated (translation spells
  them out — `conjugate` is identity, vocab mirrors en-US so English default templates parse).
  Test: golden `frlocale1` (selected via a `locale "fr-FR"` declaration; 149 golden green).
  **Part 3 DONE (2026-06-26):** `lib/advent/locales/fr-FR.lamp` — French overrides for every named
  advent message (take/drop/wear/doff/put-on reports + failures + parentheticals, inventory
  header/empty/`(worn)`, darkness line, room-contents frame). Supporting: named the darkness line +
  contents frame in `rooms.lamp` (en-US invariant); inventory row now uses the locale's `indefinite`
  not advent's English-only `with_article` (en-US invariant; localizes to "une clé"); added a
  `gender` field on advent's `physical` type (default masculine). Also moved the recursive
  nested-contents parenthetical out of advent into a locale native `contained_phrase(container,
  inner, count)` (replacing the English-built `render_thing` concat + `prep_for`): en-US builds
  "(in which is …)", fr-FR the gender-agreed "(dans laquelle se trouve …)". Tests: goldens
  `fradvent1` (end-to-end French responses) + `frnested1` (nested containers/supporter, gendered
  relative pronoun + dans/sur + se trouve(nt)); 151 golden green, en-US byte-invariant.
  **Layer 3 DONE (2026-06-26):** French command grammar in the same pack — verb synonyms via
  `understand "…" as ACTION` (additive: English still matches) and direction words by reopening the
  `direction` objects. Two general fixes: UTF-8 stdin in the plain host (`plain.js` read a byte at a
  time and decoded each alone, mangling "clé"; now decodes the whole line) and routing the engine's
  parser feedback ("You can't see any such thing." / "I don't understand that.") through the
  `message` registry so a pack overrides them (`parser_cant_see`/`parser_no_understand`). Test:
  golden `frverbs1` (French commands → French responses + localized parser failures + accented noun
  match); 152 golden green, en-US byte-invariant.
  **Layer 4 DONE (2026-06-26):** `sample/cloak_fr.lamp` — a forked French Cloak of Darkness (inline
  prose translated, objects given `gender` + `understand` synonyms, custom French verbs `lire`/
  `accrocher … à …`). Plays fully in French. To finish the banner, advent's startup/end prose moved
  to named messages (en-US byte-invariant), overridden in French: `banner_by`/`banner_version`
  (split around game-field interpolations), `story_won`/`story_lost` (end_story_rules), `quit_prompt`.
  Test: golden `cloak_fr` (winning path); 153 golden green. **i18n COMPLETE** across all four layers.
  **Remaining gaps (minor):** game title can't be localized (banner prints the ASCII identifier — needs
  a title field on the `game` type); the disambiguation prompt + unbound-pronoun message interpolate
  runtime values (need interpolable message values); out-of-world meta-verbs (quit/undo/save/restore)
  are English-keyed (rides on TODO item 2's "move out-of-world verbs into lib"). **Where:** `sample/`,
  `src/lamplighter/index.js`, `lib/advent/`.
  **Follow-up (2026-06-26):** default action messages when none is defined — `examine` of an object
  with no description prints `examine_nothing` ("[We] [see] nothing unusual about [the act.target]."),
  and a room with no description shows just its name (describe_room skips the empty line). Added `see`
  to the locale verb vocab for the `[see]` sugar; French override `examine_nothing` phrased to avoid
  the `de`/`à`+article contraction gap (see i18n.md Pending). Tests: goldens `examine_nothing1`
  (en-US) + `frexamine1` (fr-FR); 155 golden green.
- ~~**Named messages: convert advent's non-action strings.**~~ **DONE (2026-06-26):** all of
  advent's non-action player prose is now named (for the French translation, see the localization
  item above + `devdocs/messages.md`): the darkness line + room-contents frame (`rooms.lamp`), the
  title-banner connectives + `quit_prompt` (`startup.lamp`), the end-of-story banner (`globals.lamp`
  `story_won`/`story_lost`), and the engine's parser feedback (`parser_cant_see`/
  `parser_no_understand`). (The inventory item rows stay plain — they reference a loop-local, not
  `act`.) Remaining un-named: the host-rendered status line and the ASCII game-title banner (needs a
  `game` title field) — both noted under the localization item.
- ~~**Nested objects need a body / reference form (step-5 limitations).**~~ **DONE (2026-06-26):**
  **smart disambiguation** — a line in an object body is a nested placement when its leading
  token is a known **type** that is **not** a known **field name** (so `item hook` nests but
  `article proper` stays a field). Drops the `:`-body requirement: a bodyless `TYPE NAME` emits
  an empty ObjectDecl + `contains`, which **object reopening** merges with the object's real
  declaration if one exists — so the same form is both a fieldless leaf *and* the reference
  form. Prescan now collects field names (light type-body tracking) + an object/other block
  stack for nested-name registration; both type names and field names thread to the parser.
  Remaining edge: a type whose name is also used as a field name can't be smart-nested (give it
  a body or use top-level `contains`). Tests: prescan + parser units; `nestlist1` now uses
  bodyless leaves (output invariant); 146 golden green. Dual-nature containers (per-placement
  in/on) remain deferred — orthogonal, additive later. **Where:** `src/lantern/{prescan,index,
  parser_rd}.js`.
- ~~**Recursive contents listing for nested containers (pure-Lamp via `map_strings`).**~~ **DONE
  (2026-06-26):** added `map_strings` (lib/sys) + exposed `format_list` to Lamp (lib/en-US,
  normalized via listItems so a_list/the_list still pass arrays); pure-Lamp `render_thing`/
  `render_contents`/`prep_for` in `lib/advent/rooms.lamp`; `contents_of` generalized room→
  `physical`. Output e.g. `a chest (in which is a thimble (in which is a marble))`, supporters
  "on which", plural copula via `are`. Tests: golden `nestlist1` (deep nesting + supporter +
  plural); `doublecontainment` golden updated (now shows the nested coin); flat-case room
  listings invariant; 146 golden green. Decisions as planned (D2 closed deferred, D6 tree
  assumption).
  **Enabling primitive (lib/sys):** `native function list<string> map_strings(list<object> xs,
  function fn)` → `makeList(listItems(xs).map(x => fn(x)))`. General, reusable, sidesteps
  generics (object→string), and proves natives can call Lamp function refs.
  **Lister (pure Lamp, lib/advent):** `render_contents(holder) = format_list(map_strings(
  contents_of(holder), render_thing))`; `render_thing(x) = indefinite(x)` plus
  `" (" + prep_for(x) + " which " + are(inner.size) + " " + render_contents(x) + ")"` when
  `contents_of(x)` is non-empty (mutually recursive; `render_thing` passed by name). `prep_for`:
  `x.supporter ? "on" : "in"`. Wire `list_room_contents` → `[render_contents(r)]`; generalize
  `contents_of` room→`physical`. Prose stays in the locale (`indefinite`/`format_list`/`are`).
  **Decisions:** D1 prep from `supporter` flag (dual-nature deferred); D2 closed containers
  deferred (no open/close actions yet; `closed` is box-only); D3 exclude scenery (contents_of
  already does); D4 keep `describe_supporters` separate; **D5 = pure Lamp + `map_strings`** (no
  advent renderer native); D6 assume containment is a tree (pure-Lamp visited-set can't thread
  through `map_strings`; cycle would loop — matches Inform, note limitation). **Watch:**
  `list<item>`→`list<object>` element-subtyping at the `map_strings` call (type `list<physical>`
  if strict). Tests: golden box/pedestal example + empty container + singular/plural copula;
  flat-case goldens stay invariant. **Where:** `lib/sys/{functions.lamp,index.js}`,
  `lib/advent/rooms.lamp`.
- ~~**Drop advent's duplicated `display_name` / `with_article` (layering smell).**~~ **DONE
  (2026-06-26):** advent's `display_name`/`with_article` (which shadowed/overlapped the locale's
  `display_name`/`indefinite`) are deleted; the locale now owns all naming/articles. The two
  callers were retired during fr-FR localization: the inventory row → the locale's `indefinite`;
  the supporter listing → a new locale helper `supporter_phrase` (en-US "On the hook is a cloak.",
  fr-FR "Sur l'étagère se trouvent …"). `describe_supporters` now decides only which supporters
  and what rests on them. en-US byte-invariant; French covered by the `frnested1` golden.
- ~~**Object reopening (merge same-named `ObjectDecl`s) — reopen e.g. `yourself`.**~~ **DONE
  (2026-06-25):** emitter merges same-named ObjectDecls into one `createObject` with unioned
  fields (mirrors the `mergedTypes` merge). Decisions implemented as agreed: **implicit** (any
  duplicate name merges), **type must agree** (mismatch → located compile error; added
  `filePath`/`lineNumber` to ObjectDecl for it), **last-wins** field conflict in source order
  (so a game reopen overrides a library object's field). Tests: golden `doublecontainment`
  (reopen `yourself` to add a nested hat; deep coin-in-crate containment) + compile-error golden
  `reopen_type_mismatch`. Docs: specs.md "Reopening an object".
- ~~**Bare boolean-attribute shorthand — `wearable` for `wearable true`.**~~ **DONE (2026-06-25):**
  one line in `parseObjectBody` — a field name with no value desugars to `= true`
  (`at("NEWLINE") ? createBooleanLiteral(true) : parseSimpleValue()`). Purely additive (a bare
  field line was a parse error before); no emitter change; no collision with the nested-object
  branch (needs a `:`). Validation is free — a bare non-bool field errors as "expects string,
  got bool" via `checkObjectDecl` (kept the borrowed message; didn't add a tailored one). Tests:
  parser unit + golden `boolattr1` (wear a `wearable` cloak, scenery rock refuses take, explicit
  `scenery false` lamp still takeable). Docs: specs.md object-declarations.
- ~~**Parser: allow property access on a call/parenthesized result — `holder(p).lighted`, `(EXPR).field`.**~~ **DONE (2026-06-25):** factored a `collectTrailingFields()` helper in `parser_rd.js`; the call-result branch of `parseIdentExpr` now wraps a `CallExpr` with trailing dots in a `MemberAccess` (parenthesized branch refactored onto the same helper). Emitter already emits `(inner).field`; checker's `applyFieldToType` resolves the field off the call's return type (tolerant/unknown otherwise — no error). Simplified advent `in_darkness` back to `not holder(p).lighted`. Tests: two parser units (call result, chained + parenthesized). `go`'s `let here` stays — that's a *different* restriction (function calls disallowed in relation-query slots, by design). All 141 golden + parser green.
- ~~**Nested object-in-room syntax (step 5).**~~ **DONE (2026-06-25):** a `TYPE NAME:`
  body line (leading token a declared type, with a `:` body) inside an object body
  declares a nested object placed via `contains ENCLOSING NAME`. Implemented: a
  cross-file **type-name prescan** (`prescanTypeNames`, merged in index.js before the
  main prescan so a game can nest a type from lib/advent) + nested **object-name**
  collection (colon-form only, so forward refs to nested objects resolve); a
  `parseObjectBody` branch that hoists the nested ObjectDecl + a `contains` RelationAssert
  (identical to hand-written placement; recurses for deep nesting). The trailing `:` is
  the disambiguator — a body-less `TYPE NAME` stays a field assignment (so `article proper`
  works where `article` is also a type). **Reference form deferred** (body-less `TYPE NAME`
  is ambiguous with field assignment); use a top-level `contains`/`move` to place an
  existing object. Tests: golden `nest1` (scope/take/examine through nesting) + parser &
  prescan units. Docs: specs.md "Nested object declarations". **Where:**
  `src/lantern/{prescan,index,parser_rd}.js`.
- **Output pagination ("[more]") — done, with one gap.** All three interactive hosts
  pause long output a screenful at a time (plain on a TTY, the TUI, and the web shell;
  design in `devdocs/sandbox.md` → "Output pagination"). Known gap: it relies on the
  worker blocking at the next prompt, so a game that prints a screenful and then *ends*
  with no trailing prompt can't be paged in the event-driven hosts (TUI/web) — the end
  message clears the pause. If that matters, have the runtime emit an explicit
  "end-of-output" checkpoint the host can pause on, or page on `done`. **Where:**
  `src/lamplighter/sandbox/backends/`, `src/lighthouse/web/shell.js`.
- **VS Code syntax highlighting (scaffolded).** A declarative TextMate-grammar
  extension lives in `editors/vscode/` (manifest + `language-configuration.json` +
  `syntaxes/lamp.tmLanguage.json`); no deps, loads via `F5`/`--extensionDevelopmentPath`.
  Token model is derived from `tokenizer.js` `KEYWORDS` and `parser_rd.js` `PHASE_WORDS`.
  **Next:** (a) add grammar snapshot tests (e.g. `vscode-tmgrammar-test`, dev-only) so
  the scopes don't silently drift from the compiler; (b) confirm the TextMate grammar
  matches the now-supported **multi-line string literals** (the tokenizer spans lines
  and dedents continuation lines as of this change — verify the grammar highlights a
  string across lines and doesn't treat a `#` inside it as a comment); (c) optionally a
  Language Server reusing the tokenizer/parser for diagnostics + go-to-definition.
  **Where:** `editors/vscode/`.
- ~~**Reassigning a multi-word (underscore) global fails.**~~ **FIXED.** Globals are
  keyed by their coerced name ("my score"), but an assignment target's head is the
  raw identifier ("my_score") — so both the **checker** (rejected the assignment) and
  the **emitter** (silently emitted a dead bare `my_score = …`) missed the global.
  Both now coerce the head at the six `globalNames.has` sites (checker) and the
  AssignStatement / PropertyAccess heads (emitter); `setGlobal` uses the coerced key.
  Locals keep the raw name (no-shadow guarantees no collision). Regression golden
  `multiword_global1` (reassignment + multi-word global field read run at runtime).
  The two `coerceName` imports were added to checker.js/emitter.js.
- **Optional action slots / unfilled object slot reads as `none`.** An action whose grammar has
  some syntaxes with a `[target]` slot and some without (an *optional* noun — e.g. one `fly` action
  serving both "fly" and "fly [ship]") doesn't work today: for the bare syntax the object slot is
  left unfilled, and an unfilled object slot does **not** compare equal to `none` (so `if self.target
  == none:` is false and the bare case falls through). Found porting Phobos FLY — worked around by
  splitting into two actions (`fly` + `fly_thing`) distinguished by arity. Make an unfilled object
  slot read as `none` (and/or allow a slot default like `physical target = none`), so optional-slot
  actions are expressible as one action. Verify against the primitive-slot path (`int`/`string` slots
  already backfill zeros). **Where:** `src/lamplighter/index.js` (`resolveSlots` / slot defaulting),
  specs.md (action slots).
- **Command-rewrite hook (I7's "after reading a command").** Inform lets a game rewrite the raw
  player input before parsing — Phobos uses it so bare "human"/"i'm human" become "say I am human",
  and the loyalty answer can be a bare "yes"/"no". Lamp has no such seam: `run_command(line, actor)`
  parses the line as-is. Add a hook the game can contribute to (rewrite/normalize the input string
  before tokenizing) — e.g. a `rewrite_command_rules(string line) -> string` rulebook the loop runs
  on the input first, or a registered Lamp callback on the parse path. Enables the **bare-word SAY
  shortcuts** (the only Phobos parity gap left from the SAY/ANSWER work — today the player types "say
  yes" / "say I am human") and is generally useful (typo/synonym fixups, "x"→"examine" style aliases
  beyond grammar). **Where:** `src/lamplighter/index.js` (`runCommand`/`run_command`), specs.md;
  Phobos would add a rule mapping the bare utterances in `guard_persuasion.lamp`.
- **Demonstrative sugar `[that]`/`[those]` (agreeing with a target).** Inform's refusal
  messages refer back to the noun with a number-agreeing demonstrative — "[We] can't touch
  [regarding the noun][those]." renders "can't touch that" (singular) / "can't touch those"
  (plural). advent has no such sugar, so the ported TOUCH/TAKE refusals from `Can't Touch
  This.i7x` ([lib/advent/actions.lamp](lib/advent/actions.lamp), `touch_cant`/`touch_cant_reach`/
  `take_cant_unfeelable`/`take_cant_reach`) use the object **name** instead ("can't touch the
  wall") — same meaning, advent house style, but not byte-faithful to the I7 wording. To close
  the gap: add a `[that]`/`[those]` template (locale native, agreeing with the `[regarding]`/named
  subject like `[they]`/`[them]` do — `it`/`they` set the agreement; demonstrative reads "that"
  singular / "those" plural), then swap the refusal messages to use it. Also a localization win
  (French ce/cette/ces). **Where:** `lib/en-US/index.js` (+ `lib/fr-FR`), `lib/advent/actions.lamp`.
- **Remaining pronouns (`him`/`her`/`them`).** `it` is implemented with
  explicit `direct` slot marking (the `direct item NAME` annotation on action
  field declarations sets the antecedent; at most one per action; enforced at
  compile time). The gendered/plural pronouns need a `pronoun` field (and
  `plural` for `them`) on `thing` plus per-pronoun antecedents. Also open:
  letting the game (not just the player) set the antecedent when it describes
  an object. **See:** `devdocs/game_parser.md` (Pronoun `it`; Open questions →
  Pronouns).
- **Named-rule replacement.** Override suppression works via bare-`stop` +
  author-before-library ordering (now shared by actions and rulebook
  contributions). Replacing *one* library rule out of several (without depending
  on registration order) needs named rules. See `devdocs/rulebooks.md` roadmap
  (*Next — identity & ergonomics*).
- ~~**`list<T>` field types end-to-end.**~~ Exercised now via mutable lists
  (golden `listmut1`): a `list<int>` global, literal init, element read/write, undo
  durability.
- ~~**List literals + element assignment (mutable lists).**~~ **DONE.** `[a, b, c]`
  literal (parser nud on `[`; `ListLiteral` → `makeList`; checker infers `list<T>`)
  and `xs[i] = v` element assignment (indexed `AssignStatement` target → mutate
  `.items[i]` in place, mirroring the `IndexExpr` read). Durable across undo/save —
  `encodeValue` deep-copies list items at capture (verified by golden `listmut1`).
  Built to unblock the Phobos hacking button puzzles. Docs: specs.md. **Two limits
  found:** (1) a `[…]` **index inside a text substitution** isn't supported (the
  substitution scanner matches the first `]`; bind to a `let` first) — a tokenizer
  fix if wanted; (2) the pre-existing emitter bug (assignment to a bare object-name
  target) is unrelated but adjacent.
