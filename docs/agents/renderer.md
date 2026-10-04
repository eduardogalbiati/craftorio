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
  - `views/dashboard/`: the start screen (its section has no `hidden`; `renderDashboard` is also called on run events);
  - `views/sessions/`: `sessions.js` (`window.SessionsView` for notifications and terminal events) and `sessions.css`;
  - `views/projects/`: the project cards and the New / Edit project dialog (`openProjectModal`, also opened from the Start drawer);
  - `views/project/`: one project's page (no sidebar entry: `showView` highlights Projects);
  - `views/backlog/`: `backlog.js` (the screen, its dialogs, the sidebar's unpushed badge), `backlog-epics.js`,
    `backlog-labels.js`, `backlog-roadmap.js` (no DOM as they load), `backlog-po.js` and `backlog-po-proposals.js`
    (the Product Owner drawer, put inside `.shell` like the other drawers; `backlog-po.js` wires it as it loads, so
    its header says `load: after views/backlog/backlog.js`) and `backlog.css`;
  - `views/artifacts/`: the Artifacts screen (`openArtifactsAt` stays a global deep link);
  - `views/workflows/`: `workflows.js` (Runs, Definitions, the sidebar sub-items it adds after its entry, the deep links
    `showRunInList` / `showWorkflowDefinition`), `builder.js` + `builder.css` (Builder and its two dialogs);
  - `views/run/`: Run Details (no sidebar entry: the Run item and the runs menu are the shell's): the
    failure banner, the gate cards (`renderRunGates`), the summary, the steps, the sessions and the tabs;
    `app.js`'s `render()` calls its `renderRunScreen()` while it shows;
  - `views/runchat/`: `runchat.js` and the pure, unit-tested `run-chat-model.js` (it also wires the Run
    screen's Chat button, so its header says `load: after … views/run/run.js`);
  - `views/duo/` (Write & Review: `duo.js`, `duo-issue.js`, its Save to issue and guide dialogs) and
    `views/arena/` (AI Arena: `arena.js`, `arena-shuffle.js`, its guide); both add their "lab" badge in `mount`;
  - `views/agents/`, `views/skills/`, `views/analytics/`, `views/settings/`, `views/usage/`, `views/supervisor/`.

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
  at its own order among the entries without one (Home, Analytics, Night watch, Settings), and its
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
  `diff-viewer.css`) is a near-full-screen overlay: `DiffViewer.open({ runId, approvalId?, file?, title? })`.
  Show the diff, the Changed files entries (`onChange` in `mountGateSides`) and the Run screen's
  Review changes open it. Its data is `run:diff` (the files with their status, counts and patches,
  and the branch's commits) and `run:diffFile` (one file's patch and both sides, used to expand
  context, load a huge diff and preview images). Both are served by `src/service/areas/diff.js`,
  which takes the folder and base from the open gate or the run's `worktree.ready`. The model is pure
  and Node-testable: `parsePatch`, `rows` (gaps and expansion), `splitRows` (split and unified
  share the hunks), `wordDiff`, `highlightHtml` and `groupByFolder`. In screenshots, `run:diff` /
  `run:diffFile` answer with a demo branch (`demoRunDiff` in `scripts/screenshot.js`). Use
  `--view run --input mode=validated --stop-at developer_check --click "#btn-run-diff"`, then
  `--click ".dv [data-dv-mode=unified]"`, `--click ".dv [data-dv-expand=all]"` or
  `--click ".dv [data-dv-file='docs/images/backoff.svg']"`.
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
the Dashboard it focuses the dock, elsewhere it toggles the drawer. Both places render the same
state from `OracleChatModel` (`views/oracle/oracle-chat-model.js`, pure, tested in Node):

- **states**: `empty` (a line on what it reads, 4 `.chip` suggestions), `conversation`,
  `answering` (`.sup-loading` "The Oracle is reading…", Send and chips disabled, input editable),
  `error` (a `.sup-wmsg system error` line, the question back in the input), `paused` (daily budget:
  a notice with spent/limit and a link to Settings › Execution, input and Send disabled),
  `unavailable` (another live process owns `oracle/owner.json`: the form is replaced by a notice
  naming it);
- **unread**: the `.nav-badge.oracle-unread` counts Oracle answers newer than `oracle:state`'s
  `readAt`; the conversation in view (dock on the Dashboard, or the open drawer) saves it with
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

- **Reuse what `style.css` has**: `.btn` (`.primary`, `.ghost`, `.sm`), `.link-btn` for small
  actions ("add note", "Edit"); `.badge` (neutral; `.warn`, `.live`, `.p-mock`…) and `.pill`
  (`-idle`, `-running`, `-success`, `-failed`, `-cancelled`, `-interrupted`) for states; `.field`
  (label above the control, `.hint` for the help line, `.row` for a pair); `.s-group`/`.s-row` for
  settings-like lists; `.switch` and `.check` for flags; `.seg` (`.sm`) for a small set of choices;
  `.empty-state`; the standard `select` / `input[type=text]` styles (their focus is on the control).
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
- **Check it**: extend the screen's demo data in `scripts/screenshot.js` with the fields you add,
  then capture the default view and each state with `--click` (e.g.
  `npm run screenshot -- --view backlog --mode roadmap --click "[data-rm-edit]"`). List those
  captures in `evidence_plan` and log the UI choices in the decision log.
