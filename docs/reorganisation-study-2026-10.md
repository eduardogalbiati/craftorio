# Reorganisation study: an engine package and modular fronts (2026-10-24)

The owner's intent: separate the engine from the app, then build the UI as several fronts that can
be built one at a time or all together, each with its own code and tests, so development gets
faster. The fronts named so far:

- **Project Analyser**: one project of one repository: suggested flows, system architecture, the
  project city, refactor analysis, criticality analysis, delivery speed of issues and code, open PRs.
- **Code & Build**: what the app is today, plus the Product Owner.
- **Settings**: configuration, AI, AI usage, Night watch and Oracle (decided on 2026-10-24 as the
  shell plus an `ai` front, section 5).
- **Design & Plan**: ideation and documents.

This study measures what exists, maps it onto those fronts, proposes a target layout and a phased
plan, and records the decisions the owner took (section 5). The figures come from `scripts/dep-map.js`
(run it again after each phase) and from `find`/`wc` over the tree at commit 6ed26b85 (release 1.3.0).

## 1. What exists today

### 1.1 The runtime seam already exists

The renderer talks to the engine only through `window.api`, built from the channel manifest
(`src/service/manifest.js`): 276 channels in 33 files under `src/service/channels/`, each with a JSON
schema. Two transports carry them unchanged: Electron IPC (`src/host/preload.js`) and HTTP + WebSocket
(`src/server/`, `src/renderer/api-http.js`). `npm run serve` is already the engine without Electron,
and the desktop app can attach to an engine another computer serves (`src/host/engine-connection.js`).

So "engine vs app" is a runtime boundary today. It is not a package boundary: one `package.json`,
one `node_modules`, one test tree, one build. The study is about turning the runtime seam into a
package seam without breaking what already works across it (the contract tests in `test/contract/`,
the contract hash of #339).

### 1.2 Size of each area

| Area | Files | Lines | Role |
|---|---|---|---|
| `src/` loose files | 135 | 29,500 | domain modules (oracle, refactor, roadmap, supervisor…) and the Electron host |
| `src/renderer/` | 175 | 43,900 | 22 screens in `views/`, 74 shared UI modules at the root (14,600 lines) |
| `src/engine/` | 50 | 13,200 | runs, workflows, worktrees, providers' processes |
| `src/service/` | 76 | — | 33 channel files, 37 area files, manifest, schemas |
| `src/shared/` | 43 | 7,300 | pure dual-load modules (Node and `<script>`) |
| `src/server/`, `src/control/` | 3 | 600 | HTTP/WS transport, control channel |
| `test/` | 888 | 140,900 | 659 at the root, 103 `service/`, 47 `slow/`, 1 `contract/` |
| `features/` | 54 | — | Playwright BDD scenarios, one per screen or theme |
| `workflows/`, `skills/`, `pipelines/`, `seeds/`, `fragments/` | 110 | 16,000 | bundled content the engine reads |
| `native/` | 3 crates | — | Rust sidecars (own cargo workspace) |
| `scripts/` | 61 | 7,300 | docs generator, packager, CI plan, smoke, screenshots, 3D bundle |

### 1.3 The dependency graph

`require()` edges between areas (from → to, count):

| From | To |
|---|---|
| `engine` | loose files 37, `shared` 20 |
| `service` | loose files 309, `engine` 70, `shared` 32 |
| loose files | `shared` 71, `engine` 53, `service` 3 |
| `renderer` | `shared` 21 (and nothing else: the renderer never requires the backend) |
| `shared` | nothing outside `shared` |
| `server`, `control` | `service` 2, loose files 4 |

What this says:

- **`shared` is already a leaf package.** It can move first, at no risk.
- **`service` never touches the renderer or `main.js`**, and the renderer never requires the
  backend. The engine package is `engine + service + server + control + shared + the loose files
  the service needs`.
- **The loose files are the backend's domain layer, not a mess to delete.** 103 of the 135 are
  required by `engine/`, `service/` or `server/`; they cluster by name: oracle (11), refactor (6),
  run-* (6), supervisor (6), roadmap (4), local-* (4), workflow-* (4), discovery (3), night-* (3),
  project-* (3), cli-* (3), agents (3). The other 32 are the Electron host and its windows:
  `main`, `preload`, `ipc-guard`, `window-guards`, `permissions`, `open-guard`, `engine-connection*`,
  `external-terminal`, `keep-awake`, `auth*`, `agents-window`, `supervisor-mcp`, `tool-worker`, the
  demo seeds.
- **The engine requires 37 loose files**, among them `shell`, `platform-paths`, `machine-profile`,
  `install-commands`, `evidence`, `skills`, `usage`, `session-cache`, `releases`, `project-map`,
  `refactor-proposals-run`, `supervisor`. An engine package takes these along; a few of them
  (`releases`, `project-map`, `refactor-proposals-run`) are domain code the engine calls from a
  step, which phase 4 below turns into feature packages the engine discovers.

### 1.4 Screens, channels and the fronts

Each screen's channel files (how many of its `window.api` calls land in each file). A `?` marks a
method the host provides outside the channel files (`openPath`, `pickFolder`, `clipboardWrite`…).

| Screen | Lines | Channel files called |
|---|---|---|
| backlog (+ roadmap) | 6,284 | backlog 15, roadmap 15, product-owner 9, agents 2, workflows 2, app 2, chat, projects, runs |
| project | 4,249 | architecture 10, refactor 8, seeds 7, runs 2, analytics 2, workflows 2, chain, backlog, diff, product-owner, projects |
| discovery | 1,977 | discovery 24, runs 2, roadmap |
| workflows | 1,519 | workflows 12, agents, skills, runs, projects, app, pipelines |
| settings (+ setup) | 1,455 | app 7, phonegates 5, storage 4, voice 2, workflows, nightwatch, app-update, engine connection, workspace |
| analytics | 1,342 | analytics 6 |
| arena | 1,253 | runs 5, projects, skills |
| oracle | 1,180 | oracle 16, chat |
| run | 1,124 | runs 6, chain 4, pipelines 2, releases, artifacts, workflows |
| duo | 1,080 | runs 5, projects, backlog |
| inbox | 1,013 | discovery 15 |
| runchat | 934 | runs 4 |
| sessions | 733 | sessions 4 |
| agents | 628 | agents 4, skills |
| nightwatch | 580 | nightwatch 6, oracle 2, app-update |
| artifacts | 536 | artifacts 3, projects |
| projects | 440 | projects 5, workflows, local-preview |
| dashboard | 408 | discovery 2, runs 2, analytics, backlog, releases |
| supervisor | 380 | supervisor 4, chat |
| usage | 331 | usage 3 |
| releases | 219 | releases 4 |
| skills | 118 | skills 4 |

Most channel files have one screen, or one family of screens, as their caller: `architecture`,
`refactor`, `seeds`, `diff` → project; `discovery` → discovery and inbox; `backlog`, `roadmap`,
`product-owner` → backlog (and a little of project); `oracle`, `nightwatch`, `usage`, `storage`,
`phonegates`, `voice` → the AI and settings screens. The cut by screen is clean.

The channel files **every front needs** are few and tell where the shell is: `runs` (9 screens),
`projects` (7), `workflows` (6), `openPath` (11), `chat` (3). Runs are the kernel of the UI: the
run state, the run list, the gate panel, the artifacts panel, the Start drawer, the agent chat and
the live turn are shared modules at the renderer's root (`app.js`, `run-list.js`, `gate-panel.js`,
`artifacts-panel.js`, `start-drawer.js`, `agent-chat.js`, `live-turn.js`, `run3d*.js`: about 5,000
of the 14,600 root lines). They cannot belong to one front; they are the UI kit.

The menu already has groups (#254, `src/renderer/nav-groups.js`): Plan & Design, Code & Build,
Workflows, AI. Twelve screens have no group (project, analytics, dashboard, settings, oracle,
nightwatch, run, runchat, artifacts, supervisor, releases' tab, setup). The fronts are the groups
made into packages, with those twelve screens given a home.

### 1.5 What is tied to the current layout

Every one of these has to learn about packages, once, in the phase that moves the files:

- `scripts/docs.js`: the code map and the test map from file headers; `src/renderer/index.html`
  generated from the files in `src/renderer/` and `src/shared/` (164 `<script>` tags, 41 of them
  `../shared/...`). The renderer has no bundler, by decision; the 3D views are the exception
  (`scripts/build-3d.js` → `generated/`).
- `test/`: 888 files with relative requires (`../src/engine`, `../../src/service`…). Moving code
  means a scripted rewrite of hundreds of requires, with the CRLF cautions of
  [windows-gotchas.md](agents/windows-gotchas.md).
- `scripts/package.js`: `@electron/packager` + fuses + `resources/bin/`. With npm workspaces,
  `node_modules` holds symlinks (junctions on Windows) to the packages; the packager and the asar
  need to be checked with them, and `node-pty` stays a native module of the desktop app.
- `scripts/ci-plan.js` (which OS runs what), `scripts/smoke.js`, the screenshot runner, the
  `MULTIAGENT_SIMULATION_ONLY` guard, the `__dirname` rule for bundled defaults
  (`workflows/`, `skills/`…).
- The hard rules in `AGENTS.md` that name folders (`src/service/channels/`, `src/renderer/views/`,
  `src/shared/`), the discovery-by-folder mechanisms (channels, areas, views, screenshot seeds) and
  the tests that enforce them (`channel-schema-ratchet-338`, `platform-literals-351`,
  `provider-registry-348`).

## 2. The four fronts, assessed

| Front | Screens today | Engine-side code | Assessment |
|---|---|---|---|
| **Project Analyser** | project (architecture, refactor, seeds, diff, hot files), analytics (incl. repository performance: delivery speed, open PRs), the project city (`poc/city-modes`, `release-city`, `project-map`), part of dashboard | `architecture-facts`, `refactor-*`, `seeds`, `oracle-architecture`, `po-hot-files`, `repo-performance`, `project-map`, `release-city`, `conflict-map`, `coverage-summary`, the `analytics` area | Clear purpose and a clean cut: its channels have no other caller. The most reusable front (a repository analyser standing alone). The "suggested flows" idea maps to `workflow-requirements` / `workflow-compose`. |
| **Code & Build** | projects, backlog + roadmap + Product Owner, releases, sessions, workflows (definitions, runs, pipelines), run, runchat, artifacts, supervisor, agents, skills, arena, duo | `backlog`, `roadmap-*`, `product-owner`, `po-split`, `epics`, `issues`, `releases`, `local-push`, `local-preview`, `workflow-*`, `pipelines`, `supervisor-*`, `agents`, `skills`, `runs`, `chain` | The biggest front and the one that owns the run kernel. Risk: it stays "the app" and the others look like satellites. Mitigation: the run kernel goes to the UI kit (not to this front), so Code & Build is only its screens. |
| **Settings** | settings, setup, usage, account, night watch, oracle | `settings`, `storage`, `phonegates`, `voice`, `app-update`, `usage`, `night-*`, `oracle-*`, `auth*`, `budget`, `provider-accounts` | The weakest cut as named. Settings, Setup, Usage and Account are configuration and belong to the shell (every front needs them). Night watch and Oracle are agents that act on the workspace: a front of their own, the existing **AI** group ("AI & Automation"). Recommendation: a front `ai` (oracle, nightwatch, agents, skills, usage), and settings/setup/account in the shell. |
| **Design & Plan** | inbox, discovery (ideas → cards → roadmap proposals), and today also arena and duo | `discovery-*`, `roadmap:propose`, `pasted-images`, `speech` | Clear purpose. Arena and duo start runs to compare approaches: they are ideation tools and can stay here, or move to Code & Build; decide by who uses them. Documents (the "elaboração de documentos" of the intent) are the run artifacts of discovery runs: this front needs the artifacts panel from the kit. |

Cross-cutting, and therefore the **shell** rather than a front: Home/dashboard, the header
(project selector, usage widget, notifications, occupancy chip, account chip), the sidebar and its
groups, Settings/Setup, the terminal dock, the engine connection, the Start drawer, toasts and
dialogs.

## 3. Target layout

One git repository, npm workspaces. No git submodules and no separate repositories: with one
owner, 1,330 commits and PRs that routinely touch engine, UI and tests at once, separate repos
would add cross-repo versioning, chained PRs and lose the atomic history; submodules add both
problems and a worse checkout.

```
package.json                 workspaces: packages/*, fronts/*, apps/*, content
packages/
  shared/                    src/shared as is: pure, dual-load (Node + <script>)
  engine/                    src/engine, src/service, src/server, src/control, the 103 backend
                             loose files grouped by domain (engine/domains/<oracle|refactor|roadmap|…>)
                             bin: multiagent-engine (today's `npm run serve`)
  ui-kit/                    the renderer's root: shell (app.js, view-registry, nav-groups, header),
                             run kernel (run-list, gate-panel, artifacts-panel, start-drawer,
                             agent-chat, live-turn, run3d*), controls (select, toast, alerts,
                             status-pill, image-viewer, diff-viewer, robots), style.css tokens
fronts/
  analyser/                  views: project, analytics, city; features; tests
  build/                     views: projects, backlog, roadmap, releases, sessions, workflows,
                             run, runchat, artifacts, supervisor, arena, duo; features; tests
  plan/                      views: inbox, discovery; features; tests
  ai/                        views: oracle, nightwatch, agents, skills, usage; features; tests
apps/
  desktop/                   src/host/main.js, preload, ipc-guard, window-guards, permissions,
                             engine-connection*, external-terminal, keep-awake, auth, package.js,
                             assets; its composition lists the fronts it ships
  web/                       the browser composition served by the engine (index.html + api-http)
content/                     workflows, fragments, skills, pipelines, seeds: the bundled defaults
native/                      unchanged (cargo workspace)
```

**How a front plugs in.** The contract is the one that exists: a view is a folder that calls
`registerView` (`view-registry.js`); a front is a package of such folders plus its CSS and its
features. A **composition** (one file per app: `apps/desktop/composition.js`,
`apps/web/composition.js`) lists the fronts to ship; `scripts/docs.js` generates `index.html` from
the composition instead of from `src/renderer/`. Building one front is a composition with one entry;
building all is the default composition. `npm test -w fronts/analyser` runs one front's tests; the
root `npm test` runs every workspace.

**Where the engine side of a front lives.** Two options, which phase 4 decides:

- *Horizontal* (phases 2 and 3): the engine package owns every channel file and domain module; a
  front is UI only. Simple; a front still cannot be developed without touching `packages/engine`.
- *Vertical* (phase 4): a front package carries its channel files, area files and domain modules
  (`fronts/analyser/engine/channels/architecture.js`, `.../domains/refactor-*.js`), and the engine
  discovers channel files from the installed fronts the way it already discovers them from a folder.
  This is what makes a front independent in code and tests, and what lets an engine build ship only
  the channels of the fronts it serves. Recommended, as the end state.

## 4. Phased plan

Each phase is useful on its own and is a stopping point; none starts before the previous one is
merged, packaged for Windows and run against a remote engine. Sizes are PR counts, not calendar.

| Phase | What | Gate | Size |
|---|---|---|---|
| 0 | Decisions (section 5) recorded in [decisions.md](agents/decisions.md); the composition contract written in [renderer.md](agents/renderer.md). | Owner's sign-off. | 1 PR |
| 1 | **Tidy, no packages.** The 32 host files to `src/host/`; the 103 backend loose files to `src/domains/<name>/` by the clusters of 1.3; tests follow their modules into `test/<area>/`. `docs.js`, `ci-plan.js`, the smoke and screenshot runners learn the new paths once. The `AGENTS.md` rules that name folders are updated. | `npm test`, `npm run docs --check`, smoke, packaged exe on Windows. Measured by `scripts/dep-map.js`: zero loose files. | 3–5 PRs, mechanical. **Done** (#560, #561, #562): 14 host files (the workers, `supervisor-mcp` and the demo seeds stay with the domain that spawns or requires them); domains: agents (agent-inbox, agents, agents-usage, skills), analytics (analytics, analytics-demo, time-zone), backlog (backlog, backlog-refresh, epics, issues), chat (chat-progress, mic-permission, pasted-images, speech), cli (claude-auth, cli-config-dirs, cli-sessions, cli-trust, provider-accounts, token-check), discovery (clarity, discovery, discovery-commit, discovery-import), evidence (artifact-categories, coverage-summary, evidence, findings, result-summary, ui-review-checks), local (local-preview, local-push, local-usage, local-usage-worker), machine (install-commands, machine-profile, native-bin, platform-paths, shell, terminals, tool-worker), night (night-limits, night-watch, night-watch-demo), oracle (oracle-*), po (po-hot-files, po-split, product-owner), project (architecture-facts, base-health, conflict-map, project-inputs, project-manifest, project-map, projects, repo-performance), refactor (refactor-*), releases (release-city, releases), roadmap (live-roadmap, roadmap, roadmap-history, roadmap-merge, roadmap-undo), run (occupancy, run-analysis, run-artifacts, run-costs, run-owner, run-pr, run-record, runs, step-regressions), seed (seed, seed-tool-issue, seeds), session (app-sessions, session-cache, session-tail), supervisor (supervisor-*), usage (actions-usage, budget, cost-estimate, usage), workflow (pipelines, workflow-builder, workflow-categories, workflow-compose, workflow-requirements, workflows), workspace (app-update, code-version, json-schema, main-log, mobile-gates, notifications, state-file, store, worker-client, workspace). |
| 2 | **Engine package.** `packages/shared`, `packages/engine` (engine + service + server + control + domains), `apps/desktop` (host); root `workspaces`. `npm run serve` becomes the engine's bin. Contract tests move to the engine. Packager and asar checked with workspace symlinks; `node-pty` stays in `apps/desktop`. | The desktop app runs with the in-process engine and attached to a remote one; `test/contract/` green over HTTP; Windows exe. | 4 PRs (#563, #564, #570, #571), 2026-10-25: merged pending the owner's checks (the Windows exe, a run against a remote engine). Final mapping: `packages/shared/` = `@multiagent/shared` (the files of `src/shared/` at the package root); `packages/engine/` = `@multiagent/engine` (`engine/`, `service/`, `server/`, `control/`, `domains/` at the package root, so the requires inside it stay relative; `bin/multiagent-engine.js` is the former `scripts/serve.js`; the account sign-in `auth`/`auth-config` moved from the host to `domains/account/`, and the server side of the engine connection to `server/listen-host.js`, re-exported by the host); `apps/desktop/` = `@multiagent/desktop` (`host/`, `renderer/`, `assets/`, `scripts/package.js`; `node-pty`, xterm, marked, dompurify its dependencies); the root `package.json` keeps `main` (`apps/desktop/host/main.js`), depends on the three workspaces and names the UI folder the server serves (`multiagent.ui`). Across packages everything is required by name (`@multiagent/<pkg>/<path>`); `scripts/source-tree.js` is where the tooling learns the layout. Bundled defaults, the app version and the server's static root come from the app root (`domains/workspace/app-root.js`: the first `package.json` above the module with `workspaces` or a `multiagent` section, since the packager strips `workspaces`). Tests follow their packages (`<workspace>/test/`, `npm test -w`); the root `test/` keeps the repository's own. The packager still packages the workspace root: the asar holds `packages/`, `apps/` and the dereferenced copies under `node_modules/@multiagent/`, the workspaces' `test/` and `scripts/` ignored. |
| 3 | **UI kit and fronts.** `packages/ui-kit` from the renderer's root; four front packages from `views/`; the composition file; `index.html` generated from the composition; `features/` split per front; `apps/web`. | Each front builds alone (composition of one) and all together; e2e per front; screenshots unchanged. | 7 PRs (#580, #581, #582, #583, #585, #586, #587), 2026-10-25, child issue #579: merged pending the owner's checks (the Windows exe, a run against a remote engine). Final mapping: `packages/ui-kit/` = `@multiagent/ui-kit` (every root module of the renderer but `api-http.js`, `style.css`, `run3d/`, the shell's screens `views/dashboard/` and `views/settings/`, `home-cards.js`); `fronts/<id>/` = `@multiagent/front-<id>` with `views/`, `features/` (+ `steps/`), `test/` and a Home card `<id>-home.js`: `analyser` (project, analytics; `city3d/`, `poc/city-modes*`), `build` (projects, backlog, releases, sessions, workflows, run, runchat, artifacts, supervisor; the menu group id `code` became `build`), `plan` (inbox, discovery, arena, duo), `ai` (oracle, nightwatch, agents, skills, usage: the Usage screen goes with its menu group, the header's usage widget is the kit's); `apps/desktop/renderer/` keeps `index.html` (generated from `apps/desktop/composition.js`) and the engine connection page; `apps/web/` = `@multiagent/web` (`composition.js`, `renderer/index.html`, `renderer/api-http.js`), what `multiagent-engine` serves at `/`. The tooling learns the layout once (`scripts/source-tree.js`: `fronts`, `composition`, `pageDirs`, `pageFile`, `pageFiles`); `scripts/docs.js` generates each app's page from its composition (the kit, the fronts in order, the app's own files; a `load: after` names a file of its own package, else of the kit); `scripts/e2e.js --front <id>` runs one front's features; `node scripts/dep-map.js` reports the channel files called from more than one front (phase 4's input: `backlog`, `chain`, `product-owner`, `roadmap`, `skills`, `agents`, plus the shell's `projects`, `runs`, `workflows`, `chat`). Phase 3 keeps every channel file and domain module in `packages/engine` (decision 1). |
| 4 | **Vertical slices.** Each front's channel files, areas and domain modules move into its package; the engine discovers channels from installed fronts; `channel-schema-ratchet` runs per package. | A front's `npm test` touches only its files; an engine build with one front serves only its channels. | 4–6 PRs. **Done** (#590, #591 the mechanism, #592 analyser, #593 plan, #594 ai, #595 build, #596 the docs): the contract is [agents/engine/fronts.md](agents/engine/fronts.md). A front declares itself (`multiagent.front`) and carries `engine/{channels,areas,domains}/`; `packages/engine/service/fronts.js` finds the installed fronts and the service loads their files with the kernel's in one order by file name (the manifest and the contract hash unchanged); the desktop app passes its composition, `multiagent-engine` serves the web composition (`--fronts` narrows it); a one-front engine answers 404 for a front not served. The mapping, decided file by file from `scripts/dep-map.js` (a file called by one front moves; one called by several fronts, by the shell or by the engine stays): `analyser` the channels `architecture`, `refactor`, `seeds`, `diff`, the area `diff`, the domains `refactor-outcome`, `seed-tool-issue`; `plan` the channel `discovery`, the area `discovery-automations`, the domain `discovery-import`; `ai` the `oracle:*` channels (the Oracle service became the kernel area `areas/oracle.js`: the run area, the seed runs, the Product Owner and the Night watch call it); `build` the channels `local-preview`, `supervisor` and the area `local-preview` (the kernel stops a preview through an optional hook). The kernel keeps the shell-called files (`analytics`, `nightwatch`, `phonegates`, `voice`, `pasted-images`, `usage`, `storage`, `app*`), the files several fronts call (`backlog`, `roadmap`, `product-owner`, `agents`, `skills`, `chat`, `chain`, `runs`, `projects`, `workflows`, `findings`, `notify`, `releases`, `artifacts`, `sessions`, `pipelines`) and the domains the engine's steps call (`supervisor`, `release-city`, `project-map`, `refactor-proposals-run`): no step registry in this phase (an open idea in [agents/backlog.md](agents/backlog.md)). |
| 5 | Optional: publish `packages/engine` and `packages/shared` to npm; `content` as a package others install. | A product decision, not a layout one. | — |

Stop after phase 1 if the only consumer stays the desktop app and separate builds are not needed:
the tidy alone removes the 135-file root and makes every later phase cheaper. Phases 2 and 3 are
what the owner asked for; phase 4 is what makes "independent code and tests per front" literally
true.

## 5. Decisions taken by the owner (2026-10-24)

The seven questions this study raised, decided in the owner's session of 2026-10-24. Phase 0 (#559)
recorded them as the 2026-10-24 entry of [decisions.md](agents/decisions.md); this section keeps the
longer form. Phase 1 (#560, #561, #562) is the first to implement anything of this study.

1. **Vertical fronts, reached in phase 4.** Phases 2 and 3 keep every channel file and domain
   module in the engine package; in phase 4 each front takes its channels, areas and domain
   modules, and the engine discovers channel files from the installed fronts. Not attempted in
   phase 3, so its PRs stay small.
2. **Settings is the shell; the fourth front is `ai`.** Settings, Setup, Usage and Account belong to
   the shell (every front needs them). Oracle, Night watch, agents and skills form the `ai` front:
   the menu's existing AI group (#254). Confirmed on 2026-10-25 (#579): the Usage *screen* goes
   with the AI group (`fronts/ai/views/usage/`, its menu group), the header's usage *widget* with
   the kit; Settings, Setup and Account are the shell.
3. **Arena and Duo stay in Design & Plan**, as ideation tools, until a user asks otherwise.
4. **The 3D bundles split by owner.** The project city (`poc/city-modes`, `generated/project-city.js`,
   `release-city`, `project-map`) goes to the `analyser` front; the run's 3D view (`run3d*`) goes to
   the UI kit, since every front that shows a run can open it. `scripts/build-3d.js` builds one
   bundle per owner.
5. **Home is the shell, and each front registers its cards**, the way screens register themselves
   (`registerView`), so a build shows only the cards of the fronts it ships.
6. **npm workspaces hoist as they do by default**: one `node_modules` at the root; `node-pty` and any
   other native module are dependencies of `apps/desktop`, where the packager rebuilds them.
7. **Folders and ids as proposed**: `packages/{shared,engine,ui-kit}`, `fronts/{analyser,build,plan,ai}`,
   `apps/{desktop,web}`, `content/`. The front ids become the menu group ids of #254.

## 6. Alternatives considered

- **Several repositories or git submodules.** Rejected (section 3): the cost falls on the one
  person who merges, and the atomic PR across engine, UI and tests is the project's working unit.
- **Folders only, no workspaces** (phase 1 only). Valid if separate builds are not wanted; it does
  not give per-front tests or builds.
- **Fronts as runtime plugins** (loaded from the workspace, like skills). Over-engineering now:
  the fronts are the owner's code, built with the app; the composition file gives the same
  independence at build time without a plugin API to keep stable.
- **A bundler for the renderer.** Not needed for the split: the composition generates
  `index.html` as today. It can be added later for one front without affecting the others.

## 7. How to re-measure

```
node scripts/dep-map.js              # areas, loose-file clusters, engine-side needs, view → channel files
node scripts/dep-map.js --json out.json
```

After phase 1 the report should list zero loose files; after phase 3, every screen's channel files
should fall inside its front's package, with `runs`, `projects`, `workflows` and the host's
methods as the only cross-front calls.
