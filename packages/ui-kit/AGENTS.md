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
- **A ⋮ / ⋯ menu is the shared menu** (`menu.js`, look in `menu.css`, #748), never a screen's own.
  `Menu.menuHtml(items, { label, testid, className })`: entries `{ id, icon | iconHtml, label, title,
  disabledReason, danger, testid, attrs }` and `{ divider: true }` (no double divider); a refused entry
  stays, `aria-disabled`, its reason in its tooltip only. `Menu.bindMenu(menuEl, { onPick, onClose,
  anchor })`: arrows, Home / End, Enter, Escape, outside click; `close()` unbinds. Example:
  `Menu.menuHtml([{ id: 'up', label: t('x.up') }, { divider: true }, { id: 'rm', label: t('x.rm'),
  danger: true }])`, then `Menu.bindMenu(menuEl, { anchor: button, onPick: act, onClose: hide })`.
  The artifact menu and Discovery's `.bl-menu` move to it later.
- **"What is happening now" is the shared activity line** (`activity-line.js`, look in `activity-line.css`,
  #781), never a screen's spinner and text. `ActivityLine.html({ state, text, summary, meta, reason, retry,
  testid })`, state `pending | running | done | failed | skipped`: a shine crosses the running text and its
  ellipsis animates (no "…" in the text), done is a ✓ with the summary, failed the reason with `retry: { label,
  attrs }`. `ActivityLine.paint(el, opts)` redraws in place and leaves the shine running when only `meta` moved.
