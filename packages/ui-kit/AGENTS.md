# packages/ui-kit: agent notes

Read first: [renderer.md](../../docs/agents/renderer.md) (the topic index: read the subtopic you
touch, always [ui-conventions.md](../../docs/agents/renderer/ui-conventions.md) for a screen).

- **Check a screen** with `npm run screenshot -- --view <view> …` (its seed module in
  `scripts/screenshot/views/`) or `npx electron scripts/smoke.js <out.png>`, never a hand-written
  script that launches the app, and never real terminals or real runs.
- **Visible text** goes through `t('area.key')` with its key in `packages/shared/i18n/en.json` and
  `pt-BR.json`; read `t()` when drawing, never once at load.
- **Requires only `packages/shared/`** (layer `renderer`); stylesheets are global, so class names
  are per screen, and colours and gaps come from the `:root` tokens of `style.css`.
- **A ⋮ / ⋯ menu is the shared menu** (`menu.js`, look in `menu.css`, #748): a new screen draws its
  menu with it, never its own. `Menu.menuHtml(items, { label, testid, className })` draws a
  `role="menu"` from entries `{ id, icon | iconHtml, label, title, disabledReason, danger, testid, attrs }`
  and `{ divider: true }` (empty groups leave no double divider); a refused entry stays,
  `aria-disabled`, its reason in its tooltip only. `Menu.bindMenu(menuEl, { onPick, onClose, anchor })`
  adds the keys (arrows, Home / End, Enter, Escape) and the outside click; `close()` unbinds. Example:
  `wrap.insertAdjacentHTML('beforeend', Menu.menuHtml([{ id: 'up', label: t('x.move_up') }, { divider: true },
  { id: 'rm', label: t('x.remove'), danger: true, disabledReason: why }], { label: t('x.actions') }))`, then
  `Menu.bindMenu(wrap.lastElementChild, { anchor: button, onPick: act, onClose: hide })`. Used by the
  roadmap stage, the roadmap bar and the Backlog card; the artifact menu (`artifact-menu.js`) and
  Discovery's borrowed `.bl-menu` move to it later.
