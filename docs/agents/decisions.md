# Owner decisions

The owner's standing product decisions, newest first: the date, the decision, why, and the
issue(s). Read the entry of an area before changing behaviour an earlier decision set; to change
one, ask the owner in an issue, and the run that implements it updates the entry (the issue skills
add that Docs task when an issue has a product-wide "Decision (owner)" line). A replaced decision
appears once, in its latest form, naming what it replaced. The hard rules of
[AGENTS.md](../../AGENTS.md) are not repeated here. This is not the `decision-log` skill (a run's
own `decisions.tsv`). Dates are the issue's (or the owner session's) date.

- **2026-10-23** (#476): the Linux AppImage keeps its AppRun fallback to `--no-sandbox` when the
  kernel forbids unprivileged user namespaces (Ubuntu 23.10+), but only as a last resort and never
  silently: the launcher warns on stderr and sets `MULTIAGENT_NO_SANDBOX=1`, Settings › About shows
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
  src/engine/run/templates.js). The Workflows screen says to install only trusted ones, and the
  Builder asks once before saving a custom workflow, remembered per file by the fingerprint of its
  text (settings' `trustedFiles`, like Run App's confirmation). Skills and seeds have no import or
  save flow in the app yet, so only the notice covers them. Why: a downloaded workflow could run a
  command an agent's output (or its own template) chose.
- **2026-10-15** (#404): the developer finds the repository's rule check failures in its own turn,
  before the suite. `npm run check` runs the fast rule checks (lists, layers, file sizes, code
  health, decisions log, docs, types, the Oracle's capabilities) with the same code the rule tests
  call; the developer runs the project's check command before its final answer, and in AI
  Development (local hero) an agent-less step runs it after each commit (input `check_command`,
  default the project's `check` script, none: skipped). A failure goes back to the developer, never
  to the test writer, at most twice per review round, then to the owner at `check_failed`. The suite
  still runs every test, the rule tests included. Why: rule tests failed in 16 of the 32 runs with a
  red first suite round, each costing a suite round (4.7 min median) and a fix turn.
- **2026-10-15** (#396): the owner may choose, before a run, that an AI Development (local hero)
  run whose suite is red only outside the change goes on to the build and the merge, reported as
  not tested green (input `suite_red_outside_change: ask | continue`, default `ask`). A failure in
  the change, or a suite that cannot run, still opens `test_failed`. The gate is never answered by an
  agent: with the policy on it does not open for failures outside the change; the supervisor, the
  Oracle and the Night watch never change the input of a run in progress. A timed-out round is
  checked like a failure (the files still running rerun alone, on the branch and on the base).
  Why: a flaky or hanging test the change never touched held the roadmap for hours at the gate (#386).
- **2026-10-15** (#395): the roadmap can move on past an item or a stage without answering its human
  gate ("Move on": the item is `parked`, which counts as finished for its stage, and the next stage
  starts without its change). The gate stays the owner's: nothing answers, stops or closes it. A gate
  answered later gives the item the run's outcome (done when it merged, else failed), and a parked
  item never pauses the roadmap after the fact. The Night watch moves on by itself only with the
  `skip` permission, after `settings.oracle.parkAfterMinutes` (default 15) at the gate with nothing
  else of the roadmap running; it still never answers a gate. Why: "my goal today is to work without
  stopping" (one gate held stages 96 to 104 for about 4 hours on the night of 2026-10-14).
- **2026-10-14** (#387): the developer builds with `design-system` beside `ui-conventions`, whose
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
  issue" and the epic body line (one place: `src/shared/language.js`). JSON keys and enum values,
  paths, branches, labels, `- [ ]`, `#n` and closing keywords never change; the source, the bundled
  workflows and skills, logs and tests stay English. Grill me's questions come from the clarity
  rubric (`src/clarity.js`, no model call): app text, so they follow the interface language (#329),
  not this setting. Why: an owner who works in another language
  read English summaries and documents, and a repository's issues are not always in the owner's
  chat language; the output contract keeps the keys in English so #94 does not come back.
  The interface language (#329, #330, of 2026-10-12) is a setting too (Settings › General ›
  Language › Interface), separate from these two, and every screen follows it (#330: each view,
  the shared renderer modules, the Agents window and the screen text of `src/shared/`); until one is chosen it follows the computer's
  language when it has a catalog, else English. Its text lives in `src/shared/i18n/<lang>.json`
  (English the source, a missing key shows the English text) behind one `t()`
  (`src/shared/i18n.js`); dates, numbers and percentages follow it, costs stay in US$ with the
  language's separators; user content, workflow YAML texts, skills, agents' messages, engine errors
  and logs are never translated. Why: an owner who works in another language read an English-only
  app, and logs and errors must stay searchable and reportable.
- **2026-10-13** (#357, #378): refactor proposals (Architecture findings or the owner's) are prioritized
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
- **2026-10-13** (#381, #382): one click analyses a project: "Analyze this project" in the
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
  is one deterministic model (`src/shared/city-model.js`) from #356's facts and a city plan, drawn
  by the 3D view (#373). The plan of any project is written by an agent, the cartographer of the
  `project-map` workflow (skill `project-map`, one for every kind of project), and validated by
  rules (95% of the drawn files match a district); the cartographer is read-only on the project
  (it never writes into its code, docs or `AGENTS.md`/`CLAUDE.md`), a human gate approves the plan,
  a refresh keeps the ids and the names the owner saw, and a run starts only on a click in the
  Architecture tab, which only advises a refresh (over 5% unmatched, or a new top-level folder). Why:
  evaluated on this repository, groma.md gave 112 one-file "renderer" containers, 81% of the files
  "unidentified" and no relationships, and it writes into `AGENTS.md`/`CLAUDE.md` and serves on all
  interfaces; placing every file with a model is costly and goes stale with the next commit.
- **2026-10-13** (#368): a run or a roadmap stage can be paused after the current agent turn: an
  agent is never stopped in the middle of a turn (nor a running command), the run ends `paused`
  with everything kept, and Resume continues from that point without redoing a finished turn. A
  pause never answers a gate (a run at a gate pauses at once and asks it again on Resume), and only
  the owner resumes a paused run (never the Night watch, the Oracle or the supervisor). Why: Stop cut
  the turn in progress and Pause on the roadmap let the runs in progress go on, so updating the app,
  the CLIs or the issues meant waiting for the runs or losing work.
- **2026-10-13** (#360): analyses beyond the Architecture tab's fixed one are **analysis seeds**:
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
  pure core in `src/shared/`; complexity comes only from a real tool, never a regex; the analysis is
  the Oracle's, on demand, in its daily budget. What the Oracle finds feeds the Refactor tab, where
  the Product Owner prioritizes. Why: a parser per language cannot be the base when a project can be
  in any language, or several.
- **2026-10-13** (#367): a machine profile sizes the concurrent runs and the test workers per run
  from the machine (threads, RAM), shown with its reasons in Setup and Settings › Execution and
  always overridable: a manual value wins and stays when the machine changes. It never lowers a
  value the owner set by hand on its own, never stops a run and never changes the memory guard's
  limits; the memory guard's history only suggests (Apply). Why: a new user could not tell how many
  runs at once were safe until the machine froze.
- **2026-10-11** (#313, #314, #315): the app is free, open-source software under the MIT licence,
  for Windows, macOS and Linux. The trial is removed; sign-in stays required in the packaged app
  only to count the people using it (the account gates nothing). The history is not rewritten.
  Why: without a licence the code is not open source, and the owner wants to know how many people
  use the app.
- **2026-10-04** (#247, #245): Ask for changes at a validation gate goes to the test writer first. It
  only checks whether the request changes the acceptance criteria: if so, it updates the affected
  acceptance tests and scenarios (then the red check); otherwise the run goes straight to the
  developer. Why: the locked tests still described the old behaviour and cost extra rounds.
  (#245, same day) No snake_case or file-name id is shown to people; agents and steps have a
  readable `display` name, and ids stay in tooltips and details for debugging. Why: screens showed
  internal ids such as "acceptance_tests" where people read them.
- **2026-10-04** (#241, #240, #105): each area has one owner. The Backlog (issues, roadmap, queue)
  belongs to the Product Owner; workflows, skills and runs belong to the Supervisor. The Oracle
  reads everything, diagnoses and proposes, but routes every change to the owning agent. Why: the
  Oracle's changes ended in its own history, made by an agent that does not hold that area's rules.
- **2026-10-03** (#332, #222, #211, and #47 of 2026-09-29; options of #203, scenarios of #223):
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
- **Isolated Claude agents load no settings file** (#468, SEC-3): `--setting-sources ''` instead of `project,local`; the checkout's `.claude/settings*.json` is never read (no scan-and-refuse path). The app auto-trusts only `runs/`, `skills/` and `workflows/`; `repos/`, `worktrees/` and project folders keep the CLI's own trust prompt, which a live cli-new terminal shows to the user. Why: those files come from the repository and can declare hooks or `permissions.allow` that Claude Code honours before `--allowedTools`, headless and without a prompt.
- **Child processes get an allowlisted environment** (#470, SEC-5): `childEnv` (`src/engine/child-env.js`) for agents, actions, probes, the suite and the terminals; `GH_*`/`GITHUB_TOKEN` only with `bash:gh` (or a free `bash`), `GITLAB_*` only with `bash:glab`; the suite gets no platform token; `printenv` is no longer an allowed utility; the spawn event records only the keys. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and proxies stay out: a workflow that needs them lists them in `env.passthrough` (workflow level only). Why: a prompt-injected agent or a repository's test script could read and publish the user's cloud and API credentials.
