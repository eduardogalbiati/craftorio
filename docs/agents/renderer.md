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
- **One folder per screen** (#78, moved in slices; Settings and Usage so far):
  `src/renderer/views/<view>/<view>.js` + `<view>.css`. The script ends with
  `registerView({ id, nav: { label, icon, order, title }, markup, modals, mount, show })`
  (`view-registry.js`, loaded before `app.js`): `markup` is the screen's whole
  `<section id="view-<id>" class="view hidden">`, added to `main.content`; `modals` its own dialogs,
  added to the body; `nav` its sidebar entry, placed by `order` among the static entries'
  `data-order` (10 = Sessions … 130 = AI Arena: pick a free number between two); `mount()` wires its
  controls once; `show()` runs on each `showView(id)`. Sidebar clicks are delegated, so registered
  entries need no wiring. View scripts load after `app.js` and use its globals (`$`, `esc`, `state`,
  `api`, `errMsg`, `openModal`…); keep app-wide pieces (top-bar widgets, `loadUsage`, shared tables)
  in `app.js`, and shared tokens and components (buttons, badges, `.s-group`/`.s-row`, `.switch`,
  tables, scrollbars, checkboxes) in `style.css`. **Adding a screen**: create its folder, add its
  `<link>` and `<script>` lines to `index.html`, a `VIEWS` entry in `scripts/screenshot.js` and a
  `docs/screens/<view>.md` fragment; `index.html`'s nav, `showView` and `init()` stay untouched.
- Several runs can be in progress: `state.runs` (run id → view: run, sessions, steps, log, gates) and
  `state.runId` (the one the Run screen and the top bar show); `state.run`, `state.sessions`… read the
  selected one. Route anything run-specific by `ev.run_id` and pass the `runId` to `stopRun`,
  `resolveApproval` and the terminals. There is no approval dialog: a gate is answered inside its run
  (the run chats, or the gate card on its Run screen, `renderRunGates`); elsewhere the Run badge, a
  dismissable toast, the dashboard's pending approvals list and a desktop notification say it waits.
  Nothing a run raises may cover the screen: dialogs are for the user's own clicks.
- **Where run state comes from** (#74): a run's view is built only by `onEvent`, the reducer of
  live `run:event`s, and `hydrateRun(runId)` replays the recorded events (`runs:events` with
  `activity: true`: stream items compacted, the rest of the CLI output stays on disk) through the
  same reducer, with `replaying` set (no toasts, no list reloads, one render at the end). It runs
  for every run in `runs:active` when the window loads or reloads (`loadActiveRuns`), for a run first
  heard of mid-way (`viewOf`) and for a past run opened in Details (`openPastRun`, `v.past`:
  read-only, an unfinished one becomes interrupted). Live events that arrive during the replay wait
  in `hydrating` and follow in order; each view keeps `lastSeq` and ignores a live event whose `seq`
  is at or below it. Gates still pending after a replay show their toast; the engine's list
  (`runs:active` gates) stays the source of truth.
- **Run titles and PRs** (#84): `state.runMeta` (run id → `{ title, customTitle, pr }`) is fed by
  `runs:list`, the project's runs, `runs:active`, Backlog data and the `run:meta` push (PR state
  changes, a title set); every place reads it through `runTitle(r)` / `runLabel(r)` / `prBadge(r)`
  in `app.js` (exported on `window` for `run-chat.js` and `backlog.js`) so they agree. Drawing is in
  `run-badges.js` (pure: PR glyph and state colours, the default title). A PR without a state is
  asked with `askPrStates` (`runs:prState`, cached by the service). The title's pencil
  (`runTitleHtml`, `[data-title-edit]`) and the PR link (`[data-pr-url]`) are handled by one
  capture-phase click listener, so they never select or expand the row around them.
- Write & Review and AI Arena keep their own chat screens; every other run uses the run chat
  (`run-chat-model.js` is pure and unit-tested, `run-chat.js` draws it).
- **How a run is opened**: one global run view, `state.runView` (`'details' | 'chat'`, saved in
  localStorage `multiagent.runView`). Every way of opening a run (sidebar Run menu, toasts,
  notifications, "View run", Backlog run links, the gate badge, a resume) goes through
  `selectRun(runId)` / `showRun(runId, { workflow, running })` in `app.js`, which open that run's
  chat (Write & Review and AI Arena: their own screens) or its Run screen (a run this window does
  not follow: loaded from disk by `openPastRun`). Only the explicit
  switches change the choice (`setRunView`): the Run screen's Chat button, the chat's Details
  button and "Open chat". A chat always opens at its latest message ("Jump to latest" while
  scrolled up).
- Check changes by looking at screenshots: `npm run screenshot -- --view <view> [--tab|--mode|--click]
  --out <dir>` opens one screen with demo data and quits by itself (`--ref origin/main` for the
  "before"; usage at the top of `scripts/screenshot.js`). A new view or
  tab goes into its `VIEWS` table, so `test/screenshot.test.js` opens it too. `scripts/smoke.js`
  runs a whole mock run from the Start panel. Never open real CLI terminals or start real runs in
  those checks.
- Artifacts previews images (`kind: image`, read as a data URL; the CSP allows `img-src data:`).
- Test changes with a temporary Electron script (see `scripts/smoke.js`:
  `npx electron scripts/smoke.js <out.png>` runs a mock run and takes a screenshot) and look at
  the screenshots. Never open real CLI terminals or start real runs in those checks. In a fresh
  workspace Developer mode is off and the Simulation box is ignored: set
  `api.setSettings({ developerMode: true })` before clicking Start.
