# Craftorio

## Set it up with an AI session

**Recommended: the app.** Paste this in Claude Code or Codex:

```
Install the Craftorio app (the executable) following https://github.com/eduardogalbiati/craftorio/blob/main/INSTALL.md
```

**For developers: from the source code.**

```
Clone https://github.com/eduardogalbiati/craftorio and install Craftorio from the source code following its INSTALL.md
```

It downloads the app (or builds it from the code), checks it, creates the workspace folder and tells you the last step: open a session in that folder,
which then works as the **Oracle** and manages the app for you, also from the phone. The steps it follows:
[INSTALL.md](INSTALL.md).

Electron app that runs multi-agent workflows defined in YAML (`<workspace>/workflows/`), opening
**Claude Code**, **Codex CLI** and **Grok Build** sessions and recording the observability of each session
(open/active time, tokens, cost, prompts, thinking, tool calls, output).
