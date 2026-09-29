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
  `worktrees/` (one git worktree per run, `<run_id>`), `projects/` (`<id>.json`), `skills/`, `settings.json`. The owner's project `multiagent-orchestrator`
  points at `repos/eduardogalbiati-multiagent-orchestrator` (SSH remote; the repo is private).
- The owner uses **subscription plans** (Claude, ChatGPT free for Codex, SuperGrok), not API keys.

## Commands

```
npm start                  # the app
npm test                   # node:test unit tests (test/*.test.js) + a full mock run of software-development
npm run run -- --file ai-arena.yaml --mock --auto-approve --input project_path=C:/x --task "..."
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
| `src/main.js` | Electron main: window, workspace dialog, IPC transport (registers every `service.api` channel), desktop-only actions (native dialogs, clipboard, open path/artifact, external console, workspace change). |
| `src/auth.js` / `src/auth-config.js` | Account sign-in (Supabase Auth, OAuth: system browser + PKCE + one-shot loopback server on `127.0.0.1:47823/auth/callback`) and the 7-day trial. No Electron: main passes a `fileStorage` encrypted with `safeStorage` (`%APPDATA%/…/account.bin`). `assertCanRun({ mock })` gates `run:start`/`supervisor:resume` via `host.assertCanRun` (simulations always allowed). Entitlement comes from the SQL function `entitlement()` (server clock), cached 3 days for offline use. `auth-config.js` holds the public URL + publishable key and the enabled providers (only `google` for now). Dev only: `MULTIAGENT_SUPABASE_URL`/`_KEY` override, `MULTIAGENT_AUTH=off` disables; the packaged app ignores them and always requires sign-in. |
| `supabase/migrations/` | `accounts` table (`trial_ends_at` = now + 7 days via trigger on `auth.users`, `plan` trial/pro, RLS read-own only) and `entitlement()`. Applied by pasting into the Supabase SQL editor. |
| `src/preload.js` | `window.api` exposed to the renderer (sandboxed; no Node there). |
| `src/renderer/` | Plain HTML/CSS/JS UI, no bundler. Libraries loaded with `<script src="../../node_modules/...">` (UMD): xterm, addon-fit, marked, DOMPurify. Views: dashboard, projects (+ project detail with runs/sessions/artifacts), artifacts, workflows, skills, usage, settings, run; terminal dock; supervisor drawer. |
| `src/skills.js` | Skill CRUD, `resolveSkill` (workspace first, then bundled `skills/`), `skillPrompt`, `seedSkills` (copies bundled skills once, updates untouched copies by content hash, `.seeded.json`). |
| `src/workspace.js` | Workspace path (registry / env) and `layout()` (`runs`, `repos`, `worktrees`, ...); exports `gitAuthArgs` (gh credential helper for clone/fetch). |
| `src/projects.js` | Projects; a project with a repo and no folder is cloned into `repos/`; `previousFolders` kept when the folder changes. |
| `src/runs.js` | Runs on disk (`readRun`/`listRuns`, interrupted runs rebuilt from events), `runsForProject` (project id, else folders), `projectOf` (a run's project), `runArtifacts`. The same run list component is shown in Projects > Project and Workflows > Runs (IPC `projects:runs` and `runs:list`, shared `runListItem`). |
| `src/usage.js` / `src/local-usage.js` | Token/cost usage per provider (scope orchestrator vs this machine from the CLIs' own logs: ~/.claude/projects, ~/.codex/sessions, ~/.grok/sessions), Codex plan limits/credits, budgets, `preflight` (missing CLI, budget, empty folder inputs). |
| `src/supervisor.js` | AI supervisor: decision/analysis schemas, prompts, `runReport`, `analyzeRun` (saves `supervisor/analysis-*.md`), `resumeSpec` (also returns the run's `worktree: { dir, branch }`). Skill: `skills/run-supervisor`. |
| `src/terminals.js` / `src/session-tail.js` | Embedded terminals: node-pty pseudoterminals (CLI resume, supervisor chat) and virtual terminals (live log follower, no process). |
| `workflows/*.yaml` | `software-development` (language + git_platform inputs pick skills), `ai-arena` (4 models compete → blind critique → base+graft synthesis → verify → human review), `multi-model-review`, `run-retrospective`. |
| `skills/` | 33 bundled skills (see README table). |

## Engine features to know (YAML)

- `agents.<name>.skills` (system prompt, 1st turn) and `steps[].skills` (step prompt); names can be
  templates (`"unit-test-writer-{{ inputs.language }}"`).
- `agents: [a, b]` = parallel fan-out → `{ results, succeeded, failed }`, `min_success`.
- `save_as` (string or list, relative to the run folder), `on_error: <step>`.
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
- Pop-out window for the supervisor chat; free-text feedback on human gates (e.g. arena redo).
- Arena ideas not done: rubric hidden from contenders, contenders configurable by input.
- Worktree follow-ups: confirm with the first real merge that `gh pr merge --repo` leaves local
  branches alone; "Open in CLI" after a worktree is removed opens in `repo_path`, where
  `claude --resume` may not find the session (Claude keys sessions by folder); allow concurrent
  runs in the app.
