# Screens, Setup and the screen folders

The views, the first-run Setup dialog and one folder per screen (the sidebar, adding a screen).

- Views: dashboard, sessions, projects (+ project detail with runs/sessions/artifacts), backlog,
  artifacts, workflows (one menu entry and one tab per `state.workflowsTab`: Definitions / Runs / Builder / Pipelines;
  Definitions shows agents with their session mode and capabilities, Builder is `views/workflows/builder.js`), agents, skills, usage,
  settings, run (+ run chat); terminal dock; supervisor drawer. The code map
  ([code-map.md](../code-map.md)) says which file draws which screen.
- **Setup** (#319, `setup.js` + `setup.css`, top-level: a dialog, not a screen): the first-run Setup,
  registered with `registerView` for its `modals` only (no section, no menu entry) with a stepper (Agents · Try it safely · Workflows · First project).
  `init()` opens it when `settings.setupDone === false` (strictly: a workspace or a test double
  without the key never sees it); Settings › Agents & CLIs › Run setup again calls
  `window.Setup.open()`. Its pure parts (status badges, requirement badges, preselection, hidden
  workflows) are `packages/shared/setup-model.js`, shared with Node (`packages/engine/domains/workflow/workflow-requirements.js`). It sits under
  the other dialogs (z-index 9, so the Skip confirm and New project show above it) and lifts the
  terminal dock above itself while open. Check it with `npm run screenshot -- --view setup --mode
  <agents | try-it-safely | workflows | first-project>` (`--missing-clis` for CLIs not installed).
- **One folder per screen** (#78, moved in slices, the last in #154): every screen is
  `apps/desktop/renderer/views/<view>/<view>.js` + `<view>.css`, plus the screen's other parts in the same
  folder; `index.html` holds no screen, only the app frame (top bar, sidebar with the Run item and
  runs menu, `main.content`, the drawers, the terminal dock, the shared dialogs) and the generated
  file lists. The sidebar has two parts (#411): the menu (`.sidebar-menu`, `data-testid="sidebar-menu"`,
  where `registerView` places the entries and groups) is the only part that scrolls; the footer
  (`.sidebar-footer`, `data-testid="sidebar-footer"`: Keeping awake, the Run item, the runs) stays
  pinned at the bottom, every run listed, capped at 50vh; past it only `#nav-runs` scrolls. The folders:
  - `views/dashboard/`: Home, the start screen (#255: the flow overview and the Analytics tab; its section has no `hidden`; `renderDashboard` is also called on run events: it paints from the last read and reads again at most every 30 s);
  - `views/sessions/`: `sessions.js` (`window.SessionsView` for notifications and terminal events) and `sessions.css`;
  - `views/projects/`: the Projects screen (#354: Code & Build, before Backlog; `showProjects`), its project cards, and the New / Edit project dialog (`openProjectModal`, also opened from the Start drawer and the header's project selector); `project-workflows.js` (`window.ProjectWorkflows`, #486) is the dialog's and the Overview's **Workflows** block: the manifest's entries checked (`api.projectManifest({ url | folder })`, 400 ms after typing, a sequence number against stale answers), else the bundled and workspace workflows by category (`project-workflows-category`, a hint each, none checked) and **Create one for this project** (`project-workflows-create`, the Builder); `pending` shows "will be read after cloning" (with nothing checked, `createProject` adopts the clone's manifest), a manifest's `errors` a line (`project-workflows-manifest-errors`); #729: the Overview shows only the project's workflows, one card each (`pj-wf-card` `data-workflow-id`: name, category, the wizard's variant and CI pick as `OnboardingModel` labels them, a description clamped to two lines, `pj-wf-default-badge` on the default, `pj-wf-make-default` / `pj-wf-remove`, Remove with Undo in its toast), the manifest's workflows not on it as `project-repository-workflow` chips, `pj-wf-empty` without any, and **+ Add a workflow** (`pj-wf-add`) opening a dialog (`pj-wf-add-dialog`, `pj-wf-add-search`, `pj-wf-add-option`) of the installed workflows not on the project by category (never the manifest's: a retired one has no file); each action saves `{ workflows, defaultWorkflow }` and the head shows the default (`project-default-workflow`); the new-project wizard's Finish saves step 3's feature / fix / release with their `variant` (the CI pick as release's `ci`, both kept by `cleanWorkflows`) and `feature` as the default (`ProjectWorkflows.applySaved` redraws the open page); the backlog's pickers (Assign, the Product Owner's plan and splits) list the header project's set first and preselect its default (`DefaultWorkflow.current()`/`projectFirst`, `packages/shared/default-workflow.js`, which also holds `firstBuild`, the default's rule);
  - `views/project/`: one project's page (no sidebar entry: its `menu` keeps Projects lit), with the tabs Overview, Conflict map (`project-conflict-map.js`, also the "Conflict map: in Projects › <project>" link of the Roadmap and Analytics › Performance), Architecture and Refactor; the selected tab is remembered per project, and the page follows the header's project;
  - `views/backlog/`: `backlog.js` (the screen, its dialogs, the sidebar's unpushed badge), `backlog-epics.js`,
    `backlog-labels.js`, `backlog-roadmap.js` (no DOM as they load), `backlog-po.js` and `backlog-po-proposals.js`
    (the Product Owner drawer, put inside `.shell` like the other drawers; `backlog-po.js` wires it as it loads, so
    its header says `load: after views/backlog/backlog.js`) and `backlog.css`;
  - `views/artifacts/`: the Artifacts screen, a tab of Workflows › Runs (#254: no menu entry, its `menu` keeps Runs lit; `openArtifactsAt` stays a global deep link);
  - `views/workflows/`: `workflows.js` (Definitions, Runs, Pipelines, the screen's tablist and its menu entries, the Supervisor's round button at the bottom right of every tab (#409), the deep links
    `showRunInList` / `showWorkflowDefinition`), `builder.js` + `builder.css` (Builder and its two dialogs),
    `workflow-import.js` (#488: every card's Download, `workflow-download`, through `api.exportWorkflow` /
    `api.exportRepositoryWorkflow`; Import of a file, a drop on the Definitions tab or an https URL, previewed by
    `api.importWorkflow({ preview: true })` in the `workflow-import-dialog` modal (what the workflow does, the
    #474 warning, the name and Replace, the loader's reasons in `workflow-import-errors`), then written as custom;
    `?import=<url>` in `location.search` starts it once Definitions has loaded, the hook of a future public page.
    The Builder, `shared/workflow-compose.js` and `engine/run/field-rules.js` load in a page without Node
    (UMD globals, `test/browser-load-488.test.js`));
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
  and the Builder offer), `robots.js`, and the pure models `packages/shared/run-progress-model.js` / `run-badges.js`
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
  added to the body; `nav` its entry in the sidebar's menu, placed by `order` among the other entries'
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
  its script and stylesheet (plus, for its checks and the README, a screenshot seed module
  `scripts/screenshot/views/<view>.js` and a `docs/screens/<view>.md` fragment), then `npm run docs`; `index.html`,
  `app.js` and `style.css` stay untouched (the nav, `showView`, `init()` and the file lists find it).
