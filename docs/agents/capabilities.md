# Agent capabilities and isolation

Read this before changing an agent's tools in a workflow, `src/engine/capabilities.js`, or a
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
    isolation: true          # default; false = the user's own CLI setup is loaded too
steps:
  - id: publish
    agent: developer
    capabilities: { web: true }   # merged key by key over the agent's, for this step only
```

`loadWorkflow` rejects unknown keys, tools, non-boolean `web`/`subagents` and MCP names missing from
`mcp_servers`. `cli_args` still apply on top (for anything the vocabulary doesn't cover); a bare
flag is never passed twice (`dedupeFlags`, clap-based CLIs refuse repeats). `permissions:` is gone
from the bundled workflows: it was documentation only. The run log gets one
`log` `kind: capabilities` line per agent with what was granted and what this CLI can't enforce.

## Per CLI (verified with Claude Code 2.1.283, Codex CLI 0.157, Grok Build 1.0.41)

| | Claude Code | Codex CLI | Grok Build |
|---|---|---|---|
| Isolation | `--strict-mcp-config` (only `--mcp-config`), `--no-chrome`, `--setting-sources project,local` (no user settings: plugins, hooks, permission rules), `--disable-slash-commands` (no skill listing; the engine injects the workflow's skills), `--settings {"autoMemoryEnabled":false}` | `-c mcp_servers={…declared}`, `--disable plugins apps browser_use computer_use in_app_browser image_generation memories` | none from the command line: user MCP servers, skills and memory still load (`grok inspect` shows them) |
| Tools | `--tools` (only these built-ins are offered: fewer definitions in context) + `--allowedTools` (`Bash(git:*)` per `bash:git`) | `-s read-only`, or `workspace-write` when `edit`/`write` | read-only sets: `--tools read_file,list_dir,grep[,web_search,web_fetch]` |
| Writes | `--permission-mode acceptEdits` with `edit`/`write` | workspace-write sandbox (no network for commands) | not restricted (`--always-approve`) |
| Commands | allowlist per command (`Bash(npm:*)`), plus the same with the `AGENT_ENV` prefix and the shell utilities (below); `--add-dir <run_dir>/evidence`, `<run_dir>/logs` and `<run_dir>/scratch` | **not enforceable** (the sandbox limits writes, not which command runs) | not restricted |
| Web | `WebSearch`/`WebFetch` offered only with `web: true` | `-c web_search="disabled"` unless `web: true` | `--disable-web-search` unless `web: true` |
| Sub-agents | `Agent` and `Task` (the tool's current and older name; `--tools` drops names the CLI doesn't know) only with `subagents: true`; the `capabilities:` log line says `subagents: Agent/Task tool offered` | n/a (the log line says `subagents: not offered by Codex`) | `--no-subagents` unless `subagents: true` |
| MCP | `--mcp-config` with the declared servers + `mcp__<name>` allowed | declared servers only | not passed (noted in the log) |
| Test files (`edits_tests: false`) | `--disallowedTools "Edit(<glob>) …"` over `tests_paths` (a bare name gets `**/`); Bash can still write them | not refused (noted) | not refused (noted) |

Whatever the CLI, the engine checks the turn's changes afterwards and sends a turn that touched
test files back (see `edits_tests` in [engine.md](engine.md)). The `Edit(...)` deny rules were
not tried against a real Claude CLI yet (real calls cost money): if one is refused, the engine
check still holds.

`--bare` would isolate Claude further but only accepts API keys (no OAuth/subscription), so it is
not used. Measured on this repo (first request of a Claude agent, Haiku, "reply OK"): **41.1k
tokens with the user's setup → 22.0k isolated with the developer's capabilities**.

## Unattended commands (no refusals)

Headless, Claude Code refuses any Bash call it would ask about, and the agent loses a model round
trip per refusal (136 of 2,437 tool calls in 7 real runs, #96). The engine removes the four causes:

- **Utilities**: an agent with `bash:<command>` rules also gets `READ_UTILITIES` (`cat`, `echo`,
  `grep`, `head`, `ls`, `tail`, `wc`, `printenv`, `test`…), so pipes and `;` chains of allowed
  commands run. `WRITE_UTILITIES` (`mkdir`, `mktemp`, `sort`, `uniq`: they can create files) only
  for agents with `edit`/`write`, whose writes `acceptEdits` keeps inside the working folder and the
  `--add-dir` folders. A read-only agent (the reviewer: `bash: git`) gets no write utility and no
  `acceptEdits`, so its redirects are still refused. `bash` (any command) is unchanged.
- **Env prefix**: providers.runCli starts every agent with `AGENT_ENV`
  (`MULTIAGENT_SIMULATION_ONLY=1`); `MULTIAGENT_MOCK_DELAY_SCALE` passes through when the app has
  it. A prefix that still appears is allowed as `Bash(MULTIAGENT_SIMULATION_ONLY=1 <command>:*)`
  for the agent's own commands only (never a free `VAR=` prefix: it would allow any command).
- **Scratch workspace (#120)**: in a run with a worktree, `capabilities.agentEnv` adds
  `MULTIAGENT_WORKSPACE` and `MULTIAGENT_USER_DATA` pointing to `<run_dir>/scratch/` (see
  worktrees.md), passed to `runCli` as `agentEnv`; their prefixes are allowed like `AGENT_ENV`'s and
  the command guide names the folder. The app's tools an agent runs (`npm run run`, `npm run
  screenshot`, the app, engine scripts) resolve to it with no flag. Without it, simulation only
  never resolves to the registered workspace (`resolveWorkspace` → OS temp).
- **`cd` into the worktree** and **writes outside it**: the engine creates `<run_dir>/logs`,
  `<run_dir>/scratch` and `<run_dir>/evidence` (`RUN_DIRS`; screenshots go to the step's round
  folder `evidence/<step>/round-<n>`, see engine.md) for agents with commands, passes them with
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

## Read-only agents

A Claude agent without `edit`/`write` can't Write/Edit, `mkdir`, redirect output or run heredocs
with braces+quotes in headless mode: each attempt is a denial that burns time. Skills for
read-only agents (verifier, builder, blaster, ci_pusher...) must use `git show <base>:<path>`,
`git diff` and single `node -e` / `python -c` one-liners, never scratch files, stash or worktrees.
`bash:git`/`bash:node` can still change the repo: read-only is a convention, not a sandbox.

## The app-wide Supervisor chat (#28)

The Supervisor drawer and page (`src/supervisor-chat.js`) run `claude` isolated with `--tools ""`
(no built-in tool: no file reads, no commands) and one MCP server, `orchestrator`
(`src/supervisor-mcp.js`, allowed as `mcp__orchestrator`). That server forwards to a loopback bridge
in the app (`src/supervisor-bridge.js`, 127.0.0.1, per-process bearer token) that runs the read-only
tools of `src/supervisor-tools.js` over the service. So it sees the app's data (workflows, projects,
runs, skills, agents, usage, analytics) and never the repositories' code. New tools go in
`supervisor-tools.js`; write tools must preview and apply only on the user's click.
