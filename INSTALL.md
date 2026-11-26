# Install Craftorio (for an AI session)

You are Claude Code, Codex or another AI session, and the user asked you to install Craftorio. Follow the steps in order.
Answer in the user's language. Ask before each change to the computer marked **ask**. Report an error as it is:
never turn off a check, use `sudo` or force a flag to get past it. Never type a password, token or key, and never
accept a workflow, a trust prompt or a system's security warning: those are the user's.

A step already done is not done again: look first, then say what you found.

The repository is public: reading this guide from its web page is enough. The app (A) needs no clone; only the source
code (B) is cloned.

## 1. Choose how to install

When the user's request already says which (the app, the executable, or the source code), take it. Otherwise
**ask**, and recommend B while the app's builds are not signed (Windows and macOS warn when A first opens); A suits
whoever does not want Git and Node.js.

| | A. The app (executable) | B. The source code |
|---|---|---|
| For | using Craftorio, without Git or Node.js (not signed yet: a warning at the first start) | using or contributing (recommended for now), or running what is on `main` |
| Needs Git, Node.js and npm | no | yes |
| How to update | download the next release | update the code |

A takes the latest published release, https://github.com/eduardogalbiati/craftorio/releases/latest (or
`gh release view --repo eduardogalbiati/craftorio`). Say its version. If there is none, say so and offer B. Never take
the executable from anywhere else, an older repository included.

## 2. Check the computer

| Needed | For | How to check |
|---|---|---|
| Claude Code, 2.1.277 or newer | both | `claude --version` |
| Git | B (the app's projects need it too, later) | `git --version` |
| Node.js 24 or newer | B | `node --version` |

Optional: Codex CLI (`codex --version`) for the workflows that use it; GitHub CLI or GitLab CLI for issues and pull
requests.

List what is missing with its official install page, and **ask** before installing anything.

## 3A. Get the app

**Ask** where to put it, and **ask** before downloading, with the file's name, its size and the release:

| System | File |
|---|---|
| Windows (x64) | `Craftorio-win32-x64.zip` |
| macOS, Apple Silicon | `Craftorio-darwin-arm64.zip` |
| macOS, Intel | `Craftorio-darwin-x64.zip` |
| Linux (x64) | `Craftorio-linux-x64.AppImage` (or `Craftorio-linux-x64.tar.gz`) |

Download the file and `SHA256SUMS` into a new empty folder, from the latest release:

- Windows (PowerShell): `Invoke-WebRequest -Uri https://github.com/eduardogalbiati/craftorio/releases/latest/download/<file> -OutFile "<folder>\<file>"`, then the same for
  `SHA256SUMS`
- macOS and Linux: `curl -fL -o "<folder>/<file>" https://github.com/eduardogalbiati/craftorio/releases/latest/download/<file>`, then the same for `SHA256SUMS`
- With the GitHub CLI: `gh release download --repo eduardogalbiati/craftorio --pattern "<file>" --pattern SHA256SUMS --dir "<folder>"`

**Check it before opening it.** Compute the file's SHA-256 and compare it with its line in `SHA256SUMS`:

- Windows (PowerShell): `(Get-FileHash -Algorithm SHA256 "<file>").Hash`
- macOS: `shasum -a 256 "<file>"`
- Linux: `sha256sum "<file>"`

If it differs, stop: do not open it. The sum shows that the download is whole; that it comes from this repository is
the `cosign` check in the README, "Install": offer it when `cosign` is there.

Then unzip it in the chosen folder. On macOS, move `Craftorio.app` to Applications; on Linux,
`chmod +x` the AppImage. An update replaces the app's files only, with the app closed: the workspace is another
folder and stays.

## 3B. Get the code

**Ask** where to put it. If the folder already has Craftorio, use it as it is: do not pull, reset or switch
branches without asking.

```
git clone https://github.com/eduardogalbiati/craftorio.git <folder>
cd <folder>
npm install
```

## 4. The workspace

The workspace is a folder of its own, outside the app and the code, where the app keeps projects, runs and settings.
Look for one that exists. The app opens the first of these whose folder is there:

1. The registered one. Windows: `reg query HKCU\Software\Craftorio /v WorkspacePath`, then the same with
   `HKCU\Software\MultiagentOrchestrator`. macOS and Linux: `~/.craftorio.json`, then `~/.multiagent-orchestrator.json`.
2. `craftorio-workspace` in the user's home folder.
3. `multiagent-workspace` in the user's home folder (an install from before the name Craftorio).

**None exists**: **ask** to create `craftorio-workspace` in the home folder. Create only that empty folder: the app
adopts it without a question. For another place, create nothing: the app asks at its first start, and the user
chooses.

**One exists**: **ask**, always, even one of an app by another name. Once opened, the app shows all it holds (projects,
runs, a paused roadmap) and updates its workflows, skills and seeds. Say its path, what points to it and the names in
its `projects` folder, and offer both:

| | Start clean | Keep it |
|---|---|---|
| The app opens | empty, at the Setup | with that workspace's projects, runs and settings |
| That workspace | stays as it is: the app does not open it | the app changes it: offer a copy of the folder first |

Recommend starting clean, unless the user is updating a Craftorio they use. To start clean, with the app closed:

1. Create an empty folder: `craftorio-workspace` in the home folder or, if that one exists, another the user names.
2. Register its full path: the registered one comes before every other. macOS and Linux: write
   `{ "workspace": "<workspace>" }` to `~/.craftorio.json`. Windows (`/f` only answers reg's question about replacing
   the value): `reg add HKCU\Software\Craftorio /v WorkspacePath /t REG_SZ /d "<workspace>" /f`.

Never delete, move or empty the old workspace, and leave `HKCU\Software\MultiagentOrchestrator` and
`~/.multiagent-orchestrator.json` as they are: the older app may still use them. If the app is already open in the wrong
one, the user changes it in Settings › General › Workspace folder › **Change…**, to an empty folder.

## 5. Open the app

**First, the engine: this computer, unless the user says otherwise.** The app keeps where its engine runs outside the
workspace, in `engine-connection.json` of its data folder, `craftorio`, in `%APPDATA%` (Windows),
`~/Library/Application Support` (macOS) or `~/.config` (Linux). On the first start it copies there the folder of an
install from before the name Craftorio, `multiagent-orchestrator`, next to it: the sign-in and the engine included. An
old install that used a remote engine makes the new app its client, which opens no workspace here, so step 6 gets no
answer. Look before the start, at `mode` and `address` only (never show the `token`):

- **`craftorio` has the file**: `local` is right. With `remote`, **ask**: this computer (recommended) or that engine.
  For this computer do not edit the file: the user picks **Use this computer** on the page the app opens with, or
  Settings › Execution › Engine › **Change…**.
- **Only `multiagent-orchestrator` is there**: if the user starts clean (step 4), or if its `mode` is `remote` and the
  user, whom you **ask**, wants this computer (recommended), create the folder `craftorio` with only that file,
  `{ "mode": "local", "address": "" }`. The app then copies nothing and the user signs in again. If not, create nothing.
- **Neither**: the engine is this computer. Create nothing.

Never change or delete `multiagent-orchestrator`. If the user keeps a remote engine, this computer has no workspace of
its own: say that steps 6 to 8 do not apply here, and stop after opening the app.

Start it **detached from this session**, or it closes when the session ends:

| | Command |
|---|---|
| A, Windows (PowerShell) | `Start-Process "<folder>\Craftorio.exe"` |
| A, macOS | `open /Applications/Craftorio.app` |
| A, Linux | `setsid nohup "<folder>/Craftorio-linux-x64.AppImage" > /tmp/craftorio.log 2>&1 < /dev/null &` |
| B, Windows (PowerShell) | `Start-Process npm.cmd -ArgumentList start -WorkingDirectory "<code folder>" -WindowStyle Hidden` |
| B, macOS | `cd "<code folder>" && nohup npm start > /tmp/craftorio.log 2>&1 < /dev/null &` |
| B, Linux | `cd "<code folder>" && setsid nohup npm start > /tmp/craftorio.log 2>&1 < /dev/null &` |

The first `npm start` downloads Electron and takes longer. A warning about WebGL or DBus does not stop the app.

Tell the user what is theirs, on the screen:

- **A, the first time**: the builds are not signed yet, so the system warns once. Say where it is, and let the user
  decide: Windows, **More info** › **Run anyway**; macOS, **System Settings › Privacy & Security** › **Open
  Anyway**. Do not remove the quarantine or turn off SmartScreen for them. If the AppImage does not start, say what
  the README, "Install", offers for it.
- **The Setup**: signing in to each CLI, from the app's buttons or by running `claude`, `codex login` and
  `gh auth login` themselves, and the trust prompts. **Skip** leaves the Setup.

## 6. Check that the app answers

Wait for `<workspace>/control/endpoint.json` (up to 2 minutes, more while the user is at a warning). Its `client` is the
command that calls the app, as a list of arguments, for A and for B. In Codex, a call refused with "Operation not
permitted" is its sandbox, not the app: ask the user to allow it. Make one read call with it:

```
<client...> projects:list --workspace "<workspace>"
```

An answer, even an empty list, means it works. Without one, say which of these it is and stop: the app did not open
(show its output), the window is waiting for the user, the app is a client of a remote engine (step 5; its output says
`Engine: remote`), or Settings › Execution › "Allow outside sessions to control this app" is off. If there is no
`client`, the app is older than this guide. Never show the token of `endpoint.json`.

## 7. Hand over: a session needs the workspace folder

The installation ends here, but **nobody manages the app yet**. A session does that, as the Oracle, when it has the
workspace folder. Show this to the user, with the real full path in place of `<workspace>`, and the commands for
the CLI and the system they are using:

> **Craftorio is installed. One step left, and it is yours: give a session the workspace folder.**
>
> **Recommended: open a new session in the folder** `<workspace>`. It reads the folder's `AGENTS.md` and is the Oracle
> from the first message.
>
> **Or add the folder** `<workspace>` **to this session**, and tell me when it is done. I then read its `AGENTS.md`
> and continue as the Oracle here.
>
> From the phone: open the session in that folder with Remote Control (Claude Code only).

For the new session:

| Where | How |
|---|---|
| Claude desktop app | a new Code session, with `<workspace>` as its folder |
| Claude Code in a terminal | `cd "<workspace>"`, then `claude` |
| Claude Code, also from the phone | `cd "<workspace>"`, then `claude --remote-control` |
| Codex in a terminal | `codex --cd "<workspace>" -c sandbox_workspace_write.network_access=true` |

Codex's sandbox blocks the network by default, the app on this computer included: without that option the Oracle cannot
call the app, or the user is asked to allow each call. Say so. It opens the network to the commands Codex runs in that
session, so it is the user's choice.

To add the folder to this session: in Claude Code the user types `/add-dir <workspace>`; if you have a tool that asks the
user for a folder, use it. Codex takes it only when it starts (`--add-dir`): recommend the new session.

If the user adds it here, **read `<workspace>/AGENTS.md` before anything else** (adding a folder does not load it) and
say that you are the Oracle now, not before. If the file is not there, the app is older than this guide: say so and
stop.

## 8. First step as the Oracle

Offer to import a project, and to try a first run in simulation, which is free. Start nothing until the user
chooses.
