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

### Session modes and handoff notes

```yaml
defaults:
  max_context: 150k        # persistent agents: a fresh session once a turn ends above this
agents:
  developer:
    session: handoff       # persistent (default) | ephemeral | handoff
```

- `persistent`: one conversation for the whole run. With `max_context`, a turn that ends above it
  (its largest request) makes the next turn start a fresh session from the agent's handoff note;
  a turn is never cut in the middle.
- `ephemeral`: a fresh session per turn with only the step prompt.
- `handoff`: a fresh session per turn that gets the system prompt, the skills, the agent's latest
  handoff note and the new request. The code itself is in git, so the note stays short.
- **Handoff notes**: persistent and handoff agents end each turn with a ```` ```handoff ```` block
  (goal, branch and commits, done, left, decisions and why, key files, known problems). The engine
  takes it out of the answer and saves it as `runs/<id>/handoffs/<step>-v<visit>-<agent>.md`; it
  shows in the run chat (under the answer) and in Artifacts. When a turn that needs one forgets it,
  one short follow-up in the same conversation asks only for the note. The supervisor reads the
  notes instead of full transcripts, and a resumed run starts its agents from them.
- Works the same for Claude Code, Codex and Grok (a fresh session = no `--resume`). The context size
  per request comes from Claude's and Grok's streams; Codex doesn't report it, so `max_context` does
  not rotate Codex agents (use `handoff` for them).

### Agent capabilities and isolation

What an agent may use is declared per agent (and per step when needed); the engine turns it into
each CLI's own flags. This is context economy (fewer tools offered, a smaller prompt), not a
security boundary: only Codex's sandbox is enforced by the OS (see "Security model"):

```yaml
agents:
  ci_pusher:
    capabilities:
      tools: [read, bash:git, bash:gh, bash:glab]   # also edit, write, bash (any command)
      web: false            # web search / fetch
      mcp: []               # MCP servers from the workflow's mcp_servers, none by default
      subagents: false      # the CLI's own sub-agents
steps:
  - id: research
    agent: ci_pusher
    capabilities: { web: true }   # this step only, merged over the agent's
```

- **Isolated by default**: agents run the user's CLIs headless, but without the user's personal
  setup: no MCP servers (e.g. a logged-in browser), plugins, user settings, CLI skill listings or
  auto-memory; only the project and what the workflow declares. `isolation: false` on an agent (or
  in `defaults`) turns it off. Claude Code drops the user's setup (the agent still runs as you);
Codex drops the user's MCP servers,
  plugins, apps, browser/computer use and memories; Grok has no flags for it (only its tools are
  restricted). What a CLI can't enforce is written to the run log.
- **Fewer tool definitions**: tools an agent can't use aren't offered at all (Claude `--tools`), which
  shrinks every request. Measured on a Claude agent's first request: 41.1k tokens with the user's
  setup, 22.0k isolated with the developer's capabilities.
- Per CLI: Claude gets `--tools` / `--allowedTools` (`bash:git` → `Bash(git:*)`) and `acceptEdits`
  when it may edit; Codex gets a `read-only` or `workspace-write` sandbox (it can't restrict which
  commands run) and web search off; Grok gets a read-only tool list, `--disable-web-search` and
  `--no-subagents`.
- `loadWorkflow` validates capabilities; the Workflows screen shows each agent's session mode and
  capabilities. `cli_args` still work for anything else; `permissions:` (documentation only) is gone.
- Agents with `bash:gh` / `bash:glab` call them bare, in the Bash tool, one command per call (the
  only form the allowlist accepts); the engine refreshes PATH so that works inside runs.

**Terminals** (Run view session detail and Project view, for any run, including past ones):
- They open in an **embedded terminal dock** at the bottom of the app, with tabs (xterm.js). The
  **↗** button next to each opens the same thing in an external console window instead (Windows).
- **Live terminal** follows a session as it runs: prompts, thinking, text, tool calls, results and
  usage. For the **orchestrator** it follows the whole run: steps, transitions, sessions,
  approvals, actions and logs. It is read by the app itself (`src/domains/session/session-tail.js`), no child process.
- **Open in CLI** runs the provider's interactive CLI resuming the same conversation in the
  session's folder (`claude --resume <id>`, `codex resume <id>`, `grok --resume <id>`) in a real
  pseudoterminal (node-pty: ConPTY on Windows, forkpty on macOS/Linux; `src/domains/machine/terminals.js`). Only
  between turns; whatever you send there becomes part of the agent's conversation for its next turn.
- Keys: **Ctrl+C** copies when text is selected, otherwise interrupts; **Ctrl+V** / Shift+Insert
  paste; Ctrl+Shift+C always copies; right-click copies the selection or pastes. On macOS, Cmd
  instead of Ctrl.
- node-pty ships prebuilt binaries for Windows and macOS; on Linux `npm install` compiles it
  (needs python3, make and a C++ compiler). The package keeps it outside app.asar.
