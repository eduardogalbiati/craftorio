# Install Craftorio (for an AI session)

You are Claude Code, Codex or another AI session, and the user asked you to install Craftorio. Follow the steps in order.
Answer in the user's language. Ask before each change to the computer marked **ask**. Report an error as it is:
never turn off a check, use `sudo` or force a flag to get past it. Never type a password, token or key, and never
accept a workflow, a trust prompt or a system's security warning: those are the user's.

A step already done is not done again: look first, then say what you found.

## 1. Choose how to install

**Ask** which one, unless the user already said it:

| | A. The app (executable) | B. The source code |
|---|---|---|
| For | using Craftorio | contributing, or running what is on `main` |
| Needs Node.js and npm | no | yes |
| How to update | download the next release | update the code |

A needs a published release:

```
gh release view --repo eduardogalbiati/craftorio
```

"Release not found" with access to the repository means that there is none yet: say so and offer B. Never take the
executable from anywhere else, an older repository included.

## 2. Check the computer

| Needed | For | How to check |
|---|---|---|
| Git | both | `git --version` |
| Claude Code, 2.1.277 or newer | both | `claude --version` |
| Access to the repository | both | `git ls-remote https://github.com/eduardogalbiati/craftorio.git HEAD` |
| GitHub CLI, signed in | A, to download (or the user downloads in the browser) | `gh auth status` |
| Node.js 24 or newer | B | `node --version` |

Optional: Codex CLI (`codex --version`) for the workflows that use it; GitHub CLI or GitLab CLI for issues and pull
requests.

List what is missing with its official install page, and **ask** before installing anything. The repository may be
private: if access is refused, the user needs to be given it by the owner, and to sign in. Stop here until it
answers.

## 3A. Get the app

**Ask** where to put it, and **ask** before downloading, with the file's name, its size and the release:

| System | File |
|---|---|
| Windows (x64) | `Craftorio-win32-x64.zip` |
| macOS, Apple Silicon | `Craftorio-darwin-arm64.zip` |
| macOS, Intel | `Craftorio-darwin-x64.zip` |
| Linux (x64) | `Craftorio-linux-x64.AppImage` (or `Craftorio-linux-x64.tar.gz`) |

```
gh release download --repo eduardogalbiati/craftorio --pattern "<file>" --pattern SHA256SUMS --dir "<new empty folder>"
```

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
Look for one that exists, in this order, and keep the first you find:

1. The registered one. Windows: `reg query HKCU\Software\Craftorio /v WorkspacePath`, then the same with
   `HKCU\Software\MultiagentOrchestrator`. macOS and Linux: `~/.craftorio.json`, then `~/.multiagent-orchestrator.json`.
2. `craftorio-workspace` in the user's home folder.
3. `multiagent-workspace` in the user's home folder (an install from before the name Craftorio).

If none exists, **ask** to create `craftorio-workspace` in the home folder. Create only that empty folder: the
app adopts it without a question. If one of the others exists, do not create it, or the app would open the new
one instead. For another place, create nothing: the app asks at its first start, and the user chooses.

## 5. Open the app

Start it in the background:

| | Command |
|---|---|
| A, Windows (PowerShell) | `Start-Process "<folder>\Craftorio.exe"` |
| A, macOS | `open /Applications/Craftorio.app` |
| A, Linux | `"<folder>/Craftorio-linux-x64.AppImage"` |
| B | `npm start`, in the code's folder |

Tell the user what is theirs, on the screen:

- **A, the first time**: the builds are not signed yet, so the system warns once. Say where it is, and let the user
  decide: Windows, **More info** › **Run anyway**; macOS, **System Settings › Privacy & Security** › **Open
  Anyway**. Do not remove the quarantine or turn off SmartScreen for them. If the AppImage does not start, say what
  the README, "Install", offers for it.
- **The Setup**: signing in to each CLI, from the app's buttons or by running `claude`, `codex login` and
  `gh auth login` themselves, and the trust prompts. **Skip** leaves the Setup.

## 6. Check that the app answers

Wait for `<workspace>/control/endpoint.json` (up to 2 minutes, more while the user is at a warning). Its `client` is the
command that calls the app, as a list of arguments, for A and for B. Make one read call with it:

```
<client...> projects:list --workspace "<workspace>"
```

An answer, even an empty list, means it works. Without one, say which of these it is and stop: the app did not open
(show its output), the window is waiting for the user, or Settings › Execution › "Allow outside sessions to control
this app" is off. If there is no `client`, the app is older than this guide. Never show the token of
`endpoint.json`.

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
> From the phone: turn on Remote Control in the session opened in that folder.

For the new session:

| Where | How |
|---|---|
| Claude desktop app | a new Code session, with `<workspace>` as its folder |
| Claude Code in a terminal | `cd "<workspace>"`, then `claude` |
| Claude Code, also from the phone | `cd "<workspace>"`, then `claude --remote-control` |
| Codex in a terminal | `codex --cd "<workspace>"` |

To add the folder to this session: in Claude Code the user types `/add-dir <workspace>`; if you have a tool that asks the
user for a folder, use it. Codex takes it only when it starts (`--add-dir`): recommend the new session.

If the user adds it here, **read `<workspace>/AGENTS.md` before anything else** (adding a folder does not load it) and
say that you are the Oracle now, not before. If the file is not there, the app is older than this guide: say so and
stop.

## 8. First step as the Oracle

Offer to import a project, and to try a first run in simulation, which is free. Start nothing until the user
chooses.
