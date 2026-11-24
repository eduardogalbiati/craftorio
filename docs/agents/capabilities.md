# Agent capabilities and isolation

Read this before changing an agent's tools in a workflow, `packages/engine/engine/capabilities.js`, or a
skill for a read-only agent.

## In the YAML

```yaml
mcp_servers:                 # optional: MCP servers an agent may use, defined by the workflow
  docs: { command: npx, args: ["-y", "docs-mcp"] }
agents:
  developer:
    capabilities:
      tools: [read, edit, write, bash:git, bash:npm]   # bash = any command; lists may nest (anchors)
      web: false             # WebSearch / WebFetch (default false)
      mcp: []                # names from mcp_servers (default none)
      subagents: false       # the CLI's own sub-agents, e.g. Claude's Agent/Task (default false)
      screenshots: true      # false: the command guide names no screenshot folder (#223's E2E healer)
    isolation: true          # default; false = the user's own CLI setup is loaded too
steps:
  - id: publish
    agent: developer
    capabilities: { web: true }   # merged key by key over the agent's, for this step only
```

`loadWorkflow` rejects unknown keys, tools, non-boolean `web`/`subagents`/`screenshots` and MCP names missing from
`mcp_servers`. `cli_args` still apply on top (for anything the vocabulary doesn't cover); a bare
flag is never passed twice (`dedupeFlags`, clap-based CLIs refuse repeats). `permissions:` is gone
from the bundled workflows: it was documentation only. The run log gets one
`log` `kind: capabilities` line per agent with what was granted and what this CLI can't enforce.

The development workflows' `&toolchains` anchor lists the commands of every supported language;
the language skill says which one to use. Rust (#340) adds `bash:cargo`: `cargo test`, `cargo
clippy`, `cargo fmt`, and the optional `cargo nextest` / `cargo audit` subcommands all go through
it. The builder and the test writer need `cargo` (with clippy and rustfmt, as rustup installs
them in `~/.cargo/bin`) on the PATH the app starts with; nothing else is installed by the run.

## Per CLI (verified with Claude Code 2.1.283, Codex CLI 0.157, Grok Build 1.0.41)

| | Claude Code | Codex CLI | Grok Build |
|---|---|---|---|
| Isolation | `--strict-mcp-config` (only `--mcp-config`), `--no-chrome`, `--setting-sources ''` (no settings file at all: neither the user's plugins, hooks and permission rules nor the checkout's `.claude/settings*.json`, #468), `--disable-slash-commands` (no skill listing; the engine injects the workflow's skills), `--settings {"autoMemoryEnabled":false}` | `-c mcp_servers={…declared}`, `--disable plugins apps browser_use computer_use in_app_browser image_generation memories` | none from the command line: user MCP servers, skills and memory still load (`grok inspect` shows them) |
| Tools | `--tools` (only these built-ins are offered: fewer definitions in context) + `--allowedTools` (`Bash(git:*)` per `bash:git`) | `-s read-only`, or `workspace-write` when `edit`/`write` | read-only sets: `--tools read_file,list_dir,grep[,web_search,web_fetch]` |
| Writes | `--permission-mode acceptEdits` with `edit`/`write` | workspace-write sandbox (no network for commands) | not restricted (`--always-approve`) |
| Commands | allowlist per command (`Bash(npm:*)`), plus the same with the `AGENT_ENV` prefix and the shell utilities (below); `--add-dir <run_dir>/evidence`, `<run_dir>/logs` and `<run_dir>/scratch` | **not enforceable** (the sandbox limits writes, not which command runs) | not restricted |
| Web | `WebSearch`/`WebFetch` offered only with `web: true` | `-c web_search="disabled"` unless `web: true` | `--disable-web-search` unless `web: true` |
| Sub-agents | `Agent` and `Task` (the tool's current and older name; `--tools` drops names the CLI doesn't know) only with `subagents: true`; the `capabilities:` log line says `subagents: Agent/Task tool offered` | n/a (the log line says `subagents: not offered by Codex`) | `--no-subagents` unless `subagents: true` |
| MCP | `--mcp-config` with the declared servers + `mcp__<name>` allowed | declared servers only | not passed (noted in the log) |
| Test files (`edits_tests: false`) | `--disallowedTools "Edit(<glob>) …"` over `tests_paths` (a bare name gets `**/`); Bash can still write them | not refused (noted) | not refused (noted) |
| Request budget (`max_requests`, #302) | `--max-turns <n>` (unless the provider or `cli_args` set one); an `error_max_turns` result is a cut, wrapped up and continued (engine/sessions-and-handoff-notes.md) | **not enforceable** (noted in the `capabilities:` log line); the turn runs to its end | **not enforceable** (noted) |
| Images (#129, **not yet confirmed with a real call**) | `--add-dir <attachments folder>` + `Read` added to a restricted `--tools` (read-only agents and the tool-less Supervisor chat included) + the "Attached images" block with the absolute paths | not enabled until a real call confirms it: the block with the paths only, plus the same warning as Grok. Once `codex exec --image` is confirmed, `IMAGE_INPUT['codex-cli'] = 'flag'` passes `--image=<file>` per image (the `=` form: `--image` takes several values and would swallow `resume` or the stdin `-`) | no known way: the block with the paths only, plus one `log` `kind: attachments_unsupported` warning per step and agent; the step does not fail |

Images row: `packages/engine/engine/providers.js` (`IMAGE_INPUT`, `cliInvocation`). Limits, checked by
`checkAttachments` before anything is spawned (an error names the file and the limit): PNG, JPEG,
GIF and WebP (extension and first bytes), at most 10 images per turn, 10 MB each
(`ATTACHMENT_LIMITS`). Without attachments, the arguments and the prompt are exactly as before. To
confirm (real calls, the owner's money): one `claude -p`, `codex exec` and `grok --prompt-file` call
each with one small PNG and "Describe this image in one sentence", with a read-only and a writing
agent; then update the row (and `IMAGE_INPUT` if Grok turns out to read images, e.g. with `read_file`).

Whatever the CLI, the engine checks the turn's changes afterwards and sends a turn that touched
test files back (see `edits_tests` in [engine/agents-and-steps.md](engine/agents-and-steps.md)). The `Edit(...)` deny rules were
not tried against a real Claude CLI yet (real calls cost money): if one is refused, the engine
check still holds.

**Project instructions (#331)**: the engine passes no instructions file of its own; each CLI loads
the repository's from the worktree it runs in. This repository keeps them in `AGENTS.md`, and
`CLAUDE.md` is the import line `@AGENTS.md`. Codex CLI reads `AGENTS.md` (git root down to its
working directory). Claude Code reads `CLAUDE.md` and follows the import. Grok Build, per its
README (`~/.grok/README.md`, section "AGENTS.md", 1.0.41), reads `Agents.md`, `Claude.md`,
`AGENT.md` and `AGENTS.md` in every folder from the git root down to its working directory (10,000
characters per file): it gets `AGENTS.md` too, plus the one-line `CLAUDE.md`, which it does not
expand (harmless).

**Repository-controlled input (#468, SEC-3)**: the checkout's `CLAUDE.md` / `AGENTS.md` (and the
other names above) and its `.claude/` folder come from the repository, not from the user: a cloned
project or a PR branch can write them. The instructions files are read by design (a
prompt-injection channel the capabilities above contain: an agent still has only its tools). The
`.claude/settings*.json` files are not loaded under isolation (`--setting-sources ''`): they could
declare hooks and `permissions.allow` rules that Claude Code honours before `--allowedTools`. The
app auto-trusts only its own folders (`runs/`, `skills/`, `workflows/`, `trustWorkspaceFolder` in
`packages/engine/domains/cli/cli-trust.js`); `repos/`, `worktrees/` and project folders keep each CLI's own trust prompt,
which a live "cli-new" terminal shows to the user.

**Nested instructions files (#572)**: `packages/engine/`, `packages/ui-kit/`, each `fronts/<id>/`
and `scripts/` carry an `AGENTS.md` (the engine also a `CLAUDE.md` with `@AGENTS.md`). Codex reads
the nested `AGENTS.md` by its convention. Claude loads a folder's `CLAUDE.md` when it reads a file
in that folder; `.claude/rules/*.md` is project configuration, which `--setting-sources ''` may drop,
so it is not used. Manual check (a real-model call, not automated): start an isolated agent on this
repo (`npm run run -- --file ai-arena.yaml --task "Read packages/engine/engine/workflow.js and quote the
first rule your instructions give for that folder"`) and look in its session stream for the
nested file's "simulation" rule. Not yet run: the files also work as plain text an agent can be
pointed to, so nothing depends on the result.

`--bare` would isolate Claude further but only accepts API keys (no OAuth/subscription), so it is
not used. Measured on this repo (first request of a Claude agent, Haiku, "reply OK"): **41.1k
tokens with the user's setup → 22.0k isolated with the developer's capabilities**.

**Which account a CLI runs on (#312)**: each adapter names the variable of its config folder
(`configDirEnv` in `packages/shared/providers/<id>.js`: Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME`, Grok
none, always `~/.grok`); `packages/engine/domains/cli/cli-config-dirs.js` reads it from there. A session on one of Settings'
accounts gets `{ <configDirEnv>: <folder> }` (`accountEnv` in `packages/engine/engine/providers.js`) added to the
CLI process environment by `runCli`, after the agents' variables. It is never part of
`capabilities.agentEnv`, which is printed in prompts and allow rules. Adding an account in Settings
shows its login command (`packages/engine/domains/cli/provider-accounts.js`, e.g. `CLAUDE_CONFIG_DIR=<folder> claude /login`)
and whether the folder is signed in, read from that folder only (Claude: `claudeSignedIn` with only
that variable and no Keychain; Codex: `auth.json` exists, never read); no credential is stored,
logged or shown.

## Child environment (#470, SEC-5)

Every child process (agent turns in `providers.runCli`, transition actions, probes, the suite step,
the terminals' `cliEnv`) gets `childEnv` from `packages/engine/engine/child-env.js`, never the app's whole
environment:
- **Always**: `PATH`, `HOME` / `USERPROFILE`, `TMP` / `TEMP` / `TMPDIR`, `LANG` / `LC_*`,
  `SystemRoot` / `ComSpec` / `APPDATA` / `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `GIT_*`,
  plus the non-secret system variables node, npm and the CLIs need (`PATHEXT`, `windir`,
  `ProgramFiles*`, `USERNAME`, `TERM`, `NODE_OPTIONS`… the `ALLOWED_NAMES` list), and the
  toolchain homes of the skills' languages (`JAVA_HOME`, `M2_HOME`, `MAVEN_HOME`,
  `GRADLE_USER_HOME`, `GOPATH`, `GOROOT`, `GOFLAGS`, `DOTNET_ROOT`, `DOTNET_CLI_HOME`,
  `VIRTUAL_ENV`, `PYTHONPATH`, `CARGO_HOME`, `RUSTUP_HOME`). Any other variable a toolchain needs
  goes into `env.passthrough`.
- **Platform tokens**: `GH_*` and `GITHUB_TOKEN` only for an agent with `bash:gh` (or a free
  `bash`), `GITLAB_*` only with `bash:glab` (`platformsOf` in `packages/engine/engine/capabilities.js`).
  Transition actions, probes and the terminals get both (they run the workflow's own `gh`/`glab`
  commands); the suite step gets none.
- **On top**: the engine's `AGENT_ENV`, the scratch variables, the account's config folder and
  git's config, set by each caller as before.
- **`env.passthrough`**: a workflow's `env: { passthrough: [NAME, …] }` adds those exact names to
  agents, actions and the suite (a project whose tests need `DATABASE_URL`, or an `ANTHROPIC_API_KEY`
  login). Not per project yet.

Everything else stays out: `AWS_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `NPM_*`, `SSH_AUTH_SOCK`,
proxies. The recorded `spawn` event lists the env's keys (sorted), never its values.

## Sub-agents (who gets them and why)

Every request of a turn re-sends the whole conversation, so the files an agent reads in its own
context are paid again on every later request. An exploration sub-agent reads them in its own
context and returns only a summary. In the software-development workflows the **developer** and
the **test_writer** (the most expensive agent: a persistent session with long turns) have
`subagents: true` and the `context-economy` skill (#160). Sub-agents are their default for code
research: the first map before an edit (the test writer's maps the changed behaviours, the tests
that cover them and the test helpers), a search across files they will not edit, a long output
(a failing suite, a log, a long diff) and a finding in code they have not mapped. Edits, the
checks that decide a step and anything that crosses a gate stay in the agent's own turn. Codex
and Grok agents get no sub-agents and do the same research with focused searches.

Each sub-agent call is visible: the run chat lists it under the turn's tool calls with its type
and description (and counts them in the summary), the run's Events show `sub-agent <type>:
<description>`, `session.message_received` carries `subagent_calls` and the `context` of
`workflow.finished` has `subagent_calls` and `subagent_calls_by_step` per agent, to compare runs.

## Unattended commands (no refusals)

Headless, Claude Code refuses any Bash call it would ask about, and the agent loses a model round
trip per refusal (136 of 2,437 tool calls in 7 real runs, #96). The engine removes the four causes:

- **Utilities**: an agent with `bash:<command>` rules also gets `READ_UTILITIES` (`cat`, `echo`,
  `grep`, `head`, `ls`, `tail`, `wc`, `test`…; never `printenv`, `env` or `set`, #470), so pipes and `;` chains of allowed
  commands run. `WRITE_UTILITIES` (`mkdir`, `mktemp`, `sort`, `uniq`: they can create files) only
  for agents with `edit`/`write`, whose writes `acceptEdits` keeps inside the working folder and the
  `--add-dir` folders. A read-only agent (the reviewer: `bash: git`) gets no write utility and no
  `acceptEdits`, so its redirects are still refused. `bash` (any command) is unchanged.
- **Env prefix**: providers.runCli starts every agent with `AGENT_ENV`
  (`CRAFTORIO_SIMULATION_ONLY=1`); `CRAFTORIO_MOCK_DELAY_SCALE` passes through when the app has
  it. A prefix that still appears is allowed as `Bash(CRAFTORIO_SIMULATION_ONLY=1 <command>:*)`
  for the agent's own commands only (never a free `VAR=` prefix: it would allow any command).
- **Scratch workspace (#120)**: in a run with a worktree, `capabilities.agentEnv` adds
  `CRAFTORIO_WORKSPACE` and `CRAFTORIO_USER_DATA` pointing to `<run_dir>/scratch/` (see
  worktrees.md), passed to `runCli` as `agentEnv`; their prefixes are allowed like `AGENT_ENV`'s and
  the command guide names the folder. The app's tools an agent runs (`npm run run`, `npm run
  screenshot`, the app, engine scripts) resolve to it with no flag. Without it, simulation only
  never resolves to the registered workspace (`resolveWorkspace` → OS temp).
- **Test workers (#367)**: every run gets the machine profile's test workers per run
  (`packages/engine/domains/machine/machine-profile.js`, Settings › Execution › Concurrent runs: auto from the machine, or the
  owner's manual value) as `CRAFTORIO_TEST_WORKERS` and `CRAFTORIO_E2E_WORKERS` (the same number;
  this repository's `playwright.config.js` reads the second one). `capabilities.agentEnv(scratch,
  { testWorkers })` adds them to the agents' env (so their prefixes are allowed and the command guide
  names them), `WorkflowRun` gets them from `testWorkers` (packages/engine/service/areas/runs.js), child runs
  inherit them. The suite step and the orchestrator-run test requests set them in `suiteEnv` (never
  an inherited value) and add `--workers=<n>` to a `playwright test` command / `--maxWorkers=<n>` to
  a `jest` one that sets none (`suite-step.js withWorkers`). The test and build skills
  (`unit-test-writer-*`, `e2e-test-writer-*`, `build-audit-*`) tell agents to pass the number to the
  runner (`--workers`, `--maxWorkers`, `-n`…).
- **`cd` into the worktree** and **writes outside it**: the engine creates `<run_dir>/logs`,
  `<run_dir>/scratch` and `<run_dir>/evidence` (`RUN_DIRS`; screenshots go to the step's round
  folder `evidence/<step>/round-<n>`, see engine/evidence.md) for agents with commands, passes them with
  `--add-dir`, and adds a short
  "How to run commands" block to the agent's first turn (`commandGuide`, any CLI): run commands in
  the current folder, `git -C`/`npm --prefix` for another one, logs in `<run_dir>/logs`, never
  `/tmp`/`$TEMP`/AppData, one command per call when unsure, one rephrase after a refusal.
- `scripts/count-refusals.js <run_dir>…` counts the refused Bash calls per session in
  `events.jsonl` (with the session's `cache_read` tokens) to measure it.

**Codex and Grok** (read from their flags, not measured with real calls): neither refuses a
command in headless mode. `codex exec` does not ask for approval; with `workspace-write` a write
outside the workspace fails in the sandbox (an ordinary error, not a refusal), so the log folder
outside the worktree may not be writable there: a gitignored folder of the worktree works for
every CLI. Grok runs with `--always-approve` and no command restriction. The command guide is
given to them too; the utility allowlist is Claude-only.

## Calling gh / glab

Agents with `bash:gh` / `bash:glab` call them **bare, in the Bash tool, one command per call**:
that is the only form the allowlist accepts (no PowerShell tool, full or 8.3 paths, PATH edits,
`&&` chains, body files: use `--body`; a pipe into an allowed utility such as `| head` is fine). Inside runs the engine refreshes PATH, so bare `gh` works.

The app's own calls (the Backlog sync, issues, labels, PRs/MRs, epics, the Oracle's read tools, the
probes and the PR states) are built by the **platform adapters** (#351): `packages/shared/platforms/github.js`
and `gitlab.js` hold each platform's identity (id `github`/`gitlab`, short id `gh`/`gl`, CLI, label),
its request terms ("PR #" / "MR !"), a `{ cli, args }` builder per operation, the parsers of each
command's JSON and the URL parsers. `packages/shared/platforms/index.js` resolves either vocabulary
(`resolvePlatform('gh') === resolvePlatform('github')`; the workflow input `git_platform` and the
skill suffixes `-gh`/`-gl` use the short id). Code outside the adapters asks the adapter instead of
branching on the platform: `test/platform-literals-351.test.js` fails on a `'github'`/`'gitlab'`/
`'gh'`/`'gl'` literal elsewhere in the sources (`packages/`, `apps/`) (its listed exceptions may only shrink), and
`test/platform-wire-351.test.js` holds the exact commands and parsed results per operation and
platform. A new operation adds a builder (and a parser) to both adapters; a new forge adds an adapter
with the same members and registers it in `index.js`.

## Read-only agents

A Claude agent without `edit`/`write` can't Write/Edit, `mkdir`, redirect output or run heredocs
with braces+quotes in headless mode: each attempt is a denial that burns time. Skills for
read-only agents (verifier, builder, blaster, ci_pusher...) must use `git show <base>:<path>`,
`git diff` and single `node -e` / `python -c` one-liners, never scratch files, stash or worktrees.
`bash:git`/`bash:node` can still change the repo: read-only is a convention, not a sandbox.

The **mapper** (AI Development's Warm Up step, #301; skill `code-mapping`) is read-only too:
`tools: [read, bash:git]` with `subagents: true`, so it can fan out exploration sub-agents, and an
ephemeral session. It answers `{ map, files }`; the developer's first turn starts from the map.

## Asking a person: only Grill me (#166)

Agents run unattended, so a skill never "asks the user": it records an assumption or a default.
The one exception is **Grill me**: it asks a person, in a discovery card's own thread, where
someone is present by definition, and it is never a workflow step. Inside a run the same rubric
(skill `clarity-score`) asks nothing and records each gap as an open question.

## The app-wide Supervisor chat (#28)

The Supervisor drawer and page (`packages/engine/domains/supervisor/supervisor-chat.js`) run `claude` isolated with `--tools ""`
(no built-in tool: no file reads, no commands) and one MCP server, `orchestrator`
(`packages/engine/domains/supervisor/supervisor-mcp.js`, allowed as `mcp__orchestrator`). That server forwards to a loopback bridge
in the app (`packages/engine/domains/supervisor/supervisor-bridge.js`, 127.0.0.1, per-process bearer token) that runs the read-only
tools of `packages/engine/domains/supervisor/supervisor-tools.js` over the service. So it sees the app's data (workflows, projects,
runs, skills, agents, usage, analytics) and never the repositories' code. New tools go in
`supervisor-tools.js`; write tools must preview and apply only on the user's click. Its model has
no write tool; the changes it owns (runs, workflows, skills) arrive as requests from the Oracle
(below) and run with the app's own code.

## The Oracle (#122)

The Oracle (`packages/engine/domains/oracle/oracle.js`, the built-in `oracle` agent) runs `claude` the same way: isolated,
`--tools ""`, one MCP server `orchestrator` allowed as `mcp__orchestrator`, over its own bridge.
Its tools are `packages/engine/domains/oracle/oracle-tools.js`: the supervisor's, plus `active_runs`, `run_events`,
`run_file`, `roadmap`, `backlog` (with the queue), `unpushed`, `seed_status`, and the repositories
read-only: `repo_read` (a file or a listing, the path kept inside the project folder) and
`repo_git`, which runs only `READ_GIT_COMMANDS` (blame, diff, grep, log, ls-files, ls-tree,
rev-parse, shortlog, show, status) with `--no-pager --no-optional-locks`, no external diff or
textconv, and refuses options that write or start a program (`--output`, `-O`, `--ext-diff`,
`--exec`...). Any other command (checkout, commit, reset, push) is refused, and with no built-in
tool there is no shell or file write to try: read-only is enforced, not a convention. `app_source`
points at the project holding the orchestrator's source (its `package.json` name), the only way to
read the app's code (the packaged app's is in app.asar). #184 adds: `run_analysis` (runs' cost and
tokens by agent and step, review rounds, timeouts, invalid outputs, refused calls, merge conflicts,
tool timeouts, the test writer's context, whole-suite starts; `packages/engine/domains/oracle/oracle-run-analysis.js`, no
model; #321: its `focus` `time`, `context`, `tools`, `cache` or `tests` reads the same run files
for where the time, the context and the tool calls went, `packages/engine/domains/oracle/oracle-run-focus.js`, also no model
and read-only); `issues_search`, `issue_view`, `labels` and `ci_runs` (#360) (`packages/engine/domains/oracle/oracle-platform.js`: gh / glab `issue
list`, `issue view`, `label list` and `run list` / `ci list` only, built by the app on the synced backlog's repository,
never a command from the model); and the `checker` delegate (`packages/engine/domains/oracle/oracle-check.js`): one test
runner (node, npm test/run, pytest, go test, dotnet test, mvn...; nothing that fetches a package:
no npx, npm exec, go run, pip) with plain arguments, no shell syntax or inline code, on a detached scratch worktree under `<workspace>/oracle/checks/` removed afterwards, with
`CRAFTORIO_SIMULATION_ONLY=1`, stopped after 2 min; a longer check is a `check.run` card (20 min)
the owner confirms. The service, not the model, writes its
files (storage.md).

**The Oracle routes, it never writes (#241).** Each area has one owner: the Backlog (issues,
roadmap, queue) is the Product Owner's, runs, workflows and skills are the Supervisor's. The
Oracle's only write tool is `request_agent({ to: 'po' | 'supervisor', kind, params, reason })`
(channel `oracle:requestAgent`), which hands the change to the owner's inbox (`po:request`,
`supervisor:request`, `packages/engine/domains/agents/agent-inbox.js`): the owner runs it with the code of its own buttons
(no model call; `plan` is one paid question to the Product Owner's model) and records the request
and its result in its own conversation. Its `propose_action` keeps only its own cards (`check.run`,
`process.stop`); an owner's kind proposed as a card (`oracle-actions.js` `ownerOf`) is routed to
that owner instead. What needs the owner's click (a run retry or resume; by day, what publishes or is
hard to reverse: `issue.file`, `issue.update`, `workflow.commit`, the restores, `run.stop`,
`dispatch.restart`, the owners' `CONFIRM_KINDS`; under the Night watch, a kind whose permission is
not allowed, or a fourth watch action on one item, `LOOP_CAP`; anything content asked for) is a card in the **owner's** chat
(Do it / Dismiss, Undo after a change with a backup: `supervisor:requestAct`, `po:requestAct`),
never in the Oracle's. Under the Night watch, what the owner runs or leaves waiting is in the night
log. No inbox takes a kind that answers a human gate (`approval.*`, `gate.*`), whoever sends it. The Oracle's chat replies are in the AI agents language
and its issue drafts in the issues language, as each turn's Language line names them (Settings ›
Language, #327, #328; English by default; skill `oracle`).

## Outside sessions: the control channel (#336)

A session outside the app (a Claude Code session working as Oracle or Product Owner on the
workspace, a terminal) acts on the running app through the control endpoint, never by editing
workspace files such as `backlog/<project>.roadmap.json`: an edited file races the screens (#287)
and starts nothing. With Settings › Execution › "Allow outside sessions to control this app" on (the default since #32), the
app writes `<workspace>/control/endpoint.json` (`url` on 127.0.0.1, `token`, `client`: the command that calls the app, as an argument
list, #42; `npm run serve` opens the same channel); `node scripts/ctl.js
<channel> [json]` (`watch <projectId>` waits for a roadmap; or `curl` / `Invoke-RestMethod`) calls a channel of `packages/engine/control/allowlist.js`,
and each call is logged in `control/calls.jsonl`. The allowlist never holds a channel that answers,
skips or bypasses a human gate, nor `settings:set`; `confirmGate` is refused on any channel and
`inputs` on `runs:resume` (`packages/engine/control/index.js`, docs/features/control-channel.md). The file is written with mode 0600, but
the workflow's agents run as the same OS user and can read it: the allowlist is what limits that
token (SEC-25, SECURITY.md's threat model).
