# Environment

Read this when installing dependencies, upgrading Node/Electron, calling the CLIs, or working with
the workspace folder.

- Node **24** (`engines`, `.nvmrc`), npm 11. **npm 11 runs install scripts only for packages in
  `allowScripts`** (package.json): `node-pty@1.1.0` is approved. After upgrading it, run
  `npm approve-scripts node-pty`.
- Electron **44.4.5** (bundles Node 24.21). Electron 44 has no postinstall: its binary downloads on
  first use (`node node_modules/electron/install.js` to force it).
- Installed CLIs: `claude` (~/.local/bin), `codex` (WinGet), `grok` (~/.grok/bin), `gh` in
  `C:\Program Files\GitHub CLI\gh.exe`, `glab` optional. Inside runs the engine refreshes PATH
  (`refreshWindowsPath`), so agents call bare `gh`/`glab` (see [capabilities.md](capabilities.md)).
  A shell opened outside the app may still lack it on PATH.
- Workspace: `%USERPROFILE%\multiagent-workspace` (registry `HKCU\Software\MultiagentOrchestrator\WorkspacePath`,
  overridable with `MULTIAGENT_WORKSPACE`). Layout: `runs/`, `repos/` (git checkouts, `<owner>-<repo>`),
  `worktrees/` (one git worktree per run, `<run_id>`), `backlog/` (issue sync per project), `projects/` (`<id>.json`),
  `skills/`, `agents/` (`<id>.json`), `settings.json`. The owner's project `multiagent-orchestrator`
  points at `repos/eduardogalbiati-multiagent-orchestrator` (SSH remote; the repo is private).
- The owner uses **subscription plans** (Claude, ChatGPT free for Codex, SuperGrok), not API keys.
