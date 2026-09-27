# Multiagent Orchestrator

Electron app that runs multi-agent workflows defined in YAML (`workflows/`), opening
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
| Dashboard | "What are we building today?": Plan & Design, Code & Build and Monitor & Improve open the start panel filtered by the workflow's `metadata.category` (`plan`, `build`, `monitor`) |
| Projects | Projects in `<workspace>/projects/<id>.json`. Every project has a folder (default: `<workspace>/projects/<id>/`) and optionally a git repository, cloned into the folder if it is not a repo yet |
| Workflows | The YAMLs in `workflows/` with their steps, agents/models, skills, `/goal`, `/loop`, parallel steps and branches |
| Skills | One folder per skill in `<workspace>/skills/<id>/SKILL.md` (Claude Code format) |
| Usage | Tokens and cost per provider this month and today, monthly budgets (USD and/or tokens), per-model prices for CLIs that do not report cost, recent runs. The topbar widget shows this month's total; click it for a per-provider popover |
| Settings | Workspace, CLI status (Claude Code, Codex, Grok Build, GitHub CLI, GitLab CLI, Git) and run preferences (`<workspace>/settings.json`) |

The **Start** button at the top (next to Stop) opens the right side panel: pick the workflow,
the project (its folder becomes `repo_path`/`project_path`) and the input. During and after a
run, **Run** shows up at the bottom of the menu with the sessions and events.

Recommended: Node 24 LTS (the build also works on older Node, using the Node bundled with Electron).

From the terminal (no UI):

```bash
npm test
```

Runs the unit tests (`test/`, node:test) and the full flow in mock mode. This is what CI runs.

```bash
npm run run -- --task "Task description" --repo C:/path/to/repo --input language=python --input git_platform=gl
```

Runs the workflow for real. `--file ai-arena.yaml` picks another workflow. `--auto-approve`
approves every human gate without interaction (tests only: in practice the AI must not cross the gates).

Local build: `npm run build` (writes `build/`) or `npm run package` (writes `dist/`, used by the deploy).

## Software development flow (`workflows/software-development.yaml`)

| Stage | Agent | Model | What it does | Skills |
|---|---|---|---|---|
| Build & Test | Developer | Opus 5.5 | Implements and fixes everything the other agents report | `unit-test-writer-<language>`, `bug-diagnosis`, `merge-conflict-resolver`, `decision-log` |
| | Code Review | Codex gpt-6-luna | Reviews the diff on correctness, spec and standards; requests changes only for blocker/major | `code-review` |
| | Test Writer | Sonnet 5 | Writes/updates tests and runs the suite; failures go back to the developer | `unit-test-writer-<language>` |
| | Builder | Sonnet 5 | Build + dependency audit; a broken build or a high/critical production vulnerability goes back to the developer | `build-audit-<language>` |
| | Verifier | Sonnet 5 | Proves the change does what the task asked: same command on the base and on the branch; `not_verified` goes back to the developer, `inconclusive` does not block | `claim-verification` |
| CI/CD | CI Pusher | Opus 4.8 | Push, opens the PR/MR, **/goal** CI green with **/loop**; on failure fetches the log and calls the developer | `ci-pipeline-<platform>` |
| | PR Babysitter | Opus 4.8 | **/goal** PR/MR mergeable with **/loop**; actionable comments → developer (replies with the hash), doubtful ones → human | `pr-babysitter-<platform>`, `decision-log` |
| | Deployer | Opus 4.8 | Publishes the preview, and after the merge tracks the production deploy | `deploy-<platform>` |

Two inputs choose the skills:
- `language`: `js`, `python`, `go`, `java` or `csharp`.
- `git_platform`: `gh` (GitHub, `gh` CLI) or `gl` (GitLab, `glab` CLI). This also picks the merge
  command at the approval gate.

Human gates: a doubtful PR/MR comment (fix / justify / ignore) and the merge, which produces
the production release. Agents never talk to each other: the orchestrator (engine) hands
failures to the developer and returns the result to the agent that asked.

`/goal` and `/loop` are declared per step in the YAML (`goal.until`, `loop.interval`,
`loop.max_duration`). The engine repeats the step until the goal is met and injects the /goal
and /loop instructions (current iteration, interval and limit) into the agent's prompt.

## AI Arena (`workflows/ai-arena.yaml`)

Several models write the same document (default: a PRD) and an orchestrator merges them.

| Stage | Who | What it does |
|---|---|---|
| compete | Opus 5.5, Sonnet 5, gpt-6-luna, Grok 4.7 **in parallel** | Each writes the document without seeing the others, plus a short rationale (alternatives rejected, assumptions), and is told not to drift to a safe middle ground (`arena/proposals/<agent>.md`). With `lenses: on`, each works under a different forced lens (user value, lean MVP, risk first, feasibility first) |
| critique | the same, in parallel (`peer_review: yes`) | Each scores the **others'** anonymized proposals and says what it would change in its own |
| synthesize | synthesizer (Opus 5.5, own session) | `arena-synthesis` skill: picks the best proposal as the **base** and grafts the best ideas of the others; convergence/divergence check; opinionated conflict decisions; appendix with scoreboard, base, grafts, rejected ideas, dismissed critiques and dropouts |
| verify | verifier (gpt-6-luna, another family, fresh session) | Checks the final document against the document skill and the proposals (missing sections, contradictions, unsupported claims, dropped consensus); on issues, one more synthesis round |
| review | human | Sees the verifier's verdict and who wrote each proposal; accepts or asks for a new synthesis |

Proposals are anonymized as "Proposal N" in an order shuffled per run (the `shuffle(run_id)`
template filter), the same in every step, so position and labels do not give the model away.
Base-and-graft, the verify step and the rationale/anti-hedging instructions adapt ideas from the
arena skill in [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT).

The final document goes to `<run>/arena/final.md` and to `<project>/<save_to>/` (default `docs/arena`).
Its format comes from the skill in the `document_skill` input (default `prd-writing`): for an ADR,
tech spec and so on, create a skill with the structure and the rubric and pass its name. To change
the contenders, edit `agents` in the `compete` and `critique` steps.

## Multi-model code review (`workflows/multi-model-review.yaml`)

Reviews an existing branch without changing anything or posting to the PR/MR.

| Stage | Who | What it does |
|---|---|---|
| review | Opus 5.5, Sonnet 5, gpt-6-luna **in parallel** | Each reviews the diff with `code-review` (`review/<agent>.json`) |
| blast_radius | Sonnet 5 | `blast-radius`: consumers outside the diff and the key safety fact, proven by running code |
| judge | Opus 5.5 (own session) | `review-synthesis`: reads the diff, merges and verifies the anonymized findings into act on / consider / noted / dismissed, with a verdict (`review.md`) |

## Run retrospective (`workflows/run-retrospective.yaml`)

Monitor & Improve. Given a `run_id`, reads that run's `events.jsonl`, sessions,
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
| `ci-pipeline-{gh,gl}` | CI pusher | Push, PR/MR, CI status, fetching failed logs, retrying flaky jobs |
| `ci-failure-triage` | via `uses` | Classify a failure (code, environment, infrastructure, needs-human) and write a root-cause report |
| `pr-description` | via `uses` | PR/MR title and body: visual summary, evidence, merge danger |
| `pr-babysitter-{gh,gl}` | PR babysitter | Mergeability signals, threads/discussions, replies |
| `pr-comment-triage` | via `uses` | Actionable vs doubtful comments, durable fix requests, resume logic, AI marker on replies |
| `deploy-{gh,gl}` | deployer | Preview and production deploy tracking and cleanup |
| `bug-diagnosis` | developer | Red feedback loop first, ranked hypotheses, regression test, cleanup |
| `merge-conflict-resolver` | developer | Intent tracing per side, hunk-by-hunk resolution, verification |
| `prd-writing` | arena | PRD structure (user stories, traceable requirements, testing decisions, questions with defaults) and scoring rubric |
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

### Parallel steps

Steps with `agents: [a, b, c]` run in parallel (fan-out; `min_success` sets how many must answer)
and return `{ results: { agent: output }, succeeded, failed }`. `save_as` writes the answer to a
file (relative to the run folder).

## CI/CD

- `.github/workflows/ci.yml`: on every PR runs a syntax check, `npm test` and a production `npm audit`.
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
  projects/  projects (one .json per project)
  skills/    skills (one folder with SKILL.md per skill)
```

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
src/workspace.js         workspace folder (Windows registry, runs/, repos/, clone)
src/projects.js          projects: CRUD and folder/repository setup
src/skills.js            skills: CRUD, lookup, seeding and prompt block
src/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
src/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
src/engine/workflow.js   engine that runs the YAML graph
src/engine/providers.js  claude / codex / grok / mock adapters
src/engine/recorder.js   writes to disk (jsonl + summary)
src/renderer/            UI (plain HTML/CSS/JS)
workflows/               workflow definitions
skills/                  bundled skills (copied into <workspace>/skills)
.github/workflows/       CI (PRs) and deploy (merge into main)
scripts/                 terminal runner, tests, build and UI smoke test
test/                    unit tests (node:test) and fixtures
```
