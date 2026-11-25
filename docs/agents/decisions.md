# Owner decisions

The owner's standing product decisions, newest first: the date, the decision, why, and the
issue(s). Read the entry of an area before changing behaviour an earlier decision set; to change
one, ask the owner in an issue, and the run that implements it updates the entry (the issue skills
add that Docs task when an issue has a product-wide "Decision (owner)" line). A replaced decision
appears once, in its latest form, naming what it replaced. The hard rules of
[AGENTS.md](../../AGENTS.md) are not repeated here. This is not the `decision-log` skill (a run's
own `decisions.tsv`). Dates are the issue's (or the owner session's) date.

- **2026-11-25** (#69): the simulation is off by default, and the first-run Setup has two steps, Agents
  and First project. Setup never writes `developerMode`: a fresh workspace's Product Owner and Start are
  real, and a workspace that has developer mode on keeps it. The simulation is turned on in Settings ›
  Execution › Developer mode; the machine's line is read there too, and Start says a real run uses the
  CLI subscriptions. Replaces Setup's Try it safely step, which turned the simulation on (#319). Why:
  the same app behaved differently after Next and after Skip, and a new user's first issue was only
  previewed, never filed.
- **2026-11-01** (#730): a project's page has the tabs Overview · City · Health · Conflict map (last).
  Health holds the git facts (free, no model) on top and the Oracle's latest report (summary, verdict
  per area, findings) below, with its report picker and a rerun with its estimate. There is no
  Refactor tab and no Product Owner ranking of proposals: a finding becomes an issue from where it is
  (Create issue: a GitHub/GitLab issue labeled refactor with the finding's text, files and evidence;
  Create issue and prioritize: the same, then a planned roadmap item), and then shows the issue's link
  and its roadmap stage. The onboarding sends no finding anywhere on its own and runs no `ranking`
  job; its review lists the findings with the same two buttons. Older proposals stay readable under
  their finding; the `refactor` workflow still runs on an issue made this way. Replaces "what the
  Oracle finds feeds the Refactor tab, where the Product Owner prioritizes" (#356, #357). Why: a finding
  and a proposal were the same diagnosis twice, and the onboarding marked every finding as sent
  before the owner saw it.
- **2026-11-01** (#658, #702, #651, #633): the AI-native SDLC stays out of Code & Build. The
  `feature`, `fix` and `release` workflows (and a user's own) take an issue and hand back a PR and
  their evidence as declared outputs; they never read or write `docs/work/`. A pre-flow writes an
  item's documents before the Build (write doc: intent, spec, then `plan.md`, each at its gate, then
  the plan's steps filed as issues). A post-flow, started by the chain (`then`,
  `docs/agents/engine/chaining.md`) when a Code & Build run finishes with success, reads that run's
  outputs and records them: `sdlc-record` (the `plan.md` Progress row, the `test.md` evidence row),
  `sdlc-test` (the Test stage, at the code owner's gate, started from the Roadmap) and
  `sdlc-release` (`deploy.md`, the changelog). A failed or stopped run starts nothing and leaves
  Progress `pending`. Replaces the `record_docs` step inside feature/fix (#702), the documentation
  step in the workflows (#658's intent) and "the feature workflow writes `plan.md`" (write doc
  R13/R16, onboarding R9). Why: SDLC steps inside every build workflow meant two homes for the
  evidence, conditional steps, doc lint and translations able to block a code merge, model calls
  for prose in every run, and users' own workflows left out.
- **2026-11-01** (#696): a new screen with no baseline never stops a run at a human gate. After
  develop, `baseline_check` sends a new `@visual` scenario with no PNG under
  `features/__screenshots__/` back to develop (naming the file and the update command), and the
  code review treats a missing baseline as blocking. One that still reaches the E2E step is
  generated, listed as `new_baselines` for the UI review against the issue's mockups, and is not a
  failure; only a difference with an existing baseline goes to the healer and `test_failed`. An
  existing baseline is never rewritten by a run. Why: #671's run stopped at `test_failed` on three
  missing baselines after an approved review, where only a person could fix them.
- **2026-11-01** (#695): tests never read live documents: a document under `docs/work/` is copied
  into `test/fixtures/` and the test reads the copy (`npm run check`'s `test-fixtures` rule). A
  test that reads files from disk runs when those files change: the affected-test selection counts
  a test's resolved reads (a file, a listed folder) as its dependencies. The base check files one
  issue per cause (the test file and its first red commit), listing every failing test, and
  updates an open one instead of opening another. Why: on 2026-11-01 a docs PR moved the sections
  of a spec two tests read, a new screen folder broke a test that lists them unselected, and the
  base check filed 20 issues for those 2 causes.
- **2026-10-31** (#670, #669): a spec's mockups are the specification of its screens. The Product
  Owner's plan and issue turns, when the question names a work item (`docs/work/<item>/`) that has
  mockups (images or HTML, `po-mockups.js` `findMockups`), get them listed and must write every
  screen task as "matches `mock-1.jpg`: layout, icons, texts, controls, order", embedded, with what
  the phase does not do yet "visible and disabled, as in the mockup"; requirement numbers alone are
  not accepted. A split gives each child the mockups of its tasks and refuses a child whose tasks
  cite a mockup it lacks (`po-split.js`). Proposing issues from a spec (Documents › Create epic and
  phase issues) shows the mockup coverage in the PO drawer: a mockup in scope with no issue keeps
  the proposal off the roadmap ("mock-4.jpg has no issue"), the `## Later phases` ones are listed
  as later. In ai-development-local-hero (both copies) the developer copies the issue's mockups to
  `evidence/mockups/`, looks once at its own screenshots next to them before the review, and the
  UI Reviewer compares each screenshot with its mockup: every difference is a blocking finding
  (`ui-review-checks.js` `mockupFindings`, rule `mockup`) that goes back to develop, in auto and
  validated modes alike; an intended difference cites the issue's line. An issue without mockups is
  reviewed as before. A change under the UI folders with no screen listed goes back to develop once
  instead of skipping the capture. Why: #638-#644 shipped a wizard that did not look like its
  approved mockups, and in auto mode nothing compared them before the merge.

- **2026-10-31** (#647, #636, write doc phase 1): the stage documents of a work item
  (`docs/work/<item>/intent.md`, then `spec.md`, each with its `pt-BR` translation, the playbook's
  sections) are written in Plan & Design › Documents with one writer (`workflows/write-doc.yaml`, the
  `intent-writing` / `spec-writing` skills). The agents only read: the Documents service
  (`packages/engine/fronts/plan/domains/docs.js`) is the only code that writes them. Editing is by selection on
  the rendered page (a sandboxed iframe without scripts); each request is a writer turn of the
  `human_edit` gate (a protected gate: the supervisor and the automatic answers never end it, only
  the person's Send to review does) and **one commit per request**, swapped into the source and its
  translation, undone one by one by a revert. The reviewer anchors its notes to sections and sees
  only the changes not marked reviewed. The SDLC gates are the person's: Accept intent and Sign off
  spec change both front matters (status, approver from the repository's git identity, date) in one
  commit; after the sign-off, Create epic and phase issues and Start the Build wait for the owner's
  click, nothing is filed or started by itself (Create epic and phase issues asks the Product Owner
  for the spec's issues and their mockup coverage since #670; Start the Build opens the Roadmap). Why: each request stays
  a change the person can read, review and undo on its own, and a stage only moves on when its owner
  signs it. Write & Review and AI
  Arena stay in the menu until phase 2. Checked simulated only. Spec and plan:
  `docs/work/write-doc/` (the tech lead signs R4, R9 and R13).

- **2026-10-31** (#629, #628, first project onboarding phase 1): a new project is made in a 4-step
  wizard (start, repository, analysis, review: `fronts/build/views/projects/project-wizard.js`),
  opened by Home's empty state, Projects › New project and the Setup's last step; Edit keeps the old
  dialog. The clone is a job of the engine (`cloning | ready | failed`, an access check first): a
  refused access or a failed clone ends `failed` with a readable reason and Retry, never `ready`.
  The free analyses (facts, the Ways of working profile) run after the clone; the paid ones (the
  project map, the ranking) only on the owner's click, their cost shown before it, and "analyze
  later" never calls a model. The progress tray stays when the wizard closes; Finish never waits for
  an analysis (one still running notifies when it ends). The project page leads with a "Next steps"
  card (the refactors to the roadmap, the first idea, the refactor cadence; release CI and
  screenshots come in a later phase). Setup loses its Workflows step. Phase 1 covers spec R1, R2,
  R3, R5, R7 (today's workflows), R10, R11; create new, the revisited profile, the work model and the
  Monitor are later phases. Done as the plan's 7 steps, one run each, in order, each recorded in the
  plan's Progress table, checked simulated only (`CRAFTORIO_SIMULATION_ONLY=1`, the mock provider,
  `npm run screenshot`), no real model call. Why: the first project is the first impression, and
  nothing costs money nor fails silently in it. Spec and plan: `docs/work/first-project-onboarding/`.
- **2026-10-31** (#489 of 2026-10-22, then the owner session of 2026-10-31): releases are "rc +
  stable", and this repository's GitHub Actions run only for a release. Every merge into `main` is a
  release candidate `vX.Y.Z-rc.N` the app records (never latest); the stable release is the last
  candidate promoted with a `vX.Y.Z` tag on its commit, by the night's release train when the base
  check is green on that commit, or on demand ("Promote to stable" on the Releases screen). The train
  promotes alone only with the night permission "Promote a release" (off by default), otherwise it
  proposes; a red base check or a candidate on **Hold** stops it. The stable version is the label
  suggestion (#436) over the issues since the last stable, editable. The cut line stays the manual
  milestone checked by the full release run. In this repository the pushed tag builds every OS, runs
  `npm test` there and publishes the release as latest (`deploy.yml`) and the public page
  (`pages.yml`, which also republishes on a push to `main` that changes `docs/work/`, the changelog or
  `site/`, so approved SDLC documents show without a manual run, the agents only committing to git:
  owner, 2026-10-31); any other push to `main` builds nothing, CI (`ci.yml`) runs only by hand, and an rc
  prerelease is built only by a manual Deploy run. Replaces the tag-only release of #482 and, on
  2026-10-31, the GitHub build of every candidate (an rc on every OS per merge, promoted without a
  rebuild). Why: the owner had to remember to cut a release, and the latest build was whatever merged
  last; and the owner does not want to spend Actions minutes (macOS counts about ten times) on every
  merge or pull request while the repository is private, the runs' own suites testing each change.
- **2026-10-26** (#567, 12-Factor Agents factor 7): agents stay unattended (skills record an
  assumption or a default), with one exception beside Grill me: the agent of a step that opts in
  with `ask_human: true` may answer `needs_human: { question, options, default }`, which pauses the
  run at a `kind: decision` gate of its step; the answer comes back to its next turn as
  `human_answer`. Opt-in per step, off by default; bundled: `develop` of software-development only
  (no read-only role; ai-arena's writer `synthesize` answers free text without an `output_schema`,
  so it stays out until it has one). The supervisor never answers the question; a second one in a
  row is a stall it may settle with the agent's own default, recorded as its decision. Why: an agent
  facing a choice the owner would want to make (irreversible or costly) asks it itself instead of a
  wrong default found at the next gate or a stall diagnosed after the fact; nothing blocks waiting
  for a reply. Replaces "only Grill me may ask".
- **2026-10-24** (#558, the reorganisation study `docs/reorganisation-study-2026-10.md`): the app
  becomes an engine package plus modular fronts, in one git repository with npm workspaces (no
  submodules, no separate repositories), by phases that each stop on their own: 0 these decisions,
  1 a tidy of `src/` (host files in `apps/desktop/host/`, the backend's loose files in `packages/engine/domains/<name>/`,
  tests following their modules), 2 the engine package, 3 the UI kit and the fronts, 4 vertical
  slices. Seven decisions: (1) the fronts are vertical, reached in phase 4 (phases 2 and 3 keep every
  channel file and domain module in the engine package; in phase 4 each front takes its channels,
  areas and domain modules and the engine discovers channel files from the installed fronts);
  (2) Settings is the shell (Settings, Setup, Account; the Usage screen goes with the AI group and the
  header's usage widget with the kit, confirmed 2026-10-25, #579) and the fourth front is `ai` (Oracle,
  Night watch, agents, skills, usage: the menu's AI group of #254); (3) Arena and Duo stay in Design & Plan
  as ideation tools until a user asks otherwise; (4) the 3D bundles split by owner, the project city
  to the `analyser` front and the run's 3D view to the UI kit, one bundle per owner from
  `scripts/build-3d.js` (the city's engine-side domains `release-city` and `project-map` stay in the
  engine kernel, since its steps run them on any composition: owner, 2026-10-25, #590); (5) Home is the shell and each front registers its cards, as screens
  register themselves with `registerView`; (6) npm workspaces hoist by default, one `node_modules`
  at the root, `node-pty` and any other native module a dependency of `apps/desktop`; (7) folders
  and ids as proposed: `packages/{shared,engine,ui-kit}`, `fronts/{analyser,build,plan,ai}`,
  `apps/{desktop,web}`, `content/`, the front ids becoming the menu group ids of #254. Why: the
  owner wants the engine reusable (a remote engine, a browser UI) and each front developed and
  tested on its own, and the measurements showed the seam already exists (the service never
  requires the renderer, the renderer never requires the backend) while 135 loose files at the
  root of `src/` made every later step costlier.
- **2026-10-23** (#476): the Linux AppImage keeps its AppRun fallback to `--no-sandbox` when the
  kernel forbids unprivileged user namespaces (Ubuntu 23.10+), but only as a last resort and never
  silently: the launcher warns on stderr and sets `CRAFTORIO_NO_SANDBOX=1`, Settings › About shows
  the warning, and the README gives the user's own alternative (the sysctl
  `kernel.apparmor_restrict_unprivileged_userns=0`, with its system-wide trade-off). An AppArmor
  profile shipped with the app needs root to install, which an AppImage cannot do; a `.deb` whose
  `chrome-sandbox` is setuid (or that installs the profile) is the way to a sandbox by default and
  stays a future packaging target. Assumption recorded by the run, not yet confirmed by the owner.
  Why: on Ubuntu 24.04 the AppImage ran with Chromium's renderer sandbox off and nobody was told.
- **2026-10-22** (#469, #474): workflows, skills and seeds are code. Transition `action:` and
  `ship.build` stay shell strings (the bundled ones use `&&` and `{% if %}`: an argv list would
  break them); `loadWorkflow` allows there unfiltered only an allowlist of names the workflow or
  the user controls and output fields its `output_schema` types as a number or a boolean, anything
  else goes through `github_repo`, `pr_url` or `shell_quote`, and `npm run check` loads every workflow. nunjucks cannot be sandboxed, so a template naming
  `constructor`, `__proto__`, `require` or `process` is refused at load (one list, in
  packages/engine/engine/run/templates.js). The Workflows screen says to install only trusted ones, and the
  Builder asks once before saving a custom workflow, remembered per file by the fingerprint of its
  text (settings' `trustedFiles`, like Run App's confirmation). Skills and seeds have no import or
  save flow in the app yet, so only the notice covers them. Why: a downloaded workflow could run a
  command an agent's output (or its own template) chose.
- **2026-10-15** (#404, #396, #395): #404: the developer finds the repository's rule check failures in its own turn,
  before the suite. `npm run check` runs the fast rule checks (lists, layers, file sizes, code
  health, decisions log, docs, types, the Oracle's capabilities) with the same code the rule tests
  call; the developer runs the project's check command before its final answer, and in AI
  Development (local hero) an agent-less step runs it after each commit (input `check_command`,
  default the project's `check` script, none: skipped). A failure goes back to the developer, never
  to the test writer, at most twice per review round, then to the owner at `check_failed`. The suite
  still runs every test, the rule tests included. Why: rule tests failed in 16 of the 32 runs with a
  red first suite round, each costing a suite round (4.7 min median) and a fix turn.
  #396: the owner may choose, before a run, that an AI Development (local hero) run whose suite is red only outside the change goes on to the build and the merge, reported as
  not tested green (input `suite_red_outside_change: ask | continue`, default `ask`). A failure in
  the change, or a suite that cannot run, still opens `test_failed`. The gate is never answered by an
  agent: with the policy on it does not open for failures outside the change; the supervisor, the
  Oracle and the Night watch never change the input of a run in progress. A timed-out round is
  checked like a failure (the files still running rerun alone, on the branch and on the base).
  Why: a flaky or hanging test the change never touched held the roadmap for hours at the gate (#386).
  #395: the roadmap can move on past an item or a stage without answering its human
  gate ("Move on": the item is `parked`, which counts as finished for its stage, and the next stage
  starts without its change). The gate stays the owner's: nothing answers, stops or closes it. A gate
  answered later gives the item the run's outcome (done when it merged, else failed), and a parked
  item never pauses the roadmap after the fact. The Night watch moves on by itself only with the
  `skip` permission, after `settings.oracle.parkAfterMinutes` (default 15) at the gate with nothing
  else of the roadmap running; it still never answers a gate. Why: "my goal today is to work without
  stopping" (one gate held stages 96 to 104 for about 4 hours on the night of 2026-10-14).
  (#387, 2026-10-14, folded here to keep the log short) The developer builds with `design-system` beside `ui-conventions`, whose
  design section is adapted from Anthropic's `frontend-design` (the app's tokens always win), and
  the UI reviewer's rubric has the same items: a pass/fail line of evidence per item and per
  screenshot, the 5-second message and the biggest weakness even on an approval, and the axe-core
  findings kept or dismissed with a reason. The UI reviewer's model stays the workflow's default
  (Sonnet) until the owner has the cost of the UI review on the last 10 UI items and decides
  whether UI-heavy items get a stronger one. Why: the UI review approved screens that were not
  made for a human to read (2026-10-13).
- **2026-10-13** (#327, #328, #361; of 2026-10-12 and 2026-10-13): what the AI agents write is a setting (Settings › Language): every
  chat reply, step output, handoff note, decision log and generated document follows the AI agents
  language (default "Same as the interface": the language the interface resolves to, an unset
  Interface following the engine host's computer language when it has a catalog, else English, #424). Issues, PR/MR descriptions and
  commit messages follow a separate issues language (default English), and so do Findings' "File as
  issue" and the epic body line (one place: `packages/shared/language.js`). JSON keys and enum values,
  paths, branches, labels, `- [ ]`, `#n` and closing keywords never change; the source, the bundled
  workflows and skills, logs and tests stay English. Grill me's questions come from the clarity
  rubric (`packages/engine/domains/discovery/clarity.js`, no model call): app text, so they follow the interface language (#329),
  not this setting. Why: an owner who works in another language
  read English summaries and documents, and a repository's issues are not always in the owner's
  chat language; the output contract keeps the keys in English so #94 does not come back.
  The interface language (#329, #330, of 2026-10-12) is a setting too (Settings › General ›
  Language › Interface), separate from these two, and every screen follows it (#330: each view,
  the shared renderer modules, the Agents window and the screen text of `packages/shared/`); until one is chosen it follows the computer's
  language when it has a catalog, else English. Its text lives in `packages/shared/i18n/<lang>.json`
  (English the source, a missing key shows the English text) behind one `t()`
  (`packages/shared/i18n.js`); dates, numbers and percentages follow it, costs stay in US$ with the
  language's separators; user content, workflow YAML texts, skills, agents' messages, engine errors
  and logs are never translated. Why: an owner who works in another language read an English-only
  app, and logs and errors must stay searchable and reportable.
- **2026-10-13** (#357, #378, #381, #382): refactor proposals (Architecture findings or the owner's) are prioritized
  by the Product Owner (rank, reason, complexity; the Danger Zone score as value, the conflict map
  and the roadmap's unfinished items as risk), and a cadence, off by default, adds the top ranked one
  that has an issue to the roadmap every X real runs of the project (3 to 50). The item counts in the
  budget cap and never crosses a gate. Success is measured on the map: the target's Danger Zone score
  before and after, kept with the proposal. Why: agents left alone add features and rarely
  restructure, so the cadence has to be explicit. #378: the suggestions are also a workflow
  (`refactor-proposals.yaml`), so a saved pipeline runs them after a release
  (`release-then-refactors.yaml`: release → proposals since `previous_version` → the Product Owner).
  It reuses #356's prompt and report schema (a named `output_schema: architecture_report`, not a
  copy) and #357's store, ranking and filing; known findings (an open or dismissed proposal, an open
  `refactor` issue) are dropped and named. Auto mode files the top `limit`; validated mode asks at a
  gate, where a proposal is dropped by dismissing it on the Refactor tab. Why: refactors suggested
  after every release without clicking through two tabs; the release's gates stay human.
  #381, #382 (same day, folded here to keep the log short): one click analyses a project: "Analyze this project" in the
  Architecture tab runs the project map (the city plan) and the Oracle's analysis together, as one
  run of `project-map.yaml`, with its combined estimate shown first and no human gate (validated
  mode, from Workflows, keeps a gate that shows the plan's districts and validation); the tab
  follows the run and the city can be expanded to the whole window. The city has to look like the
  approved proof of concept (`poc/project-city.html`) at the real scale of this repository: its
  layout and geometry are ported, never re-derived from a description, and the owner can pin a
  file's connections from a list of the most connected files; hovering never greys the city.
  Replaces #372's gate for every run. Why: the owner's first test found two buttons for one intent,
  a gate that showed nothing to validate, a tab stuck on "running" after the run had finished, and a
  city of stacked squares in place of the POC he had approved. Earlier the same day (#371, #372):
  the project city is on the roadmap, built from the proof of concept
  (PR #370, `poc/embed-city.js` and its two plans at 100% coverage); groma.md is not used. The city
  is one deterministic model (`packages/shared/city-model.js`) from #356's facts and a city plan, drawn
  by the 3D view (#373). The plan of any project is written by an agent, the cartographer of the
  `project-map` workflow (skill `project-map`, one for every kind of project), and validated by
  rules (95% of the drawn files match a district); the cartographer is read-only on the project
  (it never writes into its code, docs or `AGENTS.md`/`CLAUDE.md`), a human gate approves the plan,
  a refresh keeps the ids and the names the owner saw, and a run starts only on a click in the
  Architecture tab, which only advises a refresh (over 5% unmatched, or a new top-level folder). Why:
  evaluated on this repository, groma.md gave 112 one-file "renderer" containers, 81% of the files
  "unidentified" and no relationships, and it writes into `AGENTS.md`/`CLAUDE.md` and serves on all
  interfaces; placing every file with a model is costly and goes stale with the next commit.
  The same day (#368): a run or a roadmap stage can be paused after the current agent turn: an
  agent is never stopped in the middle of a turn (nor a running command), the run ends `paused`
  with everything kept, and Resume continues from that point without redoing a finished turn. A
  pause never answers a gate (a run at a gate pauses at once and asks it again on Resume), and only
  the owner resumes a paused run (never the Night watch, the Oracle or the supervisor). Why: Stop cut
  the turn in progress and Pause on the roadmap let the runs in progress go on, so updating the app,
  the CLIs or the issues meant waiting for the runs or losing work.
  (#360, same day) Analyses beyond the Architecture tab's fixed one are **analysis seeds**:
  prompts adapted from Kent Beck's ToolSeeds (MIT), bundled in `seeds/<name>/seed.md` and seeded
  into the workspace like skills. The Oracle runs a seed read-only on any project, in one turn of its
  daily budget, after the cost estimate; the result (a self-contained HTML page and a JSON model,
  scrubbed of secrets) is saved under `architecture/<project id>/seeds/` and shown in a sandboxed
  frame with no network. **Make it a tool** files an issue in the project's tracker (the Product
  Owner plans it like any item) to build the seed as a deterministic tool, following
  `promptToDeterministicTool`; once its command is recorded in the project's settings, running the
  seed runs that command, with no model cost. A seed uses only the network reads it declares, each
  a builder and parser in both platform adapters. Why: projects differ in languages, CI and quality
  gates, so a fixed analysis misses what matters or needs a tool the machine lacks; a seed that
  proves useful should become free and repeatable. (#356, same day) A project's Architecture tab
  works for any language. The deterministic
  facts (lines, churn, hotspots, co-change, languages) are computed by the app from git, through a
  pure core in `packages/shared/`; complexity comes only from a real tool, never a regex; the analysis is
  the Oracle's, on demand, in its daily budget. What the Oracle finds becomes an issue from the Health tab
  (#730, above). Why: a parser per language cannot be the base when a project can be
  in any language, or several. (#574, 2026-10-26) Which docs and rules the agents use is a script,
  `scripts/docs-usage.js` (`npm run docs:usage`), not a seed, and the `run-retrospective` workflow
  does not take its report as an input. Why: the questions are countable from the run folders, so
  no model is needed; the retrospective reads one run, the report aggregates a period. (#367, same
  day) A machine profile sizes the concurrent runs and the test workers per run
  from the machine (threads, RAM), shown with its reasons in Settings › Execution (no longer in Setup, #69) and
  always overridable: a manual value wins and stays when the machine changes. It never lowers a
  value the owner set by hand on its own, never stops a run and never changes the memory guard's
  limits; the memory guard's history only suggests (Apply). Why: a new user could not tell how many
  runs at once were safe until the machine froze.
  (#313, #314, #315 of 2026-10-11; and #247, #245, #241 of 2026-10-04, folded here to keep the log short) The app is free, open-source software under the MIT licence,
  for Windows, macOS and Linux. The trial is removed; sign-in stays required in the packaged app
  only to count the people using it (the account gates nothing). The history is not rewritten.
  Why: without a licence the code is not open source, and the owner wants to know how many people
  use the app.
  (#247, 2026-10-04) Ask for changes at a validation gate goes to the test writer first. It
  only checks whether the request changes the acceptance criteria: if so, it updates the affected
  acceptance tests and scenarios (then the red check); otherwise the run goes straight to the
  developer. Why: the locked tests still described the old behaviour and cost extra rounds.
  (#245, same day) No snake_case or file-name id is shown to people; agents and steps have a
  readable `display` name, and ids stay in tooltips and details for debugging. Why: screens showed
  internal ids such as "acceptance_tests" where people read them.
  (#241, #240, #105, same day) Each area has one owner. The Backlog (issues, roadmap, queue)
  belongs to the Product Owner; workflows, skills and runs belong to the Supervisor. The Oracle
  reads everything, diagnoses and proposes, but routes every change to the owning agent. Why: the
  Oracle's changes ended in its own history, made by an agent that does not hold that area's rules.
  (#332, #222, #211, 2026-10-03, and #47 of 2026-09-29; options of #203, scenarios of #223):
  tests are run and judged by the machine, never by a model. E2E tests stay on Playwright + BDD
  (`playwright-bdd`), run deterministically; an LLM only writes and repairs them. Which test
  failures are the run's (and which were already on the base) is decided by the orchestrator
  (failing tests rerun on the base), never by an agent. Only the test writer writes, edits or
  deletes tests; the developer changes production code only. In AI Development (local hero
  included), unit and E2E tests are `write_and_run` by default (#332, from the owner's session);
  cost is cut in prompts, retries and context, never by lowering test inputs. Replaces #199's "E2E
  scenarios run only at release time". Why: the old E2E tests asserted little, the release run paid
  a model to run the suite, failures already on main made every round fail and the run looped, and
  overlapping test responsibilities made one run pay for the full suite up to four times; the tests
  are why the app works, so savings go where they do not lower what is tested.
- **Isolated Claude agents load no settings file** (#468, SEC-3): `--setting-sources ''` instead of `project,local`; the checkout's `.claude/settings*.json` is never read (no scan-and-refuse path). The app auto-trusts only `runs/`, `skills/` and `workflows/`; `repos/`, `worktrees/` and project folders keep the CLI's own trust prompt, which a live cli-new terminal shows to the user. Why: those files come from the repository and can declare hooks or `permissions.allow` that Claude Code honours before `--allowedTools`, headless and without a prompt. And **child processes get an allowlisted environment** (#470, SEC-5): `childEnv` (`packages/engine/engine/child-env.js`) for agents, actions, probes, the suite and the terminals; `GH_*`/`GITHUB_TOKEN` only with `bash:gh` (or a free `bash`), `GITLAB_*` only with `bash:glab`; the suite gets no platform token; `printenv` is no longer an allowed utility; the spawn event records only the keys. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and proxies stay out: a workflow that needs them lists them in `env.passthrough` (workflow level only). Why: a prompt-injected agent or a repository's test script could read and publish the user's cloud and API credentials.
- **A folder with its own gotchas carries an AGENTS.md** (#572): a few lines next to the code (`packages/engine/`, `packages/ui-kit/`, each `fronts/<id>/`, `scripts/`) naming the topic doc to read first and the rules most often broken there, nothing the code already says; a `CLAUDE.md` with `@AGENTS.md` beside it where Claude must load it. The root `AGENTS.md` keeps the hard rules and the topic index; a rule that moves to a folder leaves the root. Not `.claude/rules/`: the isolated agents load no settings (#468). Why: a rule scoped to a path loads when the session works there, not only when it obeys an index line. And **a topic doc stays under 200 lines** (#573): a longer one is split into `docs/agents/<topic>/*.md` (a first heading and a one-line summary each) and `docs/agents/<topic>.md` becomes the index `npm run docs` generates. `npm run docs -- --check` lists the files over the limit as a warning (generated maps and indexes exempt) until `capabilities.md`, `decisions.md` and `engine/gates-and-run-end.md` are split, then as a failure. Why: a session loads a whole doc to use a section; the shorter the doc, the likelier it is read.
- **A restart continues the live runs by itself, at start-up only** (#607): `service/areas/recover.js` reduces the log of each run the active-run marker names (stale owner, `interrupted`) with `recoveryStateFromEvents` and continues it in its own folder with its own id at its last finished turn; the gate asks again, the cut turn becomes a `session.attempt_stopped` and `<previous_attempt>`. `owner.json` is claimed in the same tick as the liveness check; real runs under simulation-only and child runs are not recovered. Why: the owner-facing gain (no night lost to a sleep timer) with the smaller change; a per-step reducer stays a follow-up.
- **An unfinished onboarding resumes; one editor for a project** (#741): the wizard's step and picks are saved with the project's record (`onboarding: { step, picks, finished }`, `onboarding:save-wizard` on every change, `onboarding:finish` on Finish); New project with the repository of an unfinished one reopens it at its step, a finished one says it exists with Open the project. The old New / Edit project dialog is gone: creating is the wizard, editing is the project's settings (`project-settings.js`, its fields moved there first). Why: the owner's decision (2026-11-01), one place to define a project, not two.
- **Removing a project can delete its folder** (#742, `service/areas/project-remove.js`): offered unticked; a folder under `<workspace>/repos/` or `projects/` (made by the app) needs only the tick, any other folder also the project's name typed. Before deleting: uncommitted changes and commits ahead of their upstream (a branch without upstream counts when the repository has a remote; a repository with no remote has none "unpushed") are listed and asked again; a running run of the project refuses with its id. The folder goes to the system trash when possible, else is deleted; the project's roadmap, architecture and refactor data and its record go, the runs' history stays. Why: an abandoned import no longer leaves a clone behind, and the owner's own checkout is never deleted by one click.
- **A stage added before the running stage waits for it** (#697, `RoadmapModel.waitsFor`, `roadmap.js` `advance`): the owner's decision (2026-11-01). An open stage put before a stage with a run in progress starts nothing until that stage is finished, then starts before the stages after it; an item parked at a human gate (#395) is not running and holds nothing. Why: each stage starts from a base with the previous stage merged, and two stages at once can conflict at merge time and spend twice the budget of the stage the owner sees as current.
- **Sign-in is off for now** (`enabled: false` in `packages/engine/domains/account/auth-config.js`): the owner's decision (2026-11-03). Friends run the shared repository from source and the sign-in did not work for them; the account gates nothing (#315), so the app opens without one and records nothing. The desktop host and the engine server both read the switch; set it back to true to ask for the account again.
- **Runs merge only what keeps the base green** (#736, `packages/engine/engine/suite-step.js`, `packages/engine/engine/suite-last-green.js`, `test/guards.json`): every `scope: affected` round runs the repository-wide guard tests of `test/guards.json` and the slow tests the change reaches (their own file, or a file they read, edited, deleted or renamed), not only the whole suite; a failure red on the current base too is pre-existing only when it also fails on the base's last green commit (the base health's `lastGreen`), else it is the run's. Why: on 2026-11-01 the base went red three times after runs merged as green (#700, #715, #717): the guards and slow tests never ran in scoped rounds, and a full round counted their failures as pre-existing because the base was already red from an earlier merge.
- **Platform triggers poll first; the rules live in the repository** (#568, `packages/engine/domains/triggers/`): a `triggers:` list in `.craftorio/project.yaml` (issue labelled, pull request comment with a mention, CI failed on a branch -> one of the manifest's workflows, inputs templated from the event), accepted per commit with the workflows; the service polls with `gh api` / `glab api` (default every 2 min, 0 = off, off per project until the owner turns it on in Settings) and dedups by event id in `<workspace>/backlog/triggers/<project>.json`. No webhook receiver in this issue: its shape is noted so the rules need no change, `POST /hooks/triggers/<project>?key=<key>` on the engine server (like `/hooks/monitor/<project>`), the body normalised to the same events. Why: polling works on every machine without a reachable address (Tailscale works for the owner, not for everyone) and reuses the platform clients; the cost is the delay of one interval and the API calls, bounded by the back-off on 403/429.
- **The first start after the rename uses this computer's engine** (`apps/desktop/host/legacy-user-data.js`): the owner's decision (2026-11-24). The old install's data folder is still copied, but a remote `engine-connection.json` is kept as local, with its address and token, on every system; Settings › Execution › Engine switches back. Replaces T3's copy of the connection as it was. Why: a clean install came up as a client of a remote engine, on macOS with a token it cannot decrypt, and opened no workspace.
