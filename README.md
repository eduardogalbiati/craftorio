# Multiagent Orchestrator

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).

## Running

```bash
npm install
npm start
```

Keep **Simulation mode** checked to try a flow without calling the CLIs.

### Screens

| Menu | What it has |
|---|---|
| Sessions | Every Claude Code, Codex and Grok conversation recorded on this machine (read from `~/.claude/projects`, `~/.codex/sessions`, `~/.grok/sessions`), newest first, with its project, model and folder; filter by provider or search. Clicking one reopens it in its CLI (`claude --resume`, `codex resume`, `grok --resume`) in an embedded terminal, in the session's folder. **New session** starts a CLI with a provider, model, effort and project (or folder). Terminals keep running while you use other screens; sessions created by workflow agents are hidden unless you ask for them |
| Dashboard | "What are we building today?": Plan & Design, Code & Build and Monitor & Improve open the start panel filtered by the workflow's `metadata.category` (`plan`, `build`, `monitor`) |
| Projects | Projects in `<workspace>/projects/<id>.json`. Every project has a folder and optionally a git repository. With a repository and no folder, it is cloned into `<workspace>/repos/<owner>-<repo>`; without either, the folder is `<workspace>/projects/<id>/`. Clicking a project shows every workflow run in it (status, cost, task), and for each run its sessions, with **Live terminal** / **Open in CLI** to watch or resume any of them. Runs are linked by the project id they were started with (older ones by the project's current or previous folders) |
| Backlog | A project's issues, synced from its git platform: **GitHub** (gh CLI) or **GitLab** (glab CLI); Bitbucket is listed but has no sync yet. The default platform is in Settings › General › Backlog and can be switched on the screen. The last sync is kept in `<workspace>/backlog/<project id>.json` (shown instantly, a new sync runs each time the screen opens). **List** view (open/closed filters, labels, task-list progress, the issue rendered as Markdown) or **Kanban**: **To do**, **In progress** (queued, running, failed), **Waiting for approval** (its run is at a human gate; **Review approval** opens it) and **Done** (closed, or its run succeeded). Select To do issues and **Assign workflow…** (workflows with a `task` input; their other inputs are asked once and remembered per project; simulation in developer mode): they wait in the project's queue (`<workspace>/backlog/<id>.queue.json`) and run **one at a time**, in the order selected. Each run records its issue; `software-development` gets it as the `issue` input and its PR/MR closes it. The queue can be paused; it is paused when the app starts, when a start fails (budget, missing CLI) and when a queued issue's run fails. Runs started by hand are linked when their task or a text input mentions the issue URL or `#<number>` |
| Artifacts | Every file a run produced (documents, proposals, reviews, reports), grouped by run and filterable by project. The viewer renders Markdown (tables, table of contents; sanitized with DOMPurify), pretty-prints JSON and shows TSV/CSV as tables. Also listed per run in the project view |
| Workflows | The YAMLs in `<workspace>/workflows/` with their steps, agents/models, skills, `/goal`, `/loop`, parallel steps and branches. Each one is marked **default** (untouched copy of a workflow bundled with the app), **modified** (a default you edited; **Restore default** moves your copy to the trash and restores the bundled one, and **newer default** means the app ships a newer version than the one you edited) or **custom** (created by you) |
| Agents | Reusable agents in `<workspace>/agents/<id>.json`: a robot look (main color, shell, visor, glow, eyes, emblem; live preview of the animated states), a prompt with what the agent is for and the skills it always gets. The built-in **Supervisor** is always listed: its prompt and skills are fixed, only its look can be changed (it shows wherever the supervisor appears, e.g. Write & Review). Workflows don't pick these agents yet |
| Skills | One folder per skill in `<workspace>/skills/<id>/SKILL.md` (Claude Code format) |
| Usage | Tokens and cost per provider this month and today, monthly budgets (USD and/or tokens), per-model prices for CLIs that do not report cost, recent runs. The topbar widget shows this month's total; click it for a per-provider popover |
| Settings | Workspace, CLI status (Claude Code, Codex, Grok Build, GitHub CLI, GitLab CLI, Git) and run preferences (`<workspace>/settings.json`) |

The **Start** button at the top (next to Stop) opens the right side panel: pick the workflow,
the project (its folder becomes `repo_path`/`project_path`) and the input. During and after a
run, **Run** shows up at the bottom of the menu with the sessions and events.

Requires Node 24 LTS (`.nvmrc`; `engines` in package.json). The app runs on Electron 44, which
bundles Node 24 too. npm 11 only runs install scripts that are approved in `allowScripts`
(package.json): `node-pty` is approved; after upgrading it, run `npm approve-scripts node-pty`.

From the terminal (no UI):

```bash
npm test
```

Runs the unit tests (`test/`, node:test) and the full flow in mock mode. This is what CI runs.

`npm test` must pass on **Windows, Linux and macOS**, locally and in CI (`ci.yml` runs it on all
three). Tests must not depend on the machine:
- git: the worktree tests run with an empty global config and no system config
  (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) and pass identity, `init.defaultBranch` and
  `core.autocrlf` with `-c`; match git messages that changed across versions loosely;
- paths: build them with `path.join` under `os.tmpdir()` (no hard-coded `C:/`, `/tmp` or
  separators) and compare them with `samePath`/`canonicalPath` (`src/engine/worktree.js`). The
  worktree tests deliberately pass non-canonical spellings: a symlink (a junction on Windows) and,
  on Windows, an 8.3 short name, since git prints canonical paths (macOS `/var` is
  `/private/var`; the GitHub Windows runner's temp folder is `C:\Users\RUNNER~1\...`);
- line endings: files may be checked out with CRLF (Windows `core.autocrlf`); do not compare raw
  file contents with `\n`-only literals.

```bash
npm run run -- --task "Task description" --repo C:/path/to/repo --input language=python --input git_platform=gl
```

Runs the workflow for real. `--file ai-arena.yaml` picks another workflow: a name or relative path is
looked up in `<workspace>/workflows/` first, then in the repository's `workflows/`; an absolute path is
used as is (e.g. to try an edited repository copy while the workspace copy is modified). `--auto-approve`
approves every human gate without interaction (tests only: in practice the AI must not cross the gates).

### Engine server (HTTP + WebSocket)

```bash
npm run serve -- --port 7300 --host 127.0.0.1 --workspace C:/path/to/workspace
```

Runs the engine without Electron and serves the same UI to a browser: open the printed
`http://…/?token=…` URL. The token (from `MULTIAGENT_SERVER_TOKEN`, else random) is kept in an
HttpOnly cookie after the first visit; API clients send `Authorization: Bearer <token>`.

- API: `POST /api/<channel>` with `{ "arg": … }` → `{ "result": … }` or `{ "error": … }`. The channels are the
  desktop app's IPC channels (`projects:list`, `run:start`, `artifacts:read`, `auth:state`, …).
- `GET /ws` (WebSocket): the server pushes `{ "channel", "payload" }` for `run:event`, `term:data`,
  `term:exit` and `auth:changed`; the client sends `term:input` / `term:resize` the same way.
- Requests from another origin are refused. Beyond `127.0.0.1` the traffic is plain HTTP: put the
  server behind a reverse proxy with TLS.
- Runs need the same account as the app (sign in from the browser UI; the sign-in page opens on the
  server machine). `MULTIAGENT_AUTH=off` disables it in development.
- Desktop-only actions (native folder picker, opening files in their app, external console
  windows, changing the workspace) are not available in the browser; folder paths are typed.

Local build: `npm run build` (writes `build/`) or `npm run package` (writes `dist/`, used by the deploy).

## Software development flow (`workflows/software-development.yaml`)

| Stage | Agent | Model | What it does | Skills |
|---|---|---|---|---|
| Build & Test | Developer | Opus 5.5 | Implements and fixes everything the other agents report; always branches from a freshly fetched `origin/<base_branch>` | `unit-test-writer-<language>`, `bug-diagnosis`, `merge-conflict-resolver`, `decision-log` |
| | Code Review | Codex gpt-6-luna | Reviews the diff on correctness, spec and standards; requests changes only for blocker/major | `code-review` |
| | Test Writer | Sonnet 5 | Writes/updates tests and runs the suite; failures go back to the developer | `unit-test-writer-<language>` |
| | Builder | Sonnet 5 | Build + dependency audit; a broken build or a high/critical production vulnerability goes back to the developer | `build-audit-<language>` |
| | Verifier | Sonnet 5 | Proves the change does what the task asked: same command on the base and on the branch; `not_verified` goes back to the developer, `inconclusive` does not block | `claim-verification` |
| CI/CD | CI Pusher | Opus 4.8 | Push, opens the PR/MR, **/goal** CI green with **/loop**; on failure fetches the log and calls the developer. A PR/MR that conflicts with the base (CI never starts) is reported as failed on the first visit | `ci-pipeline-<platform>` |
| | PR Babysitter | Opus 4.8 | **/goal** PR/MR mergeable with **/loop**; actionable comments → developer (replies with the hash), doubtful ones → human | `pr-babysitter-<platform>`, `decision-log` |
| | Deployer | Opus 4.8 | Publishes the preview, and after the merge tracks the production deploy. A failure carries `failure_class` (`code`, `infra`, `unknown`): a preview `code` failure goes to the developer, then CI, the PR check and the preview run again (2 rounds at most) | `deploy-<platform>` |

Two inputs choose the skills:
- `language`: `js`, `python`, `go`, `java` or `csharp`.
- `git_platform`: `gh` (GitHub, `gh` CLI) or `gl` (GitLab, `glab` CLI). This also picks the merge
  command at the approval gate.

Human gates: a doubtful PR/MR comment (fix / justify / ignore) and the merge, which produces
the production release. Agents never talk to each other: the orchestrator (engine) hands
failures to the developer and returns the result to the agent that asked.

Failure gates (a step that ran out of fix rounds, or a failure no commit can fix) only offer what
can change the outcome:

| Gate | Options |
|---|---|
| `test_failed`, `verify_failed` | continue anyway / stop (`failed`) |
| `build_failed` (also reached at once by an `infra` build failure, e.g. a file locked by a running process) | continue to verification anyway / build again (after fixing the environment) / stop (`failed`) |
| `ci_failed` | one more fix round by the developer / check CI again (stuck or flaky pipeline) / stop (`failed`) |
| `preview_failed` | publish the same commit again (infrastructure) / send it to the developer (then CI, PR check, preview) / stop (`failed`) |
| `deploy_failed` (after the merge) | new development cycle / track the deploy again (after re-running it yourself) / stop (`failed`) |
| `human_review`, `approve_merge` | rejecting ends the run as `cancelled` |

Once a fix loop reaches its limit the engine goes to the gate without asking for yet another fix,
and a gate never re-runs the same failed thing as the only way forward.

`/goal` and `/loop` are declared per step in the YAML (`goal.until`, `loop.interval`,
`loop.max_duration`). The engine repeats the step until the goal is met and injects the /goal
and /loop instructions (current iteration, interval and limit) into the agent's prompt.
A loop whose agent is blocked also stops early, at `goal.on_exhausted`: after `loop.max_blocked`
iterations in a row (default 3, `0` turns it off) in which it checked nothing (every tool call
refused by its allowlist, or none made) or had calls refused and gave the same answer again.
The reason goes to the run log and `decisions.tsv`. Many refused calls in one turn also log a
warning that the supervisor sees.

## AI Arena (`workflows/ai-arena.yaml`)

Up to five models write the same document (default: a PRD) and an orchestrator merges them. The
**AI Arena** screen (sidebar, "lab") starts it: pick 2 to 5 contenders (CLI, model and effort of each),
an optional **project** (read-only for the models; a copy of the final document is saved in it),
reference documents to attach (text files every model reads), the document type (PRD, design doc,
RFC, ADR, test plan, design sketch), blind peer review and lenses. It shows the run as a chat: each contender posts its
proposal and its scores for the others (with the real author of each anonymized proposal, which only
you see), the synthesizer posts the final document, the verifier its verdict, and the supervisor asks
you to accept, redo (with optional instructions for the synthesizer) or discard. A **Peer scores**
panel ranks the contenders; past runs open as a chat from Workflows › Runs › **Open chat**.

| Stage | Who | What it does |
|---|---|---|
| compete | up to 5 contenders **in parallel** (default: Opus 5.5, Sonnet 5.5, gpt-6-luna, Grok 4.7) | Each writes the document without seeing the others, plus a short rationale (alternatives rejected, assumptions), and is told not to drift to a safe middle ground (`arena/proposals/<agent>.md`). With `lenses: on`, each works under a different forced lens (user value, lean MVP, risk first, feasibility first, evidence first) |
| critique | the same, in parallel (`peer_review: yes`) | Each scores the **others'** anonymized proposals and says what it would change in its own |
| synthesize | synthesizer (Opus 5.5, own session) | `arena-synthesis` skill: picks the best proposal as the **base** and grafts the best ideas of the others; convergence/divergence check; opinionated conflict decisions; appendix with scoreboard, base, grafts, rejected ideas, dismissed critiques and dropouts |
| verify | verifier (gpt-6-luna, another family, fresh session) | Checks the final document against the document skill and the proposals (missing sections, contradictions, unsupported claims, dropped consensus); on issues, one more synthesis round |
| review | human | Sees the verifier's verdict and who wrote each proposal; accepts, asks for a new synthesis (2 at most, with optional instructions; a 3rd request ends the run as failed) or discards it (cancelled) |

Proposals are anonymized as "Proposal N" in an order shuffled per run (the `shuffle(run_id)`
template filter), the same in every step, so position and labels do not give the model away.
Base-and-graft, the verify step and the rationale/anti-hedging instructions adapt ideas from the
arena skill in [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT).

The final document goes to `<run>/arena/final.md` and, with a project, to `<project>/<save_to>/` (default `docs/arena`).
Its format comes from the skill in the `document_skill` input (default `prd-writing`): for an ADR,
tech spec and so on, create a skill with the structure and the rubric and pass its name. The
contenders are five slots (`contender_1` … `contender_5`) set by the inputs `contender_N_provider`,
`_model` and `_effort`; provider `none` leaves a slot out (the agent's `enabled`).

## Multi-model code review (`workflows/multi-model-review.yaml`)

Reviews an existing branch without changing anything or posting to the PR/MR.

| Stage | Who | What it does |
|---|---|---|
| review | Opus 5.5, Sonnet 5, gpt-6-luna **in parallel** | Each reviews the diff with `code-review` (`review/<agent>.json`) |
| blast_radius | Sonnet 5 | `blast-radius`: consumers outside the diff and the key safety fact, proven by running code |
| judge | Opus 5.5 (own session) | `review-synthesis`: reads the diff, merges and verifies the anonymized findings into act on / consider / noted / dismissed, with a verdict (`review.md`) |

## Writer & Reviewer (`workflows/writer-reviewer.yaml`)

Plan & Design. Give it a **prompt** (what to write) and a **goal** (when it is good enough), and
pick the CLI, model and effort of the writer and of the reviewer. Optionally pick a **project**: the
writer and the reviewer then work in its folder and read its files (read-only) to ground the document;
the run shows up under that project. The **Write & Review** screen
(sidebar, "lab") starts it and shows the run as a chat between the agents, with a robot per model.

| Stage | Who | What it does |
|---|---|---|
| write | writer (your pick) | Drafts the document, then revises it with the notes (`drafts/vN.md`, `document.md`) |
| review | reviewer (your pick) | Scores the draft 0-10 against the goal and lists major/minor notes. The engine approves at the threshold (default 8), otherwise back to write, up to `max_rounds` reviews |
| signoff | supervisor (Opus 5.5, internal) | Checks the approved draft against each part of the goal and reports to you with a recommendation |
| decide | you, asked by the supervisor | Accept, send it back to the writer, or stop; plus optional instructions (e.g. "keep the pricing open") |
| out_of_rounds | you | When the rounds run out: accept the last draft, one more round, or stop; plus optional instructions |

Whatever you write at these questions goes into every later prompt of the writer, the reviewer
and the supervisor, and takes precedence over the goal where they conflict.

Past runs open as a chat again from Workflows › Runs › **Open chat**.

**Simulation** (Settings › Execution › **Developer mode**): shows the "Simulation" checkboxes, checked
by default, and a **Scenario** picker on Write & Review: approved on the 3rd review (5.5 → 7 → 8.6),
approved on the 1st review, never reaches the score (rounds run out), the supervisor finds gaps in the
approved draft, and the reviewer answers in the wrong format (asked again twice, then the supervisor
steps in). Without developer mode every run is real.

## Run retrospective (`workflows/run-retrospective.yaml`)

Monitor & Improve. Given a `run_id` (default `latest`: the most recent run of another workflow;
an id with no run folder is refused before the run starts), reads that run's `events.jsonl`, sessions,
`decisions.tsv` and `summary.json` with the `run-retrospective` skill, and proposes
evidence-backed edits to skills and workflows (`retrospective.md`, also copied into the analyzed
run's folder). It only proposes; a human applies.

## Skills

Skills are reusable instructions (`SKILL.md` + support files) that the engine injects into the
agents, for Claude **and** Codex. The YAML keeps the contract (who, when, schema, transitions);
the skill keeps the know-how.

```yaml
agents:
  test_writer:
    skills: ["unit-test-writer-{{ inputs.language }}"]   # system prompt (1st turn); templates allowed
steps:
  - id: compete
    skills: ["{{ inputs.document_skill }}"]              # the step's prompt
```

```yaml
# SKILL.md frontmatter
name: unit-test-writer-go
description: ...
uses: [testing-principles]   # loaded first, once, cycles ignored
```

- The `SKILL.md` body goes inline; support files (e.g. `rules/python.md`) are listed with their
  absolute path so the agent reads only the relevant ones.
- Lookup: `<workspace>/skills/<name>` first, then the app's `skills/`. The app's skills are copied
  into the workspace on startup. When the app ships a new version of a skill, untouched copies are
  updated; copies you edited are kept, and skills you deleted are not brought back.
- `providers.<p>.skill_args` lets the agent read the skill folder, which is outside `working_dir`
  (Claude: `["--add-dir", "{{ skill_dir }}"]`; Codex in `read-only` can already read any path).

### Naming convention

Language- or platform-specific skills are named `<capability>-<suffix>`, and every family has
one skill per suffix (a test enforces it):
- language suffixes: `js`, `python`, `go`, `java`, `csharp`;
- platform suffixes: `gh` (GitHub), `gl` (GitLab).

What is shared by a family lives in a suffix-less skill referenced with `uses:`.

### Bundled skills

| Skill | Used by | Content |
|---|---|---|
| `code-review` | reviewer | Correctness, spec and standards axes, severities, `rules/` per language (JS/TS, Python, Go, Java/Kotlin, C#, SQL, Shell/CI) and `rules/smells.md` |
| `unit-test-writer-{js,python,go,java,csharp}` | developer, test writer | Framework detection, commands, idioms per language |
| `testing-principles` | via `uses` | Seams first, no tautological or implementation-coupled tests, mocks only at boundaries, red before green for bug fixes |
| `build-audit-{js,python,go,java,csharp}` | builder | Build and audit commands, production vs development scope per ecosystem |
| `dependency-audit-policy` | via `uses` | Severity from CVSS, how to report blockers with a fix, redaction |
| `ci-pipeline-{gh,gl}` | CI pusher | Push, PR/MR, mergeability (conflicts fail fast), CI status, missing checks, fetching failed logs, retrying flaky jobs |
| `ci-failure-triage` | via `uses` | Classify a failure (code, environment, infrastructure, needs-human) and write a root-cause report |
| `pr-description` | via `uses` | PR/MR title and body: visual summary, evidence, merge danger |
| `pr-babysitter-{gh,gl}` | PR babysitter | Mergeability signals, threads/discussions, replies |
| `pr-comment-triage` | via `uses` | Actionable vs doubtful comments, durable fix requests, resume logic, AI marker on replies |
| `deploy-{gh,gl}` | deployer | Preview and production deploy tracking and cleanup |
| `bug-diagnosis` | developer | Red feedback loop first, ranked hypotheses, regression test, cleanup |
| `merge-conflict-resolver` | developer | Intent tracing per side, hunk-by-hunk resolution, verification |
| `prd-writing` | arena | PRD structure (user stories, traceable requirements, testing decisions, questions with defaults) and scoring rubric |
| `design-doc-writing` | arena (`document_skill`) | Design doc (after Google's practice): context, goals/non-goals, design with trade-offs, alternatives, failure modes, cross-cutting concerns, rollout, rubric |
| `rfc-writing` | arena (`document_skill`) | RFC (after the Rust RFC template): motivation, guide- and reference-level explanation, drawbacks, alternatives, prior art, rollout, rubric |
| `adr-writing` | arena (`document_skill`) | ADR (after MADR 4.0): one decision, drivers, real options with pros/cons, consequences, confirmation, rubric |
| `test-plan-writing` | arena (`document_skill`) | Test plan (after ISO/IEC/IEEE 29119-3): risk-based approach, traceability to requirements, entry/exit criteria, environment and data, rubric |
| `design-sketch` | arena (`document_skill: design-sketch`) | Usage-first design: usage snippets, types and signatures, trade-offs, alternatives, design red-flag screen, rubric |
| `claim-verification` | verifier | Falsifiable claim, baseline vs treatment with the same command, verified / not_verified / inconclusive |
| `blast-radius` | multi-model review | Boundary changes, their consumers, and the safety fact proven on an evidence ladder |
| `review-synthesis` | multi-model review judge | Lead judgment: merge, verify, weigh agreement and nitpicks, act on / consider / noted / dismissed |
| `decision-log` | developer, PR babysitter | Agents end answers with a ```` ```decisions ```` block; the engine appends it to `<run>/decisions.tsv` |
| `run-retrospective` | run retrospective | Friction, waste, skill gaps and no-ops in a run's logs, turned into proposals with evidence |
| `arena-synthesis` | arena synthesizer | Merge method and the arena appendix |

`bug-diagnosis`, `merge-conflict-resolver`, `pr-description`, `testing-principles` and parts of
`code-review` adapt ideas from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT);
`claim-verification`, `blast-radius`, `review-synthesis`, `design-sketch`, `decision-log` and
`run-retrospective` adapt ideas from [cursor/plugins](https://github.com/cursor/plugins) (MIT).
All of them are rewritten for agents that run unattended: where the originals ask the user, ours
record an assumption or a recommended default instead.

### AI supervisor

The engine is deterministic (same graph, same gates, auditable); an AI **supervisor** (skill
`run-supervisor`, model from `orchestrator:` in the YAML) steps in only when something goes wrong:

```yaml
orchestrator:
  provider: claude
  model: claude-sonnet-5
  supervisor:
    enabled: true
    max_interventions: 2   # per step (max_total: 6 per run)
```

- **During a run**, when a step fails (agent error, output that never validates), the engine gives
  the supervisor the step, the error, the agent's last answer and the recent timeline. It answers
  with an explanation and one action, which the engine validates:
  - `fix_output`: rebuild the output from the agent's answer, accepted only if it matches the step's schema;
  - `retry`: run the step again with an instruction added to the agent's prompt;
  - `goto`: continue at one of the step's own targets (never a human gate);
  - `ask_human`: an approval with the explanation (retry with the suggestion / stop);
  - `fail`: fall back to `on_error`, or end the run.
  It shows up as a `supervisor` session, and its decisions in the orchestrator log
  (`supervisor.decision` events).
- **On demand**, "Ask the supervisor" on any run (Run view, orchestrator, project view): it reads
  the run (timeline, every attempt of the failing step, artifacts), explains what happened and the
  root cause, and recommends actions: **resume** from a step (a new run that reuses the previous
  steps' outputs and the agents' conversations, with an instruction for that step), **rerun**, or
  something only a person can change. The analysis is saved as `supervisor/analysis-*.md` in the
  run folder (an artifact). **Chat in terminal** opens the supervisor's CLI in the run folder,
  read-only, to ask follow-up questions.

### Parallel steps

Steps with `agents: [a, b, c]` run in parallel (fan-out; `min_success` sets how many must answer)
and return `{ results: { agent: output }, succeeded, failed }`. `save_as` writes the answer to a
file (relative to the run folder); an entry `{ path, content: "{{ output.document }}" }` writes one
field of a JSON answer instead.

An agent's `provider`, `model` and `effort` can be templates over the inputs
(`model: "{{ inputs.writer_model }}"`), so the user picks them per run; `cli_args` can then be a map
keyed by provider. A provider's `effort_args` (e.g. `["--effort", "{{ effort }}"]`) are added when the
agent sets an `effort`. `max_visits` and `loop.max_iterations` accept templates too. An agent's
`enabled` (a boolean or a template, e.g. `"{{ inputs.contender_5_provider != 'none' }}"`) leaves it
out of the run: fan-out steps run without it and `min_success` is capped at the agents left.

A `human_approval` step with `feedback: true` (or `{ label, placeholder }`) also asks for an optional
free text: it is the gate's `output.feedback`, and every non-empty one is added to `feedback`
(`[{ step, choice, text }]`, the whole run) for the next prompts. `previous_step` is the id of the step
that ran before the current one.

`on_error: <step>` keeps a failing step (agent error, output that never validates) from ending the
run: its output becomes `{ error }` and the flow continues at that step (the arena's `verify` uses it,
so a verifier failure still reaches the human review with the document). When an answer does not
validate, the engine asks again with the schema; ephemeral agents also get the task and their
previous answer back, since their retry runs in a fresh session.

### Transitions: limits and how a run ends

```yaml
transitions:
  - when: "output.tests_status == 'fail'"
    delegate: { agent: developer, prompt: "Fix: {{ output.failure_report }}" }
    goto: test
    max_visits: 3              # this transition, at most 3 times per run...
    on_exhausted: test_failed  # ...then here, WITHOUT the delegation (nothing would check that fix)
  - when: "rejected"
    goto: end
    status: failed             # the run's outcome: success (default), failed or cancelled
```

- `goto: end` ends the run as `success`. Add `status: failed` or `status: cancelled` when the run
  ends without delivering: a rejected failure gate is `failed`, a rejected merge or review is
  `cancelled`. `status` also applies when `on_exhausted: end` ends the run (e.g. the arena's redo
  limit), and is rejected on a transition that cannot end the run.
- The outcome is the `status` of the `workflow.finished` event and of `summary.json` (with an
  error such as `Run ended as failed at step "preview_failed" (choice == 'stop')`), and the
  `step.transition` event to `end` carries it. Like any failed or cancelled run, the worktree is
  kept so the run can be resumed, and the UI shows it as failed/cancelled.
- `goto: fail` still ends the run as `failed` with "retry limit reached"; it is the default of
  `on_exhausted`.

### A git worktree per run

A workflow whose agents change a repository can give every run its own checkout, so runs never
share (or leak) branches, dirty files or a stale local base, and two runs of the same repository
can go at the same time:

```yaml
orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"   # the repository (a subfolder works too)
    base: "{{ inputs.base_branch }}" # fetched from origin at run start
defaults:
  working_dir: "{{ worktree_dir }}"  # agents work in the run's worktree
```

- **Start**: `git fetch origin <base>` (no network or no remote only warns and falls back to the
  local base), then `git worktree add --detach <workspace>/worktrees/<run_id> origin/<base>`.
  `worktree_dir` (templates) points to it, and actions (e.g. the merge command) run there.
  `git worktree prune` runs on the repository first. The worktree is outside the run folder, so it
  never shows up as an artifact.
- **Success**: the worktree is removed (`git worktree remove --force` + `prune`) and the run's
  local branch is deleted if it is merged into `origin/<base>` (squash merges included); otherwise
  the branch is kept.
- **Failed, cancelled or interrupted**: the worktree is kept. **Resume** from a step continues in
  the same folder (so resumed CLI sessions keep their working directory); if it was deleted, it is
  recreated from the run's branch.
- The path, branch and outcome are in `summary.json` (`worktree`) and in the `worktree.ready`,
  `worktree.kept` and `worktree.removed` events. Sessions record their `cwd`; a session terminal of
  a removed worktree opens in the repository folder instead.
- **Processes left running**: after each agent step (delegations included) and when the run ends,
  the engine stops the processes started from the worktree that are still running (an Electron UI
  check, a dev server), with their process trees: their executable is inside the worktree (Windows,
  Linux, macOS) or, on Linux/macOS, their working directory is (processes with a terminal, such as
  your own shell there, are spared). Nothing outside the worktree is touched, nor the app itself
  and its terminals. What was stopped is logged (`worktree.processes_stopped` event and a warning).
  Otherwise such a process locks files and every later `npm ci` fails with EBUSY.
- **Not a git repository**, or a simulation (mock) run: no worktree, `worktree_dir` is the
  repository folder itself (the old behaviour).
- **Orphans**: at startup the app removes worktrees whose run succeeded (a removal that failed) and
  worktrees unused for 14 days; failed runs' worktrees stay until then so they can be resumed.
- A fresh worktree has no installed dependencies: the developer and the test/build skills install
  them when missing (`npm ci`, `uv sync`, `dotnet restore`…).
- Merge action: `gh pr merge` runs with `--repo <owner/repo>`, so gh merges and deletes the remote
  branch server side only. Without it, `--delete-branch` also checks out the base and deletes the
  local branch, which fails in a worktree (the base is checked out in the main checkout, and a
  branch checked out in a worktree cannot be deleted). The engine deletes the local branch itself.

Enabled in `software-development`. The other bundled workflows only read a folder
(`multi-model-review` reviews whatever branch the given checkout has) and do not use it.

## CI/CD

- `.github/workflows/ci.yml`: on every PR runs a syntax check and `npm test` on Ubuntu, Windows
  and macOS (checks `test (<os>)`), plus a production `npm audit`. The `test` check is green only
  when all three are: use that name in branch protection.
- `.github/workflows/preview.yml`: test environment. Triggered by the Deployer, publishes the
  pre-release `preview-pr-<n>` from the PR branch.
- `.github/workflows/deploy.yml`: production. Every push to `main` tests, packages and publishes a release.

The CI/CD agents use the GitHub CLI (`gh`) or the GitLab CLI (`glab`), which must be
authenticated (`gh auth login` / `glab auth login`).

## Providers, availability and budgets

Workflows use three CLIs: **Claude Code**, **Codex CLI** and **Grok Build**. Install and log in to
all three (free plans are enough to start). Before a real run, the app checks that every CLI the
workflow's agents use is installed; if one is missing, the run does not start and the error says
what to install. Simulation mode needs none of them.

**Budgets** (Usage screen, stored in `settings.json`): a monthly limit per provider in USD and/or
tokens. Usage comes from every non-mock run's `summary.json` plus the run in progress. The engine
checks the budget before each agent turn: it logs a warning at 80% and, when "block runs" is on,
stops the turn at 100% (a run that would start over budget is refused).

- Claude Code and Grok report the cost of each turn. On subscription plans that cost is the
  API-equivalent value: treat it as a usage indicator.
- Codex does not report cost: set a price per model (USD per 1M tokens) in Usage to estimate it,
  or use a token budget.
- Tokens = input + output + cache read + cache write (reasoning is already inside output).

**Scope toggle** (Usage screen and the topbar popover):
- **Orchestrator**: only this app's runs (their summary.json files).
- **This machine**: everything the CLIs recorded locally, including use outside the orchestrator
  (interactive Claude Code sessions, other tools running the CLIs). Read from
  `~/.claude/projects/**/*.jsonl` (Claude Code; chunks of the same message counted once),
  `~/.codex/sessions/**/rollout-*.jsonl` (Codex) and `~/.grok/sessions/**/usage.json` (Grok), by
  `src/local-usage.js`. The orchestrator's part is matched by provider session id.
- Codex is metered by the ChatGPT plan's rate-limit windows and credits: its logs carry the plan
  type, the % used of each window and the credit balance, shown on the Codex card.
- Claude Code's local logs have no cost, so outside usage is priced only if you set model prices.
- Account-wide usage (claude.ai web/mobile, other machines) is not available: subscription plans
  have no public usage API.
- A budget can **count usage outside the orchestrator** (per provider option): the pre-run check
  and the per-turn checks then use this machine's totals.

## How sessions are opened (no tmux)

Each turn of each agent is a headless child process of Electron:

| Provider | Command | Stream |
|---|---|---|
| Claude Code | `claude -p --output-format stream-json --verbose --model <m>` | thinking, text, tool_use, `result` with usage/cost |
| Codex CLI | `codex exec --json --skip-git-repo-check -m <m> -` | reasoning, agent_message, command_execution, `turn.completed` with usage |
| Grok Build | `grok --output-format streaming-json -m <m> --prompt-file <tmp>` | thought/text deltas, tool_call(_update), `end` with session id, usage and cost |

- The prompt is sent via **stdin** (avoids escaping problems with `cmd.exe`), or through a temporary
  file for CLIs that need one (`prompt_file_arg`, used by Grok).
- `persistent` sessions are resumed with the `session_id` returned by the provider
  (`--resume <id>` / `codex exec ... resume <id>` / `grok --resume <id>`).
- The command lines live under `providers:` in the YAML and can be changed without touching code.

**Terminals** (Run view session detail and Project view, for any run, including past ones):
- They open in an **embedded terminal dock** at the bottom of the app, with tabs (xterm.js). The
  **↗** button next to each opens the same thing in an external console window instead (Windows).
- **Live terminal** follows a session as it runs: prompts, thinking, text, tool calls, results and
  usage. For the **orchestrator** it follows the whole run: steps, transitions, sessions,
  approvals, actions and logs. It is read by the app itself (`src/session-tail.js`), no child process.
- **Open in CLI** runs the provider's interactive CLI resuming the same conversation in the
  session's folder (`claude --resume <id>`, `codex resume <id>`, `grok --resume <id>`) in a real
  pseudoterminal (node-pty: ConPTY on Windows, forkpty on macOS/Linux; `src/terminals.js`). Only
  between turns; whatever you send there becomes part of the agent's conversation for its next turn.
- Keys: **Ctrl+C** copies when text is selected, otherwise interrupts; **Ctrl+V** / Shift+Insert
  paste; Ctrl+Shift+C always copies; right-click copies the selection or pastes. On macOS, Cmd
  instead of Ctrl.
- node-pty ships prebuilt binaries for Windows and macOS; on Linux `npm install` compiles it
  (needs python3, make and a C++ compiler). The package keeps it outside app.asar.

## Installing the CLIs on Windows

Claude Code (native installer, PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Codex CLI:

```bash
npm install -g @openai/codex
```

Grok Build: install it from x.ai (it lands in `%USERPROFILE%\.grok\bin`, which must be on the PATH).

Then log in once to each, interactively (`claude`, `codex login` and `grok login`).
The app shows in Settings whether it found each command on the PATH.

## Workspace

Everything the app produces lives in a local workspace folder:

```
<workspace>/
  runs/      logs of each run (see Observability)
  repos/     cloned repositories
  worktrees/ one git worktree per run (<run_id>), see "A git worktree per run"
  projects/  projects (one .json per project)
  skills/    skills (one folder with SKILL.md per skill)
  backlog/   last issue sync of each project (one .json per project)
  agents/    user-defined agents (one .json per agent; supervisor.json = the supervisor's look)
  workflows/ workflow definitions (one .yaml per workflow)
  settings.json  app preferences, budgets and prices
```

- **Bundled defaults.** The app folder (read-only `app.asar` in the packaged app) only holds the
  default skills and workflows; the app and `scripts/run.js` copy them into `skills/` and
  `workflows/` on startup, and everything is read and edited there. `.seeded.json` in each folder
  records the content hash of each copied default:
  - a default not copied yet is copied (unless you already have a file with that name, which is kept);
  - an untouched copy is updated when a new app version ships a new version of it (e.g.
    `software-development` 0.9.0 → 0.10.0);
  - a copy you edited is never overwritten; Workflows > Definitions shows it as **modified**, with
    **newer default** when the app ships a newer version, and **Restore default** (your copy goes to
    the trash);
  - a default you deleted is not brought back (to get it back, remove its entry from `.seeded.json`);
  - files you created are never touched.
- Runs record the workflow file name. Resuming a run (or opening its sessions or supervisor) reads
  the workflow from `<workspace>/workflows/`; if you deleted it, the bundled copy is used and the run
  log says so.

- On startup the app looks for `%USERPROFILE%\multiagent-workspace`. If it does not exist, it asks
  whether to create it or pick another folder.
- The chosen path is stored in the Windows registry at
  `HKCU\Software\MultiagentOrchestrator\WorkspacePath` and reloaded on the next launches
  (on other OSes, in `~/.multiagent-orchestrator.json`). If the stored folder disappears, the app asks again.
- Settings shows the current workspace, with **Open** and **Change…**.
- The `repo_path` input accepts a git URL (`https://…` or `git@…`): the app clones it into
  `repos/<owner>-<repo>` (or runs `git fetch` if already cloned) and runs the workflow on that copy.
- `MULTIAGENT_WORKSPACE=<folder>` overrides the workspace without writing to the registry (used by `npm test`).
- `scripts/run.js` uses the same workspace; with nothing stored, it creates the default folder.

## Observability

Each run writes to `<workspace>/runs/<run_id>/`:

- `events.jsonl`: every event (step, transition, session, approval, saved file…)
- `sessions/<id>.jsonl`: each session's events (prompts, thinking, tools, output)
- `summary.json`: final metrics per session (duration, active, idle, tokens, cost)
- files written by `save_as` (e.g. `arena/`, `review.md`)
- `decisions.tsv`: the agents' decision log (time, agent, step, phase, decision, why, evidence, result)

Notes:
- Claude Code reports cost; Codex does not, so the cost of Codex sessions is empty.
- The Anthropic API counts thinking tokens inside `output`; `reasoning` is only separate for Codex.

## Structure

```
src/main.js              Electron main process + IPC
src/preload.js           safe API exposed to the renderer
src/workspace.js         workspace folder (Windows registry, runs/, repos/, workflows/, clone)
src/projects.js          projects: CRUD and folder/repository setup
src/backlog.js           backlog: project issues via gh/glab, sync cache, issue ↔ run links, workflow queue
src/seed.js              seeding of bundled defaults into the workspace (.seeded.json, origin status, restore)
src/skills.js            skills: CRUD, lookup, seeding and prompt block
src/agents.js            agents: CRUD, appearance validation, the built-in supervisor
src/workflows.js         workflows: seeding, origin status, lookup (workspace, then bundled)
src/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
src/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
src/engine/workflow.js   engine that runs the YAML graph
src/engine/providers.js  claude / codex / grok / mock adapters
src/engine/recorder.js   writes to disk (jsonl + summary)
src/engine/worktree.js   git worktree per run: create, reuse on resume, remove, orphan cleanup
src/renderer/            UI (plain HTML/CSS/JS)
workflows/               bundled workflow definitions (copied into <workspace>/workflows)
skills/                  bundled skills (copied into <workspace>/skills)
.github/workflows/       CI (PRs) and deploy (merge into main)
scripts/                 terminal runner, tests, build and UI smoke test
test/                    unit tests (node:test) and fixtures
```
