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
  tables, scrollbars, checkboxes) in `style.css`. **Adding a screen**: create its folder, a `VIEWS`
  entry in `scripts/screenshot.js` and a `docs/screens/<view>.md` fragment, then run `npm run docs`;
  `index.html` stays untouched by hand (its nav, `showView`, `init()` and its file lists).
- **How the files are loaded** (#152): `index.html`'s `<link>`/`<script>` lines for `src/renderer/*`
  and `src/renderer/views/*/*` sit between `<!-- generated:styles -->` / `<!-- generated:scripts -->`
  markers, written by `npm run docs` (`scripts/docs.js`); `node scripts/docs.js --check` (CI) fails
  when they are stale. A new module or stylesheet is a new file plus `npm run docs`. Order, per list:
  the files whose header comment has a `load: early` line (`api-http.js`, `view-registry.js`…,
  `style.css`), then `app.js`, then the other top-level files, then the views, each group sorted by
  path (`x-part.js` sorts before `x.js`). A file that needs another one as it loads (top-level code,
  not a function called later) says so in its header: `load: after duo.js robots.js (why)`; a CSS
  file that overrides another's rules too (`arena.css`: `load: after duo.css`). The vendor files
  (`node_modules`) stay hand-kept outside the markers. The CSP and the packaged app are unchanged:
  the page still lists plain files.
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
  "original"; usage at the top of `scripts/screenshot.js`). A new view or
  tab goes into its `VIEWS` table, so `test/screenshot.test.js` opens it too. `scripts/smoke.js`
  runs a whole mock run from the Start panel. Never open real CLI terminals or start real runs in
  those checks.
- Artifacts previews images (`kind: image`, read as a data URL; the CSP allows `img-src data:`).
- **Artifact images open in the shared viewer** (#145, `image-viewer.js`, math in
  `image-viewer-model.js`): `ImageViewer.open({ title, images: [{ src | file, label, caption }],
  index })`, almost full screen, fitted (never upscaled), click / wheel / + − Fit 100% zoom up to
  400%, drag to pan when zoomed, tabs or ← / → between the two images of an original/modified
  pair, Esc or a click outside closes, right-click keeps the copy menu. Every artifact image must
  use it: give the thumbnail `ImageViewer.THUMB` (hand cursor, "Click to enlarge", focusable,
  Enter opens) and open it on click; no per-screen viewer. Users today: the Artifacts panel and
  the Artifacts screen (`ArtifactsPanel.openImage`). The chat renders no images.
- **The Run screen's tabs** (#109): the Details panel has Session, Events and Artifacts
  (`switchTab`, `#tab-artifacts`, with a count on the tab). The Artifacts tab and the approval
  gate's side panel are one component, `artifacts-panel.js` (`ArtifactsPanel.mount(root, { runId,
  flat, extras })`): the run's files from `artifacts:list { runId }` grouped by kind (newest first
  in a group; `flat` for the gate), a preview in place (markdown, images with their original/modified
  pair from the evidence manifest, TSV as a table, JSON, text) and "Open in Artifacts"
  (`openArtifactsAt`). `onEvent` calls `ArtifactsPanel.refreshRun(runId)` on the events that add a
  file (`ARTIFACT_EVENTS`), so a running run's list follows without a reload. Above the files, the
  run's **Screenshots** (#146, `artifacts:evidence`): the final set by issue, each pair side by side
  ("Original (main)" / "Modified (<branch> @<sha>)") with its caption, older rounds in a collapsed
  History, "No screenshots in this run" without any. `npm run screenshot -- --view run --input
  mode=validated --stop-at developer_check` (and `--view artifacts`) add demo screenshots in two rounds.
- **The gate layout** (#108): a gate whose step has `local_preview: true` (the engine adds
  `run_app: true` to it, configured or not) has two columns, `.run-gate-wide`: on the left a short
  summary (`gateBriefHtml`: the developer's summary and one line per issue, the full message under
  "Full message"), the tools (`gateToolsHtml`: Run App, Show the diff, the worktree) and the
  choices; on the right its Artifacts panel (`gateSideHtml` / `mountGateSides`: the run's files
  newest first, the changed files from `gate:changes`, each opening its diff, and the developer's
  test notes and evidence plan). Stacked under 1100 px. The Run screen and the run chat use the same
  helpers; the sidebar card only links to the run (no room). **Run App** asks `localPreview:info`:
  with a config it starts the preview (`localPreview:start`), without one it opens a setup
  prefilled from the worktree (`suggestConfig` in `src/local-preview.js`) that saves the project's
  `localPreview`. Its state (running / stopped / failed, Stop, Terminal, Open URL, the port-in-use
  error) is painted by `paintGateApps` from the run view's `preview` (local_preview events).
  `npm run screenshot -- --view run --workflow software-development-local-hero.yaml --input
  mode=validated --stop-at developer_check` captures it.
- Test changes with a temporary Electron script (see `scripts/smoke.js`:
  `npx electron scripts/smoke.js <out.png>` runs a mock run and takes a screenshot) and look at
  the screenshots. Never open real CLI terminals or start real runs in those checks. In a fresh
  workspace Developer mode is off and the Simulation box is ignored: set
  `api.setSettings({ developerMode: true })` before clicking Start.

## UI conventions

The general rules (and the visual review of the screenshots) are in the `ui-conventions` skill,
which the software-development developer and evidence agents load (#111). In this app:

- **Reuse what `style.css` has**: `.btn` (`.primary`, `.ghost`, `.sm`), `.link-btn` for small
  actions ("add note", "Edit"); `.badge` (neutral; `.warn`, `.live`, `.p-mock`…) and `.pill`
  (`-idle`, `-running`, `-success`, `-failed`, `-cancelled`, `-interrupted`) for states; `.field`
  (label above the control, `.hint` for the help line, `.row` for a pair); `.s-group`/`.s-row` for
  settings-like lists; `.switch` and `.check` for flags; `.seg` (`.sm`) for a small set of choices;
  `.empty-state`; the standard `select` / `input[type=text]` styles (their focus is on the control).
- **Controls follow the data**: a workflow input with `enum` is a select or a `.seg` toggle, a
  boolean (or an enum of `"false"`/`"true"`) a checkbox, everything else text, with the input's
  `description` as `.hint` (`renderAssignInputs` in `backlog.js` and the Roadmap's Edit form in
  `backlog-roadmap.js` are the models). Short values never get a full-width box.
- **What leads**: titles (issue, run, project) are the headline; workflow files, ids and run ids
  are small badges or links with the full value in `title`. Long titles ellipsize.
- **Edits**: several fields → an Edit form with Save / Cancel; one obvious choice (a mode) → a
  toggle that saves at once; optional text (a note) appears when set or from an "add …" link.
- **Check it**: extend the screen's demo data in `scripts/screenshot.js` with the fields you add,
  then capture the default view and each state with `--click` (e.g.
  `npm run screenshot -- --view backlog --mode roadmap --click "[data-rm-edit]"`). List those
  captures in `evidence_plan` and log the UI choices in the decision log.
