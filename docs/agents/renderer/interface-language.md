# Interface language

Visible text through `t()` (#329), the catalogues, number and date formats, and how to add a language.

- **Interface language** (#329): visible text goes through `t('area.key', params)`
  (`packages/shared/i18n.js`, `window.t` in the page, `I18n.t` in Node), never inline: since #330 every
  file of `apps/desktop/renderer` and the `packages/shared/` modules with screen text are checked
  (`test/i18n-every-screen-330.test.js`), so a new view with inline visible text fails. A table of
  labels at load time keeps its ids and calls `t()` where it is drawn; a vm test sandbox gets `t`
  through `test/i18n-sandbox.js` (`withI18n`). To add a string, add its key to `packages/shared/i18n/en.json` (English, the source) and to
  each translation (`pt-BR.json`); a missing translation shows the English text. `{name}`
  placeholders come from params; a plural is `{ "one": …, "other": … }` picked by `params.count`.
  Static markup of `index.html` uses `data-i18n="key"`. Numbers, percentages, costs (US$) and dates
  use `I18n.formatNumber` / `formatPercent` / `formatCost` and the current language
  (`I18n.getLanguage()`); app.js's `fmtNum`/`fmtCost`/`timeOf`/`dateOf` already do. A language
  change re-renders every open window (`interface-language.js`, over the `settings:changed` push):
  a screen redraws from its state, so read `t()` when drawing, never once at load. To add a
  language: a `<code>.json` next to `en.json` plus its code in `PAGE_LANGUAGES` (`i18n.js`); the
  Interface select lists it. Never translated: user content, workflow YAML texts, skills, agents'
  messages, engine errors and logs. Captures: `npm run screenshot -- --lang pt-BR`,
  `npx electron scripts/smoke.js <out.png> --lang pt-BR`; both default to English.
