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
      subagents: false       # the CLI's own sub-agents, e.g. Claude's Task (default false)
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
| Commands | allowlist per command | **not enforceable** (the sandbox limits writes, not which command runs) | not restricted |
| Web | `WebSearch`/`WebFetch` offered only with `web: true` | `-c web_search="disabled"` unless `web: true` | `--disable-web-search` unless `web: true` |
| Sub-agents | `Task` only with `subagents: true` | n/a | `--no-subagents` unless `subagents: true` |
| MCP | `--mcp-config` with the declared servers + `mcp__<name>` allowed | declared servers only | not passed (noted in the log) |
| Test files (`edits_tests: false`) | `--disallowedTools "Edit(<glob>) …"` over `tests_paths` (a bare name gets `**/`); Bash can still write them | not refused (noted) | not refused (noted) |

Whatever the CLI, the engine checks the turn's changes afterwards and sends a turn that touched
test files back (see `edits_tests` in [engine.md](engine.md)). The `Edit(...)` deny rules were
not tried against a real Claude CLI yet (real calls cost money): if one is refused, the engine
check still holds.

`--bare` would isolate Claude further but only accepts API keys (no OAuth/subscription), so it is
not used. Measured on this repo (first request of a Claude agent, Haiku, "reply OK"): **41.1k
tokens with the user's setup → 22.0k isolated with the developer's capabilities**.

## Calling gh / glab

Agents with `bash:gh` / `bash:glab` call them **bare, in the Bash tool, one command per call**:
that is the only form the allowlist accepts (no PowerShell tool, full or 8.3 paths, PATH edits,
`;`/`&&`/pipes, body files: use `--body`). Inside runs the engine refreshes PATH, so bare `gh` works.

## Read-only agents

A Claude agent without `edit`/`write` can't Write/Edit, `mkdir`, redirect output or run heredocs
with braces+quotes in headless mode: each attempt is a denial that burns time. Skills for
read-only agents (verifier, builder, blaster, ci_pusher...) must use `git show <base>:<path>`,
`git diff` and single `node -e` / `python -c` one-liners, never scratch files, stash or worktrees.
`bash:git`/`bash:node` can still change the repo: read-only is a convention, not a sandbox.
