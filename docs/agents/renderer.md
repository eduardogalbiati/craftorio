# Renderer (UI)

Read this before changing anything in `src/renderer/`.

- Plain HTML/CSS/JS, no bundler. Libraries loaded with `<script src="../../node_modules/...">`
  (UMD): xterm, addon-fit, marked, DOMPurify. Sandboxed: no Node, only `window.api` (`src/preload.js`,
  or `api-http.js` over the engine server; a test keeps their method lists equal).
- Views: dashboard, sessions, projects (+ project detail with runs/sessions/artifacts), backlog,
  artifacts, workflows (one menu entry and one tab per `state.workflowsTab`: Definitions / Runs / Builder / Pipelines;
  Definitions shows agents with their session mode and capabilities, Builder is `views/workflows/builder.js`), agents, skills, usage,
  settings, run (+ run chat); terminal dock; supervisor drawer. The code map
  ([code-map.md](code-map.md)) says which file draws which screen.
- **One folder per screen** (#78, moved in slices, the last in #154): every screen is
  `src/renderer/views/<view>/<view>.js` + `<view>.css`, plus the screen's other parts in the same
  folder; `index.html` holds no screen, only the app frame (top bar, sidebar with the Run item and
  runs menu, `main.content`, the drawers, the terminal dock, the shared dialogs) and the generated
  file lists. The folders:
  - `views/dashboard/`: Home, the start screen (#255: the flow overview and the Analytics tab; its section has no `hidden`; `renderDashboard` is also called on run events: it paints from the last read and reads again at most every 30 s);
  - `views/sessions/`: `sessions.js` (`window.SessionsView` for notifications and terminal events) and `sessions.css`;
  - `views/projects/`: the project cards, drawn inside Settings › Projects (#254: no screen or menu entry of its own; `showProjects`), and the New / Edit project dialog (`openProjectModal`, also opened from the Start drawer and the header's project selector);
  - `views/project/`: one project's page (no sidebar entry: its `menu` keeps Settings lit);
  - `views/backlog/`: `backlog.js` (the screen, its dialogs, the sidebar's unpushed badge), `backlog-epics.js`,
    `backlog-labels.js`, `backlog-roadmap.js` (no DOM as they load), `backlog-po.js` and `backlog-po-proposals.js`
    (the Product Owner drawer, put inside `.shell` like the other drawers; `backlog-po.js` wires it as it loads, so
    its header says `load: after views/backlog/backlog.js`) and `backlog.css`;
  - `views/artifacts/`: the Artifacts screen, a tab of Workflows › Runs (#254: no menu entry, its `menu` keeps Runs lit; `openArtifactsAt` stays a global deep link);
  - `views/workflows/`: `workflows.js` (Definitions, Runs, Pipelines, the screen's tablist and its menu entries, the Supervisor button, the deep links
    `showRunInList` / `showWorkflowDefinition`), `builder.js` + `builder.css` (Builder and its two dialogs);
  - `views/run/`: Run Details (no sidebar entry: the Run item and the runs menu are the shell's): the
    failure banner, the gate cards (`renderRunGates`), the summary, the steps, the sessions and the tabs;
    `app.js`'s `render()` calls its `renderRunScreen()` while it shows;
  - `views/runchat/`: `runchat.js` and the pure, unit-tested `run-chat-model.js` (it also wires the Run
    screen's Chat button, so its header says `load: after … views/run/run.js`);
  - `views/duo/` (Write & Review: `duo.js`, `duo-issue.js`, its Save to issue and guide dialogs) and
    `views/arena/` (AI Arena: `arena.js`, `arena-shuffle.js`, its guide); both add their "lab" badge in `mount`;
  - `views/analytics/`: a tab of Home (#255): no menu entry and no section of its own (`section: 'dashboard'`, `menu: 'dashboard'`); Home's markup holds its `panel` (`#view-analytics`), `showView('analytics')` opens Home on that tab;
  - `views/agents/`, `views/skills/`, `views/settings/`, `views/usage/`, `views/supervisor/`.

  **Shared pieces stay outside the folders**, one file each: `gate-panel.js` (what a gate offers on the
  Run screen, the run chat and Write & Review: choices, brief, Artifacts side panel, Run App, Show the
  diff), `run-list.js` (the run list of Project and Workflows › Runs, with its progress strip),
  `artifacts-panel.js` and `artifact-menu.js` (the Run screen's Artifacts panel and the copy menu),
  `artifact-render.js` (artifact kinds, markdown, JSON, tables), `start-drawer.js`, `supervisor-drawer.js`,
  `resume-dialog.js`, `usage-widget.js` (the top bar's usage and the helpers the usage tables share),
  `term-dock.js`, `code-banner.js`, `account.js`, `chat-models.js` (the CLIs and models the chat screens
  and the Builder offer), `robots.js`, and the pure models `run-progress-model.js` / `run-badges.js`
  (also required by the main process and tests). In CSS: `chat.css` (the chat look Write & Review, AI
  Arena and the run chat share, `duo-` classes), and in `style.css` the gate cards and panel
  (`.run-gate*`, `.gate-*`: the run chat builds on them), the agent cards and the skill picker's rules
  (`.agent-card*`, `.ag-skill*`, also the Builder's dialogs) and the run list's (`.pr-*`, `.rp-*`).
  Mind the cascade when moving a rule: the views' stylesheets load after every top-level one, so a
  base rule another top-level file builds on (`.run-gate` under `.run-gate-wide`) stays top level.
  The script calls
  `registerView({ id, nav: { label, icon, order, title, group, tab }, section, menu, markup, modals, mount, show })`
  (`view-registry.js`, loaded before `app.js`): `markup` is the screen's whole
  `<section id="view-<id>" class="view hidden">`, added to `main.content`; `modals` its own dialogs,
  added to the body; `nav` its sidebar entry, placed by `order` among the other entries'
  `data-order` (20 = Home … 130 = AI Arena: pick a free number between two); `mount()` wires its
  controls once (and adds what `nav` can't: a badge); `show()` runs on each `showView(id)`.
  The menu is grouped by the flow (#254, `nav-groups.js`): `nav.group` (`plan`, `code`, `workflows`,
  `ai`, or none) puts the entry under that group's title, which folds and remembers it; a group sits
  at its own order among the entries without one (Home, Night watch, Settings), and its
  entries by theirs inside it. `nav` may be a list: each entry opens the screen on its `tab`
  (`data-tab`; Workflows: Definitions, Runs, Builder, Pipelines). `section: '<id>'` draws the screen
  in another screen's section (the Roadmap in the Backlog's) and `menu: '<id>'` names the entry lit
  on a screen that has none (a project's page and Artifacts). The menu stays generated from the
  views: a new screen names its group in its own `nav`, there is no shared list to edit.
  The project is the app's (#254, `current-project.js`): a screen reads `window.CurrentProject.get()`
  in its `show()` and never adds a project picker of its own; choosing another project in the header
  (`#header-project`) calls `showView` on the current screen again.
  Sidebar clicks are delegated, so registered entries need no wiring. View scripts load after `app.js`
  and use its globals (`$`, `esc`, `state`, `api`, `errMsg`, `openModal`…); functions other files call
  (`renderDashboard`, `openArtifactsAt`, `loadProjectRunsThrottled`…) are plain top-level functions, so
  they stay globals. `app.js`'s `init()` runs on `DOMContentLoaded`, once every view is registered: the
  page can run an IPC reply between two scripts, so nothing it fills may be missing. `app.js` is the
  shell only (its header lists what stays and why: helpers, the shared run state, navigation, the top
  bar, toasts); an app-wide piece used by several screens gets its own top-level file, and `style.css`
  keeps theme tokens, layout and shared components (buttons, badges, `.s-group`/`.s-row`, `.switch`,
  tables, scrollbars, checkboxes). **Adding a screen is only adding a folder**: `views/<view>/` with
  its script and stylesheet (plus, for its checks and the README, a `VIEWS` entry in
  `scripts/screenshot.js` and a `docs/screens/<view>.md` fragment), then `npm run docs`; `index.html`,
  `app.js` and `style.css` stay untouched (the nav, `showView`, `init()` and the file lists find it).
- **How the files are loaded** (#152): `index.html`'s `<link>`/`<script>` lines for `src/renderer/*`
  and `src/renderer/views/*/*` sit between `<!-- generated:styles -->` / `<!-- generated:scripts -->`
  markers, written by `npm run docs` (`scripts/docs.js`); `node scripts/docs.js --check` (CI) fails
  when they are stale. A new module or stylesheet is a new file plus `npm run docs`. Order, per list:
  the files whose header comment has a `load: early` line (`api-http.js`, `view-registry.js`…,
  `style.css`), then `app.js`, then the other top-level files, then the views, each group sorted by
  path (`x-part.js` sorts before `x.js`). A file that needs another one as it loads (top-level code,
  not a function called later) says so in its header: `load: after views/duo/duo-issue.js (why)`; a CSS
  file that overrides another's rules too (`load: after <file>.css`). The vendor files
  (`node_modules`) stay hand-kept outside the markers. The CSP and the packaged app are unchanged:
  the page still lists plain files.
- Several runs can be in progress: `state.runs` (run id → view: run, sessions, steps, log, gates) and
  `state.runId` (the one the Run screen and the top bar show); `state.run`, `state.sessions`… read the
  selected one. Route anything run-specific by `ev.run_id` and pass the `runId` to `stopRun`,
  `resolveApproval` and the terminals. There is no approval dialog: a gate is answered inside its run
  (the run chats, or the gate card on its Run screen, `renderRunGates`); elsewhere the Run badge, a
  dismissable toast, Home's "What needs you" list and a desktop notification say it waits.
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
  in `app.js` (exported on `window` for `views/runchat/runchat.js` and `views/backlog/backlog.js`) so they agree. Drawing is in
  `run-badges.js` (pure: PR glyph and state colours, the default title). A PR without a state is
  asked with `askPrStates` (`runs:prState`, cached by the service). The title's pencil
  (`runTitleHtml`, `[data-title-edit]`) and the PR link (`[data-pr-url]`) are handled by one
  capture-phase click listener, so they never select or expand the row around them.
- Write & Review and AI Arena keep their own chat screens; every other run uses the run chat
  (`views/runchat/run-chat-model.js` is pure and unit-tested, `runchat.js` draws it).
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
  `image-viewer-model.js`, browsing in `image-sequence.js`), **with the whole context** (#182):
  `ImageViewer.open({ title, items: [{ title, images: [{ src | file, label, caption, side }] }],
  index, imageIndex })` gets every image of the place the click happened, in the order shown there
  (an original/modified pair is one item), and the clicked one; `open({ title, images, index })`
  still opens one item. Almost full screen, fitted (never upscaled), click / wheel / + − Fit 100%
  zoom up to 400%, drag to pan when zoomed; previous / next arrows on the sides (hover or Tab,
  disabled at the ends, no wrap-around), ← / → and Home / End between items (a new item is fitted,
  the neighbours preloaded), a counter "2 / 3"; one item shows neither. Tabs, Space or O / M switch
  inside a pair at the same zoom; Esc or a click outside closes, right-click keeps the copy menu.
  Every artifact image must use it: give the thumbnail `ImageViewer.THUMB` (hand cursor, "Click to
  enlarge", focusable, Enter opens) and open it on click with its context; no per-screen viewer.
  Users today: the Artifacts panel (its screenshot cards and image files), the Artifacts screen
  (`ArtifactsPanel.openImage({ files })`: the run group's images), the gate's E2E scenario
  screenshots, the diff viewer (the changed images), the run's input images and pasted images.
- **The Run screen's tabs** (#109): the Details panel has Session, Events and Artifacts
  (`switchTab`, `#tab-artifacts`, with a count on the tab). The Artifacts tab and the approval
  gate's side panel are one component, `artifacts-panel.js` (`ArtifactsPanel.mount(root, { runId,
  flat, extras })`): the run's files from `artifacts:list { runId }`, what the run produced first
  (#225: each file's `category` from `src/artifact-categories.js`; "Produced" = Result, Screenshots &
  images, Tests, Reports by default, "Show all" adds Process, Internal is never listed; category and
  kind chips; the Artifacts screen reuses `filtersHtml` / `filterFiles` / `onFilterClick`),
  grouped by category (newest first in one; `flat` for the gate), a preview in place (markdown, images with their original/modified
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
  newest first, the changed files from `gate:changes`, each opening the diff viewer, and the developer's
  test notes and evidence plan). Stacked under 1100 px. The Run screen and the run chat use the same
  helpers; the sidebar card only links to the run (no room). **Run App** asks `localPreview:info`:
  with a config it starts the preview (`localPreview:start`), without one it opens a setup
  prefilled from the worktree (`suggestConfig` in `src/local-preview.js`) that saves the project's
  `localPreview`. Its state (running / stopped / failed, Stop, Terminal, Open URL, the port-in-use
  error) is painted by `paintGateApps` from the run view's `preview` (local_preview events).
  `npm run screenshot -- --view run --workflow software-development-local-hero.yaml --input
  mode=validated --stop-at developer_check` captures it.
- **The diff viewer** (#118, `diff-viewer.js`, model `diff-viewer-model.js`, styles
  `diff-viewer.css`) is a near-full-screen overlay: `DiffViewer.open({ runId, approvalId?, file?, title?, commit? })`
  (`commit`: one of the branch's commits, the Commits select set to it, #289).
  Show the diff, the Changed files entries (`onChange` in `mountGateSides`), the Run screen's
  Review changes and the expanded run card's Review changes and commit rows open it.
- **The expanded run row** (#289, `run-list.js`, styles `.pr-*`): under the run's actions, task and
  sessions, two columns (`runColumnsBlock`, `.pr-cols`: side by side from 900px of card width with a
  container query, stacked below, Artifacts first), wherever the shared run list is expanded
  (Workflows › Runs, Project, Analytics › Run). **Artifacts** (`runArtifactsColumn`,
  `run-card-artifacts`) reuses the Details tab's filter from `ArtifactsPanel` (`newFilter`,
  `filtersHtml`, `filterFiles`, `onFilterClick`, `chipKindOf`, `CATEGORIES`): Produced by default,
  grouped by category newest first, "n of m" in its head, the step as a mono label on each row,
  "Nothing produced yet" with a "Show all (n)" button when only process files exist, no column when
  the run has no file; the filter lives in the row's `rl.arts` entry and resets when the card is
  reopened. **Repository** (`runRepositoryColumn`, `run-card-repository`) reads `run:diff` once per
  open card with its `summary` option (`ensureRunRepo`, `rl.repo`: the commits and the files' counts,
  no patch; a running run's commits again when a run event refreshed its row; never `run:diffFile`).
  A run merged locally whose branch the engine deleted still lists its commits (the service reads
  them from the `worktree.merged` commit). It shows the branch (`run-card-repo-branch`) and its base, a state badge
  (`run-card-repo-state`: merged or pushed from the PR, merged locally at the merge commit, not
  merged), the totals (`run-card-repo-totals`), the commits newest first (`run-card-commits`,
  `run-card-commit` buttons named by hash and subject, five then `run-card-commits-more`), and
  **Review changes** (`run-card-review-changes`, disabled with the reason in its title when there is
  nothing to show). States: loading, an error with Retry, "This run made no commits", "Simulated:
  nothing was committed", "The branch is gone" (the service answers `unavailable` instead of an
  error when the run's branch was deleted). Screenshots: `--view workflows --tab runs` with the demo
  runs (every run's `run:diff` is `demoRunDiff`). Its data is `run:diff` (the files with their status, counts and patches,
  and the branch's commits) and `run:diffFile` (one file's patch and both sides, used to expand
  context, load a huge diff and preview images). Both are served by `src/service/areas/diff.js`,
  which takes the folder and base from the open gate or the run's `worktree.ready`. The model is pure
  and Node-testable: `parsePatch`, `rows` (gaps and expansion), `splitRows` (split and unified
  share the hunks), `wordDiff`, `highlightHtml` and `groupByFolder`. In screenshots, `run:diff` /
  `run:diffFile` answer with a demo branch (`demoRunDiff` in `scripts/screenshot.js`). Use
  `--view run --input mode=validated --stop-at developer_check --click "#btn-run-diff"`, then
  `--click ".dv [data-dv-mode=unified]"`, `--click ".dv [data-dv-expand=all]"` or
  `--click ".dv [data-dv-file='docs/images/backoff.svg']"`.
- **The run's 3D view** (`run3d.js`, `run3d.css`, model `run3d-model.js`) is a full-screen overlay
  opened by the 3D button beside Chat (Run screen `#run-mode-3d`, run chat `#rc-3d`): the run's
  recorded events, then its live `run:event`s, into a pure `Run3DModel` (Node-tested); "Open the
  gate" closes it and calls `showRun` (it never answers a gate). The scene is the one exception to
  "no bundler": React + React Three Fiber + three in `src/renderer/run3d/*.jsx`, bundled by
  `scripts/build-3d.js` into `generated/run3d-scene.js` (gitignored, rebuilt by prepare / prestart /
  prebuild, packed into the app) and loaded with a `<script src>` on the first click: run
  `npm run build:3d` after changing a `.jsx`.
  - **Themes** (`run3d-theme.js`): dark by default, the app's own tokens (a test compares its
    palette with `style.css` `:root`), or the light palette of the approved proof of concept
    (`poc/run-3d.html`). The HUD's colours are `--r3d-*` variables under `.r3d` /
    `.r3d[data-theme="light"]` (no literal colour in a rule: a test checks it); the scene's are the
    theme's palette (`useTheme()` in a component that paints with it; a texture drawn with theme
    colours passes `themed`, so it is freed when the theme is left). A state colour comes from
    `statusColor()` and always with its label. The top bar's sun / moon button
    (`[data-testid=run3d-theme]`) switches; the choice is in localStorage (`multiagent.run3d.theme`).
  - **Replay** (`run3d-replay.js`, a pure `Run3DPlayer`): it keeps every event, a `head` model (the
    run now) and a `past` model (the replayed moment: the state kept at the last step boundary, then
    the events up to it), and the views draw `view.model`, whichever is shown, with `nowMs()` /
    `robotStateOf()` for the time-dependent parts. Controls in the pipeline card: play / pause
    (`[data-testid=run3d-play]`, Space), previous / next step (`[data-r3d-step]`, Left / Right; with
    Shift 1% of the timeline), speeds 1× to 64×, the strip (`[data-testid=run3d-strip]`: click or
    drag), and `[data-testid=run3d-live]` back to the live run (or to a finished run's end). A wait
    for the owner over a minute is cut to 45 s in a replay only (marked on the strip); the head of a
    live run is always in real time.
  - Capture it with `npm run screenshot -- --view run --input mode=validated --stop-at developer_check
    --click "#run-mode-3d" --click ".r3d-zoom button[aria-label='Follow the run']"` (a finished run:
    `--view run-chat --click "#rc-3d"`). Then `--click "[data-testid=run3d-theme]"` for the light
    theme, `--click "[data-r3d-step='-1']"` (repeatable) for a replay paused at an earlier step (on
    the live run: with "Live" offered), `--press "[data-testid=run3d-strip]@0.4"` to seek with the
    pointer, `--key Space` to play, `--size 1150x780` for the narrow layout. The simulated run lasts
    a few seconds: for hours on the clock and a cut wait, give `--run <folder>` a run folder whose
    `events.jsonl` has them.
- Test changes with a temporary Electron script (see `scripts/smoke.js`:
  `npx electron scripts/smoke.js <out.png>` runs a mock run and takes a screenshot) and look at
  the screenshots. Never open real CLI terminals or start real runs in those checks. In a fresh
  workspace Developer mode is off and the Simulation box is ignored: set
  `api.setSettings({ developerMode: true })` before clicking Start.

## The Oracle's panel and drawer (#171)

`views/oracle/oracle.js` registers a view with no screen of its own: it docks `#oracle-dock` inside
`#view-dashboard` (class `oracle-docked`, a two-column grid) and adds `#oracle-drawer` (a `.drawer`
like `#svc-drawer`) and the header's `#nav-oracle` button, inserted before the notifications bell
(#254: `.topbar .actions`, top right). On
Home's Overview it focuses the dock, elsewhere (Home's Analytics tab included, #255: the dock is hidden there) it toggles the drawer. Both places render the same
state from `OracleChatModel` (`views/oracle/oracle-chat-model.js`, pure, tested in Node):

- **states**: `empty` (a line on what it reads, 4 `.chip` suggestions), `conversation`,
  `answering` (the shared chat's working line "Oracle is working…", Send and chips disabled, input
  editable; the box emptied on Send, #274), `error` (the chat's error line, the question back in the
  input; the Oracle's own buttons' errors as a `.sup-wmsg system error` line), `paused` (daily budget:
  a notice with spent/limit and a link to Settings › Execution, input and Send disabled),
  `unavailable` (another live process owns `oracle/owner.json`: the form is replaced by a notice
  naming it);
- **unread**: the `.nav-badge.oracle-unread` counts Oracle answers newer than `oracle:state`'s
  `readAt`; the conversation in view (dock on Home's Overview, or the open drawer) saves it with
  `oracle:markRead`, so the count survives a reload;
- **pasted images** (`addImages`/`removeImage`, 5 MB and 4 per message): thumbnails above the input,
  an inline error under it; sent as data URLs to `oracle:ask`, shown in the log through
  `oracle:attachment`;
- **memory**: the Memory button opens a framed `.field` form (Save / Cancel); a save error keeps
  the draft.

Answers go through `markdownHtml`, then `decorate()` turns run ids and `#<n>` into links
(`selectRun`, the Backlog's `BacklogActions.focusIssue`), absolute paths under `runs/<id>/` into
Artifacts links (`openArtifactsAt`) and other absolute paths into copy-on-click code. Screenshots:
`--view oracle` (Projects with the drawer open) and `--oracle <state>` on any view (see
`scripts/screenshot.js --help`).

## The Agents window (#263)

The Oracle, the Product Owner and the Supervisor can open in their own window, beside the app:
`src/agents-window.js` (main process, pure of Electron: `createAgentsWindow({ BrowserWindow,
statePath, dirname })` → `open({ agent })`, `current()`, `setAgent(id)`) creates one
`BrowserWindow` with the main window's preload and isolation, loading the app's page with
`?window=agents&agent=<id>`; its bounds and the last agent live in `<workspace>/agents-window.json`.
`main.js` answers `agents-window:open` (each drawer's "Open in a window" button
`[data-agents-window="<id>"]` / `agent-chat-open-window`, and Ctrl+Shift+A, both handled in
`agents-window.js`) and pushes its events (`chat:progress`, `oracle:changed`, `run:event`…) to both
windows (`broadcast`). On the page, `agents-window.js` (`window.AgentsWindow`) hides the shell and
mounts the rail (`agents-rail`, a nav named "Agents", one `agents-rail-item` per agent: its robot in
its role colour, its name, `agents-rail-unread`, `data-busy` while it answers; icons only under
900px) and the pane (`agents-window-pane`: `agents-window-header` with the agent, its model, cost
and tokens, then its chat). The agents declare themselves: each view calls
`AgentsWindow.register({ id, name, order, color, avatar, mount, unmount, unread, busy, header })` as
it loads (the Oracle, the Product Owner and the Supervisor; an agent added later registers the same
way) and `AgentsWindow.changed()` when its state changes. A pane is a second surface of the agent's
own state through the shared chat (the Oracle's `'window'` surface, the Product Owner's and the
Supervisor's `winChat`): one conversation, two places, a question sent in one shown in the other as
a turn started elsewhere (`setTurn`), and across the two real windows through the service's history
and pushed events. The window never starts a session of its own and never answers a gate. A link to
a screen in its chats (a run, an issue, a file, a request, the Oracle's settings) opens in the main
window: the view asks `AgentsWindow.toMainWindow(name, target)` first (on the window's page it sends
`agents-window:navigate`, which `main.js` relays to the main window as `main-window:navigate` and
brings it to the front; in the main window it answers false) and registers the handler the main
window runs with `AgentsWindow.onNavigate(name, fn)` (the Oracle's `oracle:*`, the Product Owner's
`product-owner:*`).
`npm run screenshot -- --view backlog --agents-window oracle|product-owner|supervisor` captures it
(`--size 700x800` for the collapsed rail, `--theme` for the themes).

## The agents' chat (#274)

`agent-chat.js` (`window.AgentChat.create(container, options)`, with `agent-chat.css`) is the one
chat of the Oracle, the Product Owner and the Supervisor drawers: the messages (Markdown, cost and
tokens), Send (the text box empties at once; a failure or a refusal puts the text back with the
error), the busy lock (#234), the working line, the live turn (#180), scroll to the end on send,
attachments, the unread state (#149) and slots for each agent's own parts (`head`, `top`, `pills`,
`compose`, `actions`, `foot`). Its header lists what it owns. A new agent chat uses agent-chat.js
(never a copy of a drawer's chat code), and a chat fix goes there so every drawer gets it. A drawer
keeps its ids and classes through the `ids` / `classes` options, and draws its own message markup
with `renderMessage`; the component wraps each message in `[data-testid="agent-chat-message"]`
(`display: contents`, the look is the drawer's).

## Pasted images in the prompt fields (#130)

`paste-image.js` (`window.PasteImage`, loaded after `voice.js`) shares voice.js's `VOICE_FIELDS`
and its scan/attach pattern (a MutationObserver), so a new AI prompt field gets the mic and image
paste from one selector. One document-level `paste` listener takes the clipboard's images (none
when it holds text) and saves each through `clipboard:saveImage` (a service channel, so the browser
UI works too; `src/pasted-images.js` writes `<workspace>/attachments/pending/`). Fields with their
own image paste (`#po-question`, `.oracle-input`) are skipped. A screen that submits a field calls
`await PasteImage.collect(field)` (`[{ path, name }]`, empty when nothing was pasted: send the
request unchanged) and `PasteImage.clear(field)` with the text. Chips are Arena's `.ar-chip` plus
`.paste-chip` (`paste-image.css`). Screenshots: `--paste <css>` / `--paste-big <css>`.

## UI conventions

The general rules (and the visual review of the screenshots) are in the `ui-conventions` skill,
which the software-development developer and evidence agents load (#111). The design tokens
(colours, spacing scale, typography, radius, alignment grid, from the `:root` block of
`style.css`) are in the separate [`design-system`](../../skills/design-system/SKILL.md) skill (#151);
ai-development-local-hero's `ui_reviewer` reviews the screenshots against both. A token added or
changed in `style.css` goes into that skill too. In this app:

- **Reuse what `style.css` has**: `.btn` (`.primary`, `.ghost`, `.sm`; `.ghost.danger` red for a
  destructive action, `.warn-ghost` amber for one that holds work back, `.btn-icon` with an icon before
  the text: the Roadmap bar's Stop and Pause, #269), `.link-btn` for small
  actions ("add note", "Edit"); `.badge` (neutral; `.warn`, `.live`, `.p-mock`…) and `.pill`
  (`-idle`, `-running`, `-success`, `-failed`, `-cancelled`, `-interrupted`) for states: a run's
  or an item's status is always drawn by `StatusPill` (`status-pill.js`, #266:
  `statusPill(status, { waiting })`, or `statusLabel` for plain text), never as its raw id: the
  label is readable ("Running" with the pulsing dot, "Waiting for you", "Merged locally"), the id
  stays in `data-status` (tests and E2E steps read it); a new status gets its label there; `.field`
  (label above the control, `.hint` for the help line, `.row` for a pair); `.s-group`/`.s-row` for
  settings-like lists; `.switch` and `.check` for flags; `.seg` (`.sm`) for a small set of choices;
  `.empty-state`; the standard `select` / `input[type=text]` styles (their focus is on the control).
- **Class names are per screen**: every stylesheet is global and `index.html` loads them in a
  generated order, so a screen's own classes carry its prefix and no other screen reuses them. The
  robot containers in particular: `ag-robot` is the Agents screen's 280px editor preview
  (`views/agents/agents.css`), the Analytics Agents tab's 44px card robot is `an-robot`
  (`views/analytics/analytics-insights.css`), the 3D HUD's `r3d-avatar`
  (#297: a second `.ag-robot` once shrank the editor's preview to 44px; a test refuses one outside
  `views/agents/`).
- **Controls follow the data**: workflow inputs are always drawn by `WorkflowInputs`
  (`workflow-inputs.js`, #116), never by hand: the input's `label` (or one derived from the key; a
  YAML slug is never shown), its `options` labels, pills (`.seg`) for an enum of up to 5 short
  values, a select for a longer one, a `.switch` for a boolean (or an enum of `"false"`/`"true"`), a
  compact box for text, the local branches for a `*branch` input, `show_if`, and the `description`
  as `.hint`. Read the values with `WorkflowInputs.read`, set one with `.set`, prefill the project's
  language and branches with `.applyHints`. Add `.wi-grid` to the container for aligned labels.
  Elsewhere, an enum is a select or a `.seg` toggle and a flag a switch or a checkbox. Short values
  never get a full-width box.
- **What leads**: titles (issue, run, project) are the headline; workflow files, ids and run ids
  are small badges or links with the full value in `title`. Long titles ellipsize.
- **Edits**: several fields → an Edit form with Save / Cancel; one obvious choice (a mode) → a
  toggle that saves at once; optional text (a note) appears when set or from an "add …" link.
- **Page alerts** (#270, `alerts.js`, `window.Alerts`): what a page has to tell its owner goes into
  the alerts box at the top of the page (above its filter row), never into a banner of its own. The
  page builds a list on every render and hands it over: `Alerts.mount(box).set(list)`, each alert
  `{ id, level, title, text, actions: [{ label, onClick, primary, title?, pressed? (a switch),
  attrs? (e.g. a `data-testid`) }], dismissible, onDismiss?, createdAt? }`. One alert shows at a
  time with a counter ("1/3") and arrows, errors first, then warnings, then infos. Choose the level
  by what the owner must do: **error** when something is blocked until they act (a roadmap paused by
  a failed item, the queue's error; never dismissible: it leaves when its cause does), **warning**
  when something is stale or will go wrong later (a Backlog Refresh that is due, a retired label),
  **info** for a state worth knowing with an optional action (local merges not pushed). An alert
  leaves by itself when the page stops listing it; × hides an info or a warning until its condition
  comes back. The component has no screen code: the Backlog's list is `renderAlerts` in `backlog.js`
  (the roadmap's own alert comes from `BacklogRoadmap.alerts`).
- **A toast with an action** (#281, `showToast(title, detail, runId, gate, { action })` in `app.js`;
  the countdown and the action live in `toast.js`, `openToast`):
  `action: { label, run, done? }` draws a button inside the toast ("Undo"). Such a toast stays 10 s
  (7 without), waits while the pointer is over it or its button has the focus, runs the action once
  and then says its outcome (`done`, "Restored" by default, or the error's message); a click
  elsewhere on it does nothing, × dismisses it. **An action that removes or replaces something in
  one click offers Undo in its toast** (or asks first when it cannot be undone): the Roadmap's edits
  do (`undoToast` in `backlog-roadmap.js`, `api.undoRoadmap`), with "Restore an earlier version…" in
  its ⋮ menu for a mistake noticed later.
- **A menu of actions** (#269): secondary or rare actions go into a ⋮ menu built from a list
  (`MENU` in `backlog-roadmap.js`: `.bl-menu-wrap`, a button with `aria-haspopup="menu"` and
  `aria-expanded`, `role="menu"` / `role="menuitem"`, the first entry focused when it opens, Esc
  closes it and gives the focus back), so a new action is a line in the list, not a new button.
- **The roadmap item card** (#282, `itemHtml` in `backlog-roadmap.js`, `.rm-*` in `backlog.css`) reads in
  three bands. Band 1, `.rm-item-top`: the issues (`.rm-issues`: the titles, then the count and the
  complexity, `roadmap-issues-foot`) | cost and time (`metersHtml`: `roadmap-meter-cost` /
  `roadmap-meter-time` with `data-verdict` none | estimate | ok | warn | over; the time of a run at
  work is the live timer, `roadmap-run-timer`, moved by `tick()`) | the status block (`statusHtml`,
  `roadmap-status`: the ring, the StatusPill and the step, the fix round in full, then Retry / Skip
  or move and Remove; never an agent avatar). Band 2, `.rm-workflow` (`workflowHtml`,
  `roadmap-workflow`): the workflow's name, the run chip ("Open run →") or Edit, the mode toggle
  (`roadmap-mode`: `.seg.sm`, locked while the item runs), the badges and input pills (`.rm-meta`),
  and the pipeline (`pipelineHtml`, `roadmap-pipeline` / `roadmap-station` with `data-state`), whose
  stations come from `RunProgress.pipeline` (`run-progress-model.js`): the workflow's groups and its
  steps in no group, in order (a human gate in no group is no station; the gate a mode turns on is
  one, right after the station that holds it), each with what the run's trail did there. Band 3: the
  Product Owner's reason, then the error line and the Edit form. The card answers to its own width
  (`@container rm-card` on `.rm-items`, not the window: the sidebar and the Oracle's drawer narrow
  it): the issues share the first row only while they keep 540px, the Workflow band stacks under
  980px, and under 520px everything is one column. A stage's actions are its ⋮ menu
  (`stageMenuHtml`, `roadmap-stage-menu`; an entry that cannot be used is `aria-disabled` with its
  reason under it); a disabled stage (#284) is `.rm-stage.disabled` with `data-disabled="true"`.
  More states for screenshots: `--roadmap states` (a fix round, a disabled stage, a simulated item).
- **A roadmap changed elsewhere** (#287): every save of the Roadmap screen sends the roadmap's
  `updatedAt` it drew (`save(ctx, r, stages, edit)` → `api.saveRoadmap(projectId, stages, label,
  base)`); the service applies only that edit to a roadmap written since (docs/agents/storage.md).
  While an Edit form is open, a change of the file adds the notice `roadmap-changed-notice` to the
  form ("The roadmap changed: 1 item updated elsewhere", `staleNotice` in `backlog.js` with
  `BacklogRoadmap.changedElsewhere`, updated on each change). A refused save (`conflict`) shows the
  stored roadmap and the reason in the error line, and keeps the form open with the values typed
  (`kept`); when the item or its stage is gone, the "Not saved" box `roadmap-save-conflict`
  (`lostHtml`, `.rm-conflict`) shows the reason and those values read-only, until Dismiss.
- **Check it**: extend the screen's demo data in `scripts/screenshot.js` with the fields you add,
  then capture the default view and each state with `--click` (e.g.
  `npm run screenshot -- --view backlog --mode roadmap --click "[data-rm-edit]"`). List those
  captures in `evidence_plan` and log the UI choices in the decision log.
