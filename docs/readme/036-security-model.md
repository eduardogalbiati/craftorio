## Security model

What the app limits, and what it does not. Read it before you run a repository you did not write;
how to report a vulnerability is in [SECURITY.md](SECURITY.md).

- **Agents run as you.** An agent turn is a headless CLI (`claude -p`, `codex exec`, `grok`) started
  with your user, your environment, your credentials and your network; the allowlisted environment
  (see "Account and privacy") keeps cloud keys, API keys and the SSH agent out, nothing more.
- **The engine shapes what the CLI offers the model; only Codex's sandbox is enforced by the OS.**
  For Claude (`acceptEdits` and `--allowedTools`) and Grok (`--always-approve`) the tool limits are
  prefix rules: `bash:git` becomes `Bash(git:*)`, and an allowed program steps around it
  (`git -c alias.x='!cmd' x`, `npm exec` / `npm run <script>`, `node -e`, a `cargo` build script, a
  `cat` of any file). A read-only agent is a convention, not a sandbox.
- **The repository can add instructions.** `CLAUDE.md`, `AGENTS.md`, the README, the issues and the
  PR comments an agent reads can try to steer it, with the tools its workflow gives it. Isolated
  agents never load the checkout's `.claude/settings*.json`, but treat a repository's hooks as code
  that may run until #468 is closed.
- **Workflows, skills and seeds are code**: a workflow runs shell commands and templates in the
  app's process, a skill or a seed tells agents with tools what to do. In short, workflows, skills
  and seeds are code: install only ones you trust.
- **The serve token is full control of the machine** (`npm run serve`): a shell, gate approval and
  paid runs. Keep it like a password.
- **The control endpoint file is readable by agents.** `<workspace>/control/endpoint.json` holds the
  token of the loopback control channel; the agents run as you and can read it. Its allowlist
  (`packages/engine/control/allowlist.js`) never resolves a human gate and never changes settings.
  The control channel is on by default (#32); turn it off in Settings › Execution › *Allow outside
  sessions to control this app*.

Recommendation: run untrusted repositories only in a VM, a container or with Codex's sandbox
(`workspace-write`), and assume every secret in the agents' environment is readable by them (see
#470 for what is filtered).
