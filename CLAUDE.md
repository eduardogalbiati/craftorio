# Multiagent Orchestrator: project context

Read this before implementing anything. The README has the user-facing documentation; this file
has what an agent needs to work on the code safely.

## What it is

An Electron desktop app (Windows first) that runs multi-agent workflows defined in YAML. Each agent
turn is a headless CLI process: **Claude Code** (`claude -p`), **Codex CLI** (`codex exec`) or
**Grok Build** (`grok --prompt-file`). A **deterministic engine** walks the workflow graph; an **AI
supervisor** is called only when a step fails, or on demand. Everything is recorded for
observability (tokens, cost, prompts, thinking, tool calls) in a local workspace folder.

Owner: Eduardo Galbiati (GitHub `eduardogalbiati/multiagent-orchestrator`, default branch `main`).

## Hard rules

- **Everything in the app is English**: UI, YAML, skills, README, comments, logs, errors, test
  names. (The owner chats in Portuguese; reply to him in Portuguese, but write the code in English.)
- **Skill naming**: language- or platform-specific skills are `<capability>-<suffix>`, with one
  skill per suffix in every family (a test enforces it). Language suffixes: `js`, `python`, `go`,
  `java`, `csharp`. Platform suffixes: `gh` (GitHub, gh CLI), `gl` (GitLab, glab CLI). What a family
  shares lives in a suffix-less skill referenced with `uses:`. `code-review` is a single skill with
  per-language `rules/*.md` (the owner likes it that way).
- **Agents run unattended**: skills must never "ask the user". They record an assumption or a
  recommended default instead.
- **The app ships as a packaged .exe; the workspace is what matters.** Everything the user edits
  or produces (workflows, skills, projects, runs, settings) lives in the workspace folder; the app
  folder (app.asar, read-only) only holds bundled defaults to seed from. Never read or write user
  data relative to `__dirname`. (Workflows are still loaded from the app's `workflows/`: being moved.)
- **The AI supervisor works on workflows, not on the user's code.** It unblocks runs and helps
  customize workflows/skills; it has no access to the repositories and never prescribes code fixes
  (it routes code problems to the workflow's agents with evidence and hypotheses).
- **Never let automation cross a human gate** (`human_approval` steps), including the supervisor.
- Work goes through **branch + PR**. The owner merges; afterwards he asks to "go back to main and
  pull". Don't commit to `main` directly. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Environment

- Node **24** (`engines`, `.nvmrc`), npm 11. **npm 11 runs install scripts only for packages in
  `allowScripts`** (package.json): `node-pty@1.1.0` is approved. After upgrading it, run
  `npm approve-scripts node-pty`.
- Electron **44.4.5** (bundles Node 24.21). Electron 44 has no postinstall: its binary downloads on
  first use (`node node_modules/electron/install.js` to force it).
- Installed CLIs: `claude` (~/.local/bin), `codex` (WinGet), `grok` (~/.grok/bin), `gh` in
  `C:\Program Files\GitHub CLI\gh.exe` (**not on the Git Bash PATH**; call it by full path from
  PowerShell), `glab` optional.
- Workspace: `%USERPROFILE%\multiagent-workspace` (registry `HKCU\Software\MultiagentOrchestrator\WorkspacePath`,
  overridable with `MULTIAGENT_WORKSPACE`). Layout: `runs/`, `repos/` (git checkouts, `<owner>-<repo>`),
  `worktrees/` (one git worktree per run, `<run_id>`), `backlog/` (issue sync per project), `projects/` (`<id>.json`), `skills/`, `agents/` (`<id>.json`), `settings.json`. The owner's project `multiagent-orchestrator`
  points at `repos/eduardogalbiati-multiagent-orchestrator` (SSH remote; the repo is private).
- The owner uses **subscription plans** (Claude, ChatGPT free for Codex, SuperGrok), not API keys.

## Commands

```
npm start                  # the app
npm test                   # node:test unit tests (test/*.test.js) + a full mock run of software-development
npm run run -- --file ai-arena.yaml --mock --auto-approve --input project_path=C:/x --task "..."
npm run serve -- --port 7300 [--host h] [--workspace dir]   # engine server + UI in a browser (prints URL with token)
npm run build              # packaged app in build/ (npm run package → dist/)
npx electron scripts/smoke.js <out.png>   # UI smoke test: mock run + screenshot
```

Node 24's test reporter is "spec", not TAP: look for `ℹ pass N` / `✖`, not `# pass`.
`npm test` must pass on Windows, Linux and macOS: `ci.yml` runs a matrix (checks `test (<os>)`)
plus a combined `test` check that is green only when all three are. `preview.yml`/`deploy.yml`
run on `windows-latest` and also run `npm test`.

## Code map

| File | What it does |
|---|---|
| `src/engine/workflow.js` | Engine. `loadWorkflow`, `WorkflowRun` (graph walk, transitions, `/goal` + `/loop`, delegation, fan-out `agents: [...]`, `save_as`, `on_error`, schema validation + retries, skills injection with `uses:`, budgets check per turn, decision log `decisions.tsv`, AI supervisor `superviseFailure`, resume from step, per-run worktree lifecycle `setupWorktree`/`finishWorktree`, run outcome from the ending transition's `status`, `mockSequences` option to steer the mock per field in tests, `github_repo` filter validating `pr_url` for the merge action). Exports `render` (nunjucks, autoescape off, filters `to_yaml`, `to_json`, `shuffle(seed)`). |
| `src/engine/providers.js` | CLI adapters and stream parsers: claude-code, codex-cli, grok-cli (NDJSON deltas, `--prompt-file` via `prompt_file_arg`), mock. `resolveCommand` finds CLIs on Windows. |
| `src/engine/worktree.js` | Per-run git worktrees: `prepareWorktree` (prune, fetch `origin/<base>` with fallbacks, `worktree add --detach`; reuse or recreate from the run's branch on resume), `removeWorktree` (deletes the local branch only if merged, squash merges included via `git cherry`), `cleanupWorktrees` (at app start: succeeded runs and worktrees unused for 14 days). `canonicalPath`/`samePath` (realpath: 8.3 names, symlinks, junctions): use them for any path compared with or made relative to git output. |
| `src/engine/recorder.js` | `events.jsonl`, `sessions/<id>.jsonl`, `summary.json` per run. |
| `src/service/index.js` | Engine service, no Electron: `createService({ host })` → `api` (channel → fn: workflows, projects, skills, runs, usage, artifacts, supervisor, embedded terminals), `notifications` (`term:input`/`term:resize`), `events` (`run:event`, `term:data`, `term:exit`), plus helpers for the desktop layer. `host` = `trashItem`, `appVersion`, `isPackaged`. Owns the current run (`startWorkflowRun`, also used to resume). Meant to be exposed over HTTP/WS later; keep Electron out of it. |
| `src/server/index.js` / `scripts/serve.js` | HTTP + WebSocket transport for the service (`npm run serve`): `POST /api/<channel>` `{arg}` → `{result}`/`{error}`, `/ws` pushes `run:event`/`term:*`/`auth:changed` and takes `term:input`/`term:resize`, serves the UI (only `src/renderer/` + the whitelisted `node_modules` libs). Token via Bearer header or the HttpOnly SameSite=Strict cookie set by `/?token=`; cross-origin requests refused. `src/renderer/api-http.js` builds `window.api` over it when there is no preload (a test keeps its method list equal to `preload.js`). Server session in `~/.multiagent-orchestrator/server-account.json` (0600, not OS-encrypted); `trashItem` moves to `<workspace>/.trash`. |
| `src/main.js` | Electron main: window, workspace dialog, IPC transport (registers every `service.api` channel), desktop-only actions (native dialogs, clipboard, open path/artifact, external console, workspace change). |
| `src/auth.js` / `src/auth-config.js` | Account sign-in (Supabase Auth, OAuth: system browser + PKCE + one-shot loopback server on `127.0.0.1:47823/auth/callback`) and the 7-day trial. No Electron: main passes a `fileStorage` encrypted with `safeStorage` (`%APPDATA%/…/account.bin`). `assertCanRun({ mock })` gates `run:start`/`supervisor:resume` via `host.assertCanRun` (simulations always allowed). Entitlement comes from the SQL function `entitlement()` (server clock), cached 3 days for offline use. `auth-config.js` holds the public URL + publishable key and the enabled providers (only `google` for now). Dev only: `MULTIAGENT_SUPABASE_URL`/`_KEY` override, `MULTIAGENT_AUTH=off` disables; the packaged app ignores them and always requires sign-in. |
| `supabase/migrations/` | `accounts` table (`trial_ends_at` = now + 7 days via trigger on `auth.users`, `plan` trial/pro, RLS read-own only) and `entitlement()`. Applied by pasting into the Supabase SQL editor. |
| `src/preload.js` | `window.api` exposed to the renderer (sandboxed; no Node there). |
| `src/renderer/duo.js` / `robots.js` | Write & Review screen: setup (prompt, goal, writer/reviewer CLI + model + effort) and the run as a chat rebuilt from run events, live or replayed (`runs:events`, "Open chat" in the runs list). `robots.js` draws the isometric robot avatars (variant per provider, animated states, model name plate, mirroring). |
| `src/renderer/arena.js` / `arena-shuffle.js` | AI Arena screen: setup (request, optional project, document skill, peer review, lenses, 2–5 contenders with CLI + model + effort) and the ai-arena run as a chat (proposals, blind critiques with the real authors, synthesis, verifier, the supervisor's gate inline, peer-score board), live or replayed ("Open chat"). Reuses duo.css + `window.ChatModels` from duo.js. `arena-shuffle.js` mirrors the engine's `shuffle` filter (inline SHA-256) to map "Proposal N" to its author; a test keeps them equal. |
| `src/renderer/` | Plain HTML/CSS/JS UI, no bundler. Libraries loaded with `<script src="../../node_modules/...">` (UMD): xterm, addon-fit, marked, DOMPurify. Views: dashboard, projects (+ project detail with runs/sessions/artifacts), artifacts, workflows, agents, skills, usage, settings, run; terminal dock; supervisor drawer. |
| `src/skills.js` | Skill CRUD, `resolveSkill` (workspace first, then bundled `skills/`), `skillPrompt`, `seedSkills` (copies bundled skills once, updates untouched copies by content hash, `.seeded.json`). |
| `src/agents.js` | Agents menu: user-defined agents in `agents/<id>.json` (name, description, prompt, skills, `appearance` = { body, shell, visor, glow, eyes, emblem }). The built-in supervisor is always first, can't be removed and only saves its look (`agents/supervisor.json`). EYES/EMBLEMS must match `robots.js` (a test checks). Renderer: `src/renderer/agents.js`; `Robots.define('supervisor', look)` recolors it in Write & Review. Not used by workflows yet. |
| `src/workspace.js` | Workspace path (registry / env) and `layout()` (`runs`, `repos`, `worktrees`, ...); exports `gitAuthArgs` (gh credential helper for clone/fetch). |
| `src/projects.js` | Projects; a project with a repo and no folder is cloned into `repos/`; `previousFolders` kept when the folder changes. |
| `src/backlog.js` / `src/renderer/backlog.js` | Backlog screen: a project's issues via `gh issue list` / `glab issue list` (Bitbucket: no sync yet), cached in `<workspace>/backlog/<id>.json`; `linkRuns` ties runs to issues (task/inputs mention the URL or `#n`, mock runs excluded) and picks the kanban column. Default platform: setting `backlogPlatform`. IPC `backlog:get`/`backlog:sync`. |
| `src/runs.js` | Runs on disk (`readRun`/`listRuns`, interrupted runs rebuilt from events), `runsForProject` (project id, else folders), `projectOf` (a run's project), `runArtifacts`. The same run list component is shown in Projects > Project and Workflows > Runs (IPC `projects:runs` and `runs:list`, shared `runListItem`). |
| `src/usage.js` / `src/local-usage.js` | Token/cost usage per provider (scope orchestrator vs this machine from the CLIs' own logs: ~/.claude/projects, ~/.codex/sessions, ~/.grok/sessions), Codex plan limits/credits, budgets, `preflight` (missing CLI, budget, empty folder inputs). |
| `src/supervisor.js` | AI supervisor: decision/analysis schemas, prompts, `runReport`, `analyzeRun` (saves `supervisor/analysis-*.md`), `resumeSpec` (also returns the run's `worktree: { dir, branch }`). Skill: `skills/run-supervisor`. |
| `src/terminals.js` / `src/session-tail.js` | Embedded terminals: node-pty pseudoterminals (CLI resume, supervisor chat) and virtual terminals (live log follower, no process). |
| `src/cli-sessions.js` / `src/renderer/sessions.js` | Sessions screen (first menu item): lists the CLIs' own conversations on this machine (head/tail of each file, cached by mtime+size; `CLI_PROVIDERS` = interactive new/resume args, `cliArgs` rejects unsafe values) and runs the CLIs in embedded terminals (`term:open` kinds `cli-resume` — folder looked up server side, never from the caller — and `cli-new`). The service tags sessions with their project and `workflowAgent` (headless, or in `runs/`/`worktrees/`). Terminals there reuse app.js's `createXterm`/`wireTerminal`; `SessionsView.findTab` routes `term:data`. In automated checks put a fake **`.exe`** first on PATH (`resolveCommand` prefers any `.exe` over a `.cmd`) or a real CLI starts. Folders inside the workspace are pre-trusted in each CLI's own config (`src/cli-trust.js`; Claude's trust does not cross a git root, so the folder and its repo root are written). Titles the user gives live in `<workspace>/session-titles.json` (the CLIs' files are never edited). Codex runs with `--no-daemon` (the shared app-server refuses the WinGet install and would outlive the terminal). `Terminals.kill` kills the whole process tree (taskkill /T; `pgrep -P` elsewhere). |
| `workflows/*.yaml` | `software-development` (language + git_platform inputs pick skills), `ai-arena` (2–5 user-picked models compete → blind critique → base+graft synthesis → verify → human review), `multi-model-review`, `run-retrospective`, `writer-reviewer` (user-picked writer/reviewer loop until a score threshold, internal Opus 5.5 sign-off). |
| `skills/` | 37 bundled skills (see README table). |

## Engine features to know (YAML)

- `agents.<name>.skills` (system prompt, 1st turn) and `steps[].skills` (step prompt); names can be
  templates (`"unit-test-writer-{{ inputs.language }}"`).
- `agents: [a, b]` = parallel fan-out → `{ results, succeeded, failed }`, `min_success`.
- `save_as` (string or list, relative to the run folder; `{ path, content }` saves one field), `on_error: <step>`.
- Inputs with `type: run` take another run's id: empty/`latest` → the most recent run of another
  workflow; an id with no `runs/<id>/events.jsonl` is refused when the run is created (the UI shows
  it before anything starts). Used by `run-retrospective`.
- Agent `provider`/`model`/`effort` can be templates over the inputs (resolved once in the constructor);
  `cli_args` can be a map keyed by provider; providers' `effort_args` get `{{ effort }}`.
  `max_visits` / `loop.max_iterations` accept templates. `agents.<name>.enabled` (bool or template)
  drops an agent from the run (`dropDisabledAgents`: removed from fan-outs, `min_success` capped;
  a single-agent step on it throws). ai-arena's five contender slots use it (`provider: none`).
- Human gates can ask for free text (`feedback: true | { label, placeholder }`): `output.feedback` and the
  run-wide `feedback` list in templates (`approval:resolve` takes `feedback`). `previous_step` = the step that
  ran before. The Write & Review chat answers its run's gates inline (the approval dialog stays hidden there).
- `orchestrator.supervisor: { enabled, max_interventions }` — per step 2, per run 6.
- How a run ends: a transition with `goto: end` may carry `status: success | failed | cancelled`
  (default success; also valid with `on_exhausted: end`; `loadWorkflow` rejects other values).
  Rejecting a failure gate → `failed`; rejecting `human_review`/`approve_merge` → `cancelled`.
  Non-success keeps the worktree. When `max_visits`/`loop.max_iterations` runs out, the transition
  goes to `on_exhausted` WITHOUT its `delegate` (no unchecked "one more fix").
- Human gates can offer `choices` (each with its own transition); failure gates use them so every
  option does something different (e.g. `preview_failed`: publish again / send to developer / stop).
  software-development (0.9.0): the deployer returns `failure_class: code | infra | unknown`; a
  preview `code` failure goes to the developer → `ci` → `pr_babysitter` → `deploy_test` (2
  automatic rounds, then the gate).
- `providers.<p>.skill_args` (claude `--add-dir {{ skill_dir }}`), `prompt_file_arg` (grok).
- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: each run
  works in its own worktree (`<workspace>/worktrees/<run_id>`, detached at a freshly fetched
  `origin/<base>`). Removed on success, kept on failure/cancel for resume. Approval actions run in
  `worktree_dir`. Falls back to the repo path when it isn't a git repo; mock runs never create
  worktrees. Only `software-development` uses it (`multi-model-review` reviews the checked-out branch).
  Starts without `node_modules`: the language skills install dependencies when missing.
- Template context: `inputs`, `steps.<id>.output/visits`, `run_id`, `run_dir`, `runs_dir`,
  `workflows_dir`, `worktree_dir`, `agents.<name>.model`, `agent` (in fan-out), `delegate_result`.

## Hard-won gotchas

- **Line endings**: many files are CRLF. Patching with scripts must normalize `\r\n` → `\n` and
  restore; prefer the Edit tool. Git Bash heredocs mangle backslashes, backticks and quotes:
  write scripts with the Write tool into the scratchpad and run them with node.
- **node-pty on Windows**: a GUI-subsystem binary (Electron's exe, even with `ELECTRON_RUN_AS_NODE`)
  writes nothing into a pseudoterminal → the live log follower runs in-process (virtual terminal).
  node-pty re-quotes array args: pass `cmd.exe` its command line as **one string**. In the packaged
  app node-pty must be loaded from `app.asar.unpacked` (its worker thread can't read app.asar);
  `scripts/package.js` sets `asar.unpack` for it. `kill()` after exit prints "AttachConsole failed" (harmless).
- **Packaged exe is hardened** (`scripts/package.js` flips Electron fuses): no `ELECTRON_RUN_AS_NODE`,
  no `NODE_OPTIONS`/`--inspect`, only loads `app.asar` and refuses a modified one (integrity
  check); DevTools off and `--remote-debugging-port` exits when `app.isPackaged`. So the packaged
  app can't spawn itself as node: anything that must run as a node child ships unpacked
  (`asar.unpack`) and runs under the system `node` (e.g. the external live terminal).
- The packaged `.exe` returns immediately to the shell; its stdout doesn't show in Git Bash/PowerShell.
  Orphan test processes can lock `build/` (EBUSY/ENOTEMPTY): find them by command line before rebuilding,
  and never kill the owner's running app (`electron.exe .`).
- `npm install` of Electron fails with EBUSY while the app is open: ask the owner to close it.
- Schema retries: ephemeral agents answer retries in a fresh session → the engine resends the task,
  the previous answer and the schema (`retryPrompt`). Mock provider picks the first enum value
  unless `MOCK_SEQUENCES` has a fitting sequence (or the run's `mockSequences` option overrides
  it). The default sequence fails the preview once with `failure_class: code` and recovers.
  Numbers and booleans take sequences too (`score`, `ready`); `mockSequences.invalid_answers: { step: n }` makes
  the first n answers of a step miss its schema (exercises the retries and the supervisor). `run:start` takes
  `mockSequences` (simulation only): the Write & Review scenario picker uses it. Settings `developerMode`
  (replaces `mockByDefault`) shows the `.dev-only` Simulation checkboxes, checked by default; off = real runs.
  Simulated `/loop` waits scale with `MULTIAGENT_MOCK_DELAY_SCALE`.
- Claude local transcripts repeat each message while streaming: dedupe by message id + request id.
- Renderer changes: test with a temporary Electron script (see `scripts/smoke.js`) and screenshots;
  never open real CLI terminals or start real runs in automated checks (they cost money).
- Real-model calls cost the owner's money: say so and keep them minimal (one call to validate).
- **Agent permissions are enforced only by `cli_args`** (`permissions:` in YAML is documentation).
  Claude agents without `--permission-mode acceptEdits` can't Write/Edit, `mkdir`, redirect output
  or run heredocs with braces+quotes in headless mode: each attempt is a denial that burns time.
  Skills for read-only agents (verifier, builder, blaster, ci_pusher...) must use `git show <base>:<path>`,
  `git diff` and single `node -e` / `python -c` one-liners, never scratch files, stash or worktrees.
  Note that `Bash(git:*)`/`Bash(node:*)` can still change the repo: read-only is a convention, not a sandbox.
- **Paths**: never compare paths with `path.resolve` + lowercase alone. The GitHub Windows runner's
  temp folder is an 8.3 short path (`RUNNER~1`) while git prints long paths, and macOS `/var` is
  `/private/var`. Use `canonicalPath`/`samePath` from `src/engine/worktree.js`.
- **Tests are machine-independent**: git tests run with an empty `GIT_CONFIG_GLOBAL` and
  `GIT_CONFIG_NOSYSTEM`, passing identity, `init.defaultBranch=main` and `core.autocrlf=false` with
  `-c`. So any production git command that creates a commit needs its own `-c user.name/email`.
  Tests that pass locally can still fail on another OS: CI is the judge.
- **Worktrees**: a branch checked out in one worktree can't be deleted (`branch -D`) or checked out
  in another. So `gh pr merge` runs with `--repo <owner/repo>` (server side only, no local branch
  handling) and the engine deletes the local branch itself. `git switch -c b origin/<base>` sets
  `origin/<base>` as upstream: use `--no-track`. Git's error wording differs by version ("checked out
  at" before 2.42, "used by worktree at" after; CI runs a newer git than the local 2.32): don't match
  git messages in tests or code without accepting both.
- The app still runs one workflow at a time; the CLI (`npm run run`) can now run the same project
  concurrently thanks to worktrees.

## Open ideas / backlog

- Dynamic model roles: portable `permissions` → per-provider flags, then role → provider/model map
  with fallbacks when a CLI is missing or over budget (discussed, not built; the owner accepted
  requiring all three CLIs for now).
- Ticket slicer / planner step feeding fan-out implementers; arena "design-sketch" runs.
- Pop-out window for the supervisor chat; free-text feedback on the arena's gates (redo); the engine supports it now.
- Arena ideas not done: rubric hidden from contenders, contenders configurable by input.
- Worktree follow-ups: confirm with the first real merge that `gh pr merge --repo` leaves local
  branches alone; "Open in CLI" after a worktree is removed opens in `repo_path`, where
  `claude --resume` may not find the session (Claude keys sessions by folder); allow concurrent
  runs in the app.
