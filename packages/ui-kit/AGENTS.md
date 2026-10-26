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
