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

Every program the app starts (the Install and Sign in terminals, Sessions, shells, the supervisor
chat, agent turns and what they run, such as an agent's `gh`) gets those extra folders on its
PATH too, after your own PATH and only the ones that exist, checked again on each launch: a CLI
that Install puts in `~/.local/bin` signs in right away, without restarting the app. On Windows
the same holds for `~\.local\bin` and `%APPDATA%\npm`.

On macOS the one-click installs of `gh`, `git`, `glab` and `whisper-cli` use Homebrew, and Setup
offers them only when it finds `brew`. Without Homebrew (https://brew.sh), Setup says so and
shows the alternative: the GitHub CLI's macOS installer from https://cli.github.com, the GitLab
CLI from its releases page (https://gitlab.com/gitlab-org/cli/-/releases), and git through
`xcode-select --install` (Apple's Command Line Tools); `whisper-cli` needs Homebrew.
