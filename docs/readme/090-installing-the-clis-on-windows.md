## Installing the CLIs on Windows

Claude Code (native installer, PowerShell):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Codex CLI:

```bash
npm install -g @openai/codex
```

Grok Build: install it from x.ai (it lands in `%USERPROFILE%\.grok\bin`, which must be on the PATH).

Then log in once to each, interactively (`claude`, `codex login` and `grok login`).
The app shows in Settings whether it found each command on the PATH.

### macOS and Linux

The app looks for each CLI as an executable file on the PATH plus `~/.local/bin`, `~/.grok/bin`,
`~/.npm-global/bin`, npm's global prefix (`prefix` in `~/.npmrc`), `/opt/homebrew/bin` and
`/usr/local/bin`. An app opened from Finder or the Dock gets a minimal PATH, so once per launch
the app also asks your login shell (`$SHELL -ilc`, 3 s at most) for its PATH and puts it first.
A CLI found nowhere shows as not installed, with its install hint (Homebrew on macOS, the distro
package or the official script on Linux). Claude Code's `CLAUDE_CONFIG_DIR` and Codex's
`CODEX_HOME` are honoured for sessions, usage and folder trust.
