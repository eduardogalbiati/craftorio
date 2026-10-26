# Whole simulated runs

The whole mock runs of the bundled workflows (#305, #306), their inventory and the production files no test reaches.

## Whole simulated runs (#305, #306)

`npm test` runs one process per file, `cpus - 1` at a time: its wall time is bounded below by its
longest file, and every file pays for what its helpers do at load. A whole simulated run of a
bundled workflow takes 4 to 8 s (more under the suite's load); two thirds of the files finish in
under 1.5 s.

- **When a change needs a whole-run test**: a new transition between steps, a new step type, a new
  gate (or a new answer of one), a new loop or round cap, a new way a run ends. Assert every
  transition the change adds in one run where possible, and add to an existing run's assertions
  when it already walks that path (the inventory below says which run walks which transitions).
- **When a cheaper test is enough** (in a non-slow file): an output schema (`validateSchema`), a
  rendered prompt (`render`, a `WorkflowRun` built and never started), a transition condition
  (`evalExpr` on the `when:`), a loaded definition (`loadWorkflow`: steps, choices, skills), a
  single function. A tiny workflow written for the test (`tempWorkflow`, `packages/engine/test/fixtures/*.yaml`)
  exercising one engine mechanism stays in its area's file when it runs in about a second.
- **Where whole runs live**: `packages/engine/test/slow/`, one workflow and theme per file, each under about 60 s
  on the suite (`engine-software-development-<theme>.slow.test.js`; a mixed file keeps its
  definition/prompt tests in `test/` and its runs in `packages/engine/test/slow/<same name>.slow.test.js`). A
  non-slow file never starts a run with the engine helpers (`runSoftwareDevelopment`, `runWith`,
  ..., guarded by `test/test-suite-layout-305-306.test.js`).
- **Helpers never register tests**: a file under `test/` that is not `*.test.js` (`engine-helpers.js`,
  `worktree-helpers.js`, `service/helpers.js`) exports functions and constants only. A `test()` or
  `describe()` it calls at load runs again in every file requiring it (the nine `unit_tests x
  e2e_tests` runs once ran in 15 files); the same test loads every helper with recording stand-ins
  and names the file and line of any registration.
- **The slowest files**: `scripts/test.js` ends the unit report with the five slowest files and
  their wall time (`scripts/test-reporter-slowest.js`, from node's per-file entry): the next
  critical path shows in every `npm test`, and in the human log in agent mode. A file over about
  60 s there is split by theme.

### Inventory of the whole runs (2026-10-12)

Wall time: the 44 engine/run files together, 19 workers (the suite's shape), this machine. A
bundled workflow's runs, per file and theme (`sd` = software-development, `lh` = its local hero,
`aid` = ai-development-local-hero):

| File (`packages/engine/test/slow/`) | Workflow | Runs | Transitions and steps asserted | Wall |
|---|---|---|---|---|
| `engine-software-development-previews` | sd | 5 | preview code/infra failure → developer / gate "retry"; build code/infra failure; 2 fix rounds → gate | 35 s |
| `engine-software-development-merge` | sd | 4 | reject at approve_merge → cancelled; `merged_commit` from deploy; several issues → issue_not_done gate | 32 s |
| `engine-software-development-gaps` | sd, lh | 10 | develop ⇄ requirements_left_out ⇄ code_review: no gap, one round, "stop", "continue", again on a fix round | 37 s |
| `engine-software-development-gaps-tests-measure` | sd, lh | 6 | Tests/Measure tasks never send develop back nor open the gate (#173) | 26 s |
| `engine-software-development-validated` | sd | 5 | validated mode: developer_check stop / changes / fix round / Stop; approve_merge message; developer_screenshots | 43 s |
| `engine-software-development-suite` | sd | 7 | suite → test writer once, pre-existing, blocked → test_failed, 2 retries, run_existing → developer; skills and tests_plan | 40 s |
| `engine-software-development-test-inputs` | sd | 9 | `unit_tests` × `e2e_tests`: test and suite steps visited or not (#203) | 41 s |
| `merge-recovery-runs` | fixture, lh | 9 | `check:`/`precheck:` recovery, max_visits cap, two runs racing; lh resolve_merge re-check (#99) | 24 s |
| `merge-recovery-approve-merge` | sd | 4 | approve_merge PR state; conflict → resolve_conflict → ask again; merge action failing; merge_failed gate (#69) | 41 s |
| `ai-development-local-hero` | aid | 20 | normal path (full list), acceptance send-back, protected tests, screenshots/ui_reviewer fan-out, #247 change request | 38 s |
| `ai-development-e2e` | aid | 10 | e2e scope, scenarios first, healer loop, product bug → develop, test_failed gate (#223) | 20 s |
| `ai-development-warm-up-301-304` | aid | 8 | warm_up once (fix rounds and change requests skip it), mapper failure, affected then whole suite | 16 s |
| `testid-check-246` | aid | 6 | testid_check → develop with the ids, at most 2 returns, review-fix round, no scenarios skips | 14 s |
| `develop-prompt-300` | aid | 2 | develop prompt: self-review checklist; role-addressed skill sections | 4 s |
| `release-summary-290`, `release-workflow-260` | release | 12, 3 | review after the last fix round, before ship; red unit suite → developer → ship gate; Hold | 12 s, 2 s |
| `issue-tracker`, `engine-test-batch` | issue-tracker, test-batch | 6, 4 | validated/auto filing, duplicate, revise loop; production failure → developer once, max_rounds | 4 s, 3 s |
| `image-attachments`, `run-chat` | issue-tracker; writer-reviewer, sd | 2, 2 | attachments copied and routed, resume images; chat replay equals live (loops, gates, tool calls) | 2 s, 14 s |
| `worktree-engine` | fixture | 7 | run worktree per path spelling, cancel/resume WIP, `goto: end` status, processes stopped | 26 s |
| `engine-local-hero`, `engine-writer-arena` | lh, e2e-release; writer-reviewer, ai-arena, backlog-refresh | 4, 13 | merge after verify_change, developer_check; notes loop, rounds → human, arena synthesis, scope gate | 11 s, 6 s |
| `engine`, `engine-child-workflows`, `engine-transitions` | fixtures, inline | 15, 7, 6 | outputs, `/goal`/`/loop`, fan-out, on_error, schema retries; child runs; transition on_error, max_total_context | 3 s, 2 s, 1 s |

Non-slow files that still start runs use a fixture or an inline workflow of a few steps, about a
second each: `agent-fallbacks-262`, `agent-overrides-262`, `agent-overrides-internals-262`,
`context-budget-302`, `engine-fanout-agent-when`, `handoff`, `idle`, `image-attachments` (inline,
loop-goal), `memory-guard-suite-276`, `probes`, `protect-files`, `releases-internals-260`,
`result-summary`, `run-chat` (fanout, handoff), `run-costs*`, `run-progress`, `run-script`,
`session-cache-320`, `subagent-tokens-engine-308`, `supervisor`, `supervisor-on-call`,
`test-budget`, `test-paths`, `testid-check-246` (inline), `workflow-builder`, `workflow-display-245`,
`workflows`.

**Folded**: the #301 normal-path run (same inputs and mock answers as the ai-development normal
path, whose full transition list includes its four) is now that run's assertion; its title is a
comment there. The other overlaps walk the same steps with different inputs or answers (each sd
theme reaches approve_merge on the default path; the matrix's `write_and_run x off` is close to
the default inputs but asserts only the visits), so they stay separate runs.

**Measure** (#305, #306): baseline 2026-10-06 at `d7bcfa2`: 3,770 tests, 268 s wall, 1,345 CPU-s
(sum of the files' wall times), the longest file 231 s. Whole runs per suite: the nine
`unit_tests x e2e_tests` runs registered in 15 files (135 runs, now 9) and one folded run: 127
fewer runs, 127 fewer tests. Before/after `npm test` on the same machine and the suite step's time
in the next 5 real runs (baseline 5.5 min per visit) are the owner's to record here.

### Production files no test reaches (#306)

`docs/agents/test-map.md` lists 122 (2026-10-12). Most are not gaps:

- **Map blind spot** (covered, the map cannot see it): `packages/engine/service/index.js` loads every area
  and channel with `readdirSync` + a computed `require`, which the import graph of
  `packages/engine/engine/affected-tests.js` does not follow. Areas app-update, artifacts, backlog, chain,
  discovery-automations, gates, insights, keep-awake, live-roadmap, local-preview, local-push,
  pipelines, resume, roadmap, run-lists, run-meta, runs, sessions, usage, workflows, workspace and
  channels app, backlog, nightwatch, product-owner, roadmap, runs, skills have their
  `packages/engine/test/service/<area>*.test.js`. Follow-up: teach the map (and `scope: affected`) that loader.
- **Not worth a unit test**: the 28 E2E step files, `features/support/*`, `playwright.config.js`
  (they are the tests); `poc/embed-run.js`; scripts run by hand or that are checks themselves
  (`count-refusals`, `simulated-strays`, `serve`, `smoke`, `smoke-package`, `affected-tests` CLI);
  the channel tables that only forward to an area (agents, analytics, app-update, artifacts, chain,
  chat, diff, local-preview, notify, pasted-images, phonegates, pipelines, projects, releases,
  sessions, usage, workflows); `apps/desktop/host/main.js` (Electron main, E2E app.feature), `packages/engine/domains/account/auth-config.js`
  and `packages/ui-kit/chat-models.js` (constants), `areas/chat-turns.js` (12-line wrapper); renderer
  glue over a tested model or covered by a feature (account, chain-picker, code-banner,
  diff-viewer, image-viewer, keep-awake, kept-work-dialog, run3d/*, setup, usage-widget,
  discovery, discovery-commit, inbox, project, projects, releases, settings-phone, skills).
- **Follow-ups** (a test is worth it; one issue each): areas `budget` (budgetNow against the caps,
  live runs and Night watch), `index-db` (open/close with the workspace, recovery),
  `notifications` (which events notify, the history), `phone-gates` (pairing, answering a gate);
  channels `discovery` (card move, clarity, commit), `oracle` (conversation, memory, tools: the
  largest), `storage` (notification history, unread, mark-read), `supervisor` (on-demand analysis,
  watch start/stop/ask), `voice` (status, error path); `packages/engine/domains/supervisor/supervisor-watch.js` (batching window,
  `FLAG:` → notification, stop at run end); `packages/ui-kit/run-meta.js` (issuesOfRun, issueRefs,
  display title); `packages/ui-kit/toast.js` (countdown and action timing); `views/arena/arena.js`
  (no feature of its own: an E2E scenario or a model to extract); `scripts/lint-lists.js`.
