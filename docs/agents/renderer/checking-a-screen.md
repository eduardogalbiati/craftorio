# Checking a screen

Screenshots with `npm run screenshot` and their seed modules, `scripts/smoke.js`; never real terminals or runs.

- Check changes by looking at screenshots: `npm run screenshot -- --view <view> [--tab|--mode|--click]
  --out <dir>` opens one screen with demo data and quits by itself (`--ref origin/main` for the
  "original"; usage at the top of `scripts/screenshot.js`). Each view is a seed module
  `scripts/screenshot/views/<view>.js` (#249: its tabs, modes, options, demo data and how its screen
  opens; the interface is described above `VIEWS` in `scripts/screenshot.js`), found by the runner: a
  new view adds its file, a new tab or state edits its own file, never the runner, and
  `test/screenshot.test.js` opens it too; shared demo data and helpers are in
  `scripts/screenshot/helpers.js`. `scripts/smoke.js`
  runs a whole mock run from the Start panel. Never open real CLI terminals or start real runs in
  those checks.
