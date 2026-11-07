# Localization

A Lamp game's language is a compile-time choice. The toolchain ships two
locale packs — `en-US` (the default) and `fr-FR` — and the architecture
keeps every piece of English out of the engine, so a new language never
needs a compiler change.

## Selecting a locale

```lamp
locale "fr-FR"        # in the game source: this game's language
```

```sh
lantern game.lamp --locale fr-FR    # or per build; the flag wins
```

The locale pack loads beneath every library, replacing the grammar layer;
libraries then load their own translation files for that locale
automatically. A missing pack or an incomplete translation is a **compile
error** — a partial translation fails the build rather than shipping
mixed-language output.

## What the locale provides

Four layers switch together:

1. **Grammar** — articles, pronouns, verb conjugation, list prose
   ("a, b et c"), numbers. Under fr-FR, `[the X]` elides ("l'étagère"),
   `[prendre]` conjugates against the current subject, and copulas agree.
2. **Library messages** — every named advent message in French
   (`take_report: "Pris."` and 170-odd friends), loaded from
   `lib/advent/locales/fr-FR.lamp`.
3. **Command grammar** — French verbs (`prendre`/`poser`/`examiner`/
   `aller`…) and direction words (`nord`, `sud`…), added via the same
   `understand` mechanism games use. English commands still work too.
4. **Your game's prose** — which only you can translate.

## Localizing your game

The worked example is the French Cloak of Darkness —
[sample/cloak_fr.lamp](../../sample/cloak_fr.lamp) beside the English
original. The game-side work:

- **Translate your prose** — descriptions, custom messages, startup text.
- **Gender your nouns** — gendered locales read `grammatical_gender`
  (`"feminine"`/`"masculine"`, a property of the noun, separate from
  `pronouns`) for le/la and un/une agreement:

  ```lamp
  item cle:
      printed_name "clé"
      grammatical_gender "feminine"
      understand "clé"
  ```

- **Add vocabulary for accented names** — the parser matches identifier
  and `understand` tokens, not `printed_name`, and identifiers can't
  carry accents; the `understand "clé"` line makes "prendre clé" work.
- **Translate your custom grammar** — your own `understand` lines and
  action syntax (`lire [target]`, `accrocher [put_item] à
  [destination]`).

Everything else — French refusals, French banner connectives, French
parser feedback — comes with the locale.

## Writing a new locale

A locale pack is a library directory (`lib/<tag>/`) defining the standard
grammar natives (`the`, `indefinite`, `conjugate`, list joining, …) plus
`verb` and `sugar` declarations that map template tokens to them — the
compiler bakes in no language, so `[du]`, German case articles, or
whatever your language needs are declarable. Libraries ship their message
translations as `locales/<tag>.lamp` files, and the completeness check
tells you exactly which keys remain. The `fr-FR` pack
([lib/fr-FR/](../../lib/fr-FR/)) is the reference implementation. This is
substantial work — the deep details live in `devdocs/i18n.md`.

---

This concludes Part IV. Continue with
[Part V — Testing and Shipping](../README.md#part-v--testing-and-shipping).
