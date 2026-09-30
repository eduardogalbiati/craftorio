# Renderer (UI)

Read this before changing anything in `src/renderer/`.

- Plain HTML/CSS/JS, no bundler. Libraries loaded with `<script src="../../node_modules/...">`
  (UMD): xterm, addon-fit, marked, DOMPurify. Sandboxed: no Node, only `window.api` (`src/preload.js`,
  or `api-http.js` over the engine server; a test keeps their method lists equal).
- Views: dashboard, sessions, projects (+ project detail with runs/sessions/artifacts), backlog,
  artifacts, workflows (sidebar sub-items Runs / Definitions / Builder, `state.workflowsTab`;
  Definitions shows agents with their session mode and capabilities, Builder is `builder.js`), agents, skills, usage,
  settings, run (+ run chat); terminal dock; supervisor drawer. The code map
  ([code-map.md](code-map.md)) says which file draws which screen.
- Several runs can be in progress: `state.runs` (run id → view: run, sessions, steps, log, gates) and
  `state.runId` (the one the Run screen and the top bar show); `state.run`, `state.sessions`… read the
  selected one. Route anything run-specific by `ev.run_id` and pass the `runId` to `stopRun`,
  `resolveApproval` and the terminals. Gates open the approval dialog only on their run's Run screen
  (elsewhere: the Run badge and a toast).
- Write & Review and AI Arena keep their own chat screens; every other run uses the run chat
  (`run-chat-model.js` is pure and unit-tested, `run-chat.js` draws it).
- Check changes by looking at screenshots: `npm run screenshot -- --view <view> [--tab|--mode|--click]
  --out <dir>` opens one screen with demo data and quits by itself (`--ref origin/main` for the
  "before"; usage at the top of `scripts/screenshot.js`). A new view or
  tab goes into its `VIEWS` table, so `test/screenshot.test.js` opens it too. `--record <s>` saves a
  VP9 WebM of the screen instead (Chromium's MediaRecorder, no ffmpeg), `--start` runs a live
  simulated Arena or Write & Review and `--steps <file.json>` plays clicks and typing during the
  recording. The site's feature videos are made this way (`site/recordings/*.json`; the Usage view
  gets demo runs, since it ignores simulated ones). `scripts/smoke.js`
  runs a whole mock run from the Start panel. Never open real CLI terminals or start real runs in
  those checks.
- Artifacts previews images (`kind: image`, read as a data URL; the CSP allows `img-src data:`).
- Test changes with a temporary Electron script (see `scripts/smoke.js`:
  `npx electron scripts/smoke.js <out.png>` runs a mock run and takes a screenshot) and look at
  the screenshots. Never open real CLI terminals or start real runs in those checks. In a fresh
  workspace Developer mode is off and the Simulation box is ignored: set
  `api.setSettings({ developerMode: true })` before clicking Start.
