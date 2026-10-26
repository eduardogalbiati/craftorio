# fronts/ai: agent notes

Read first: [renderer.md](../../docs/agents/renderer.md) (the topic index: read the subtopic you
touch, always [ui-conventions.md](../../docs/agents/renderer/ui-conventions.md) for a screen).

- **Check a screen** with `npm run screenshot -- --view <view> …` (its seed module in
  `scripts/screenshot/views/`) or `npx electron scripts/smoke.js <out.png>`, never a hand-written
  script that launches the app, and never real terminals or real runs.
- **A screen is a folder** `views/<view>/` calling `registerView`; run `npm run docs` for the page's
  file lists, never edit `index.html` by hand. Visible text goes through `t('area.key')`.
- **A front never requires another front**: shared code goes to `packages/ui-kit/` or
  `packages/shared/`; this front's engine side (`engine/`) is reached only through `window.api`.
