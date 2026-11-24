# Craftorio

## Set it up with an AI session

Paste this in Claude Code or Codex (you need access to this repository):

```
Install Craftorio following INSTALL.md of https://github.com/eduardogalbiati/craftorio
```

It installs the app (the executable, or from the source code: you choose), creates the workspace folder and tells you the last step: open a session in that folder,
which then works as the **Oracle** and manages the app for you, also from the phone. The steps it follows:
[INSTALL.md](INSTALL.md).

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).
