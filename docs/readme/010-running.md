## Running

```bash
npm install
npm start
```

### Getting started

On a new workspace, after the workspace folder and the sign-in, the app opens **Setup** (#319), a
stepper you can leave at any time with **Skip** (Esc):

1. **Agents**: one row per CLI (Claude Code and Git are required; Codex CLI and Grok Build enable
   the multi-model workflows; GitHub CLI or GitLab CLI enable Backlog sync and pull requests), with
   its status (Ready / Not signed in / Not installed), version and account. **▶ Install** and
   **▶ Sign in** run the CLI's own command in the terminal dock, and the row checks again when that
   terminal ends. Claude Code's sign-in is read from its credentials file (the Keychain on macOS),
   never by calling a model.
2. **Try it safely**: real runs use your own CLI subscriptions or credits; **Show simulation mode**
   (on here) adds the Simulation checkbox to Start, which shows a whole flow for free. Turn it off
   later in Settings › Execution › Developer mode.
3. **Workflows**: the bundled workflows by category, each with what it needs ("Needs Codex") and
   whether this computer has it; the ready ones are picked, and the others are hidden from Start and
   Home (Workflows › Definitions › **Show in Start** brings one back; nothing is deleted).
4. **First project**: adds a project; **Finish** opens Start on the first picked workflow, with
   Simulation checked.

Finish or Skip records `setupDone` in `settings.json`, so Setup does not open by itself again;
Settings › Agents & CLIs › **Run setup again** reopens it. Workspaces created before Setup existed
are marked as set up.

### Screens

<!-- generated:screens -->

<!-- /generated:screens -->

The **Start** button at the top (next to Stop) opens the right side panel: pick the workflow,
the project (its folder becomes `repo_path`/`project_path`) and the input. During and after a
run, **Run** shows up at the bottom of the menu with the sessions and events.

**Pause after current step** (#368, next to Stop) holds a run without cutting any agent: the agents
at work finish their turns (every agent of a parallel step, and a build or suite command its run),
then the run ends **Paused**, its worktree, branch, outputs and sessions kept. While it waits the Run
screen says "Pausing: waiting for developer to finish its turn (develop)" with **Cancel pause**;
then "Paused at code_review, next: reviewer's turn" and when, with **Resume**, which continues there
(also after the app or a CLI was updated): no finished turn runs again, and the confirmation shows
what each agent's next turn re-reads (a cold cache with its extra cost). A run waiting at a gate
pauses at once and asks the same gate again on Resume. Only you resume a paused run: the Night watch,
the Oracle and the supervisor never do. A roadmap stage's ⋮ menu pauses all its runs the same way.
The roadmap bar's **Pause** (#391) is another pause: **Pause after this stage** (the default) lets
the current stage finish, then pauses before the next one ("Stage N done"); **Pause now** starts
nothing new and lets the runs in progress go on.

Each agent session shows its **Next turn** (#320; the run's session table in Projects › Runs and
Workflows › Runs, and a metric on the Run screen's session cards): "fresh from note" (it starts a
new session from its handoff note), "warm · 42 min left" (it resumes while its prompt cache lives),
"cold since 04:57 · ~337K tokens ≈ $X" (resuming writes its whole context to the cache again),
"new session", or "—" when the session is closed. The cache's lifetime is an estimate: one hour for
Claude on a subscription, five minutes on an API key, unknown for Codex and Grok. Every open gate
card says what **Continue** will re-read, one entry per agent ("Continue: developer fresh from note
~20K · reviewer resumes cold ~140K ≈ $0.70"), in the Run screen, the run chat and the phone page.
The bundled workflows set `fresh_after_idle: 55m`, so a persistent agent with a handoff note that
waited past the cache's lifetime starts fresh instead of resuming cold.

Running from source requires Node 24 LTS (`.nvmrc`; `engines` in package.json). The app runs on
Electron 44, which bundles Node 24 too. The packaged app needs no Node: what it starts outside its
own process (the supervisor's MCP server, the external live terminal, the control channel's
client) are the Rust binaries shipped in `resources/bin/` (`craftorio-mcp`, `craftorio-tail`,
`craftorio-ctl`). npm 11 only runs install scripts that are approved in `allowScripts`
(package.json): `node-pty` is approved; after upgrading it, run `npm approve-scripts node-pty`.

From the terminal (no UI):

```bash
npm test
```

Runs the unit tests (`test/`, node:test) and the full flow in mock mode. This is what CI runs.

`npm test` must pass on **Windows, Linux and macOS**, locally and in CI (`ci.yml` runs it on all
three). Tests must not depend on the machine:
- git: the worktree tests run with an empty global config and no system config
  (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`) and pass identity, `init.defaultBranch` and
  `core.autocrlf` with `-c`; match git messages that changed across versions loosely;
- paths: build them with `path.join` under `os.tmpdir()` (no hard-coded `C:/`, `/tmp` or
  separators) and compare them with `samePath`/`canonicalPath` (`packages/engine/engine/worktree.js`). The
  worktree tests deliberately pass non-canonical spellings: a symlink (a junction on Windows) and,
  on Windows, an 8.3 short name, since git prints canonical paths (macOS `/var` is
  `/private/var`; the GitHub Windows runner's temp folder is `C:\Users\RUNNER~1\...`);
- line endings: files may be checked out with CRLF (Windows `core.autocrlf`); do not compare raw
  file contents with `\n`-only literals.

```bash
npm run run -- --task "Task description" --repo C:/path/to/repo --input language=python --input git_platform=gl
```

Runs the workflow for real. `--file write-doc.yaml` picks another workflow: a name or relative path is
looked up in `<workspace>/workflows/` first, then in the repository's `workflows/`; an absolute path is
used as is (e.g. to try an edited repository copy while the workspace copy is modified). `--auto-approve`
approves every human gate without interaction (tests only: in practice the AI must not cross the gates).

### Engine server (HTTP + WebSocket)

```bash
npm run serve -- --port 7300 --host 127.0.0.1 --workspace C:/path/to/workspace
```

**The token is full control of this machine**: whoever has it opens a shell, approves human gates
and starts paid runs, as you would in the desktop app. Share it only with yourself.

`--host` is `127.0.0.1` by default; `tailscale` listens on this computer's Tailscale address only
(100.x.y.z), and the server then prints the addresses another computer can type. Any other address
(`0.0.0.0`, a LAN IP) serves plain HTTP to the network and is refused unless you add
`--insecure-http`: use it only behind a VPN or a reverse proxy with TLS.

Runs the engine without Electron and serves the same UI to a browser: open the printed
`http://…/?token=…` URL (shown once: clear it from the shell history and the scrollback if others
can read them), or open the server's address and type the token in its sign-in form (`POST /session`,
the token stays out of the address bar). The token (from `MULTIAGENT_SERVER_TOKEN`, else random) is
then kept in an HttpOnly, SameSite=Strict cookie for a week (`Secure` when the request came over
HTTPS, e.g. `X-Forwarded-Proto: https` from a TLS proxy); API clients send
`Authorization: Bearer <token>`. On `127.0.0.1` the server answers only requests whose `Host` is
`localhost`, `127.0.0.1` or `[::1]` (DNS rebinding), plus the names it allows: this computer's
MagicDNS name, read at start from `tailscale status --json`, and each `--allow-host <name>` (repeat
it for several names). They match exactly, with any port and in any case, never as a suffix. The
start banner lists them, or says that only the loopback names are answered (for example when
Tailscale is not running). A proxy in front must send one of these names as `Host`.

- API: `POST /api/<channel>` with `{ "arg": … }` → `{ "result": … }` or `{ "error": … }`. The channels are the
  desktop app's IPC channels (`projects:list`, `run:start`, `artifacts:read`, `auth:state`, …).
- `GET /ws` (WebSocket): the server pushes `{ "channel", "payload" }` for `run:event`, `term:data`,
  `term:exit` and `auth:changed`; the client sends `term:input` / `term:resize` the same way.
- Requests from another origin are refused. Beyond `127.0.0.1` the traffic is plain HTTP: put the
  server behind a reverse proxy with TLS.
- The server asks for the same account as the app (sign in from the browser UI; the sign-in page
  opens on the server machine). `MULTIAGENT_AUTH=off` disables it in development.

### The app on one computer, the engine on another

The desktop app can be only a window: the engine (runs, CLIs, terminals, the workspace) runs on
another computer of yours with `npm run serve`, and the app shows it. The simple setup is both
computers on the same [Tailscale](https://tailscale.com) tailnet.

On the computer that runs the engine (a source checkout), in PowerShell:

```powershell
$env:MULTIAGENT_SERVER_TOKEN = "<a long random secret, at least 16 characters>"
$env:MULTIAGENT_AUTH = "off"
npm run serve -- --host tailscale --port 7300
```

Close the desktop app on that computer first: like the app, the server locks its workspace (one
engine per workspace) and refuses to start on a workspace the app has open (or pass
`--workspace <another folder>`). Keep `MULTIAGENT_SERVER_TOKEN` the same: the app saves the token,
and without the variable the server makes a new one at every start. `--host tailscale` keeps the engine off the local network;
`--host 0.0.0.0 --insecure-http` listens everywhere over plain HTTP (only behind a VPN or a TLS proxy).

On the computer with the app: **Settings › Execution › Engine › Change…**, choose **Remote engine**,
type the address (the machine's MagicDNS name such as `my-pc.tailnet.ts.net`, its `100.x.y.z`
address, `host:port`, or a full `http(s)://` URL; port 7300 by default; pasting the `…/?token=…` URL
the server printed fills both fields) and the token, then **Test connection** (the engine's version
and interface, or why not: unreachable, refused token, not an engine) and **Test, save and restart**.
The app restarts as a window onto that engine, named in its title bar: it runs no engine of its
own, opens no workspace and starts nothing that needs one (workspace lock, Night watch, phone
gates, Keep awake, the control channel). The setting is per computer, in the app's own data folder
with the token encrypted by the OS, never in the workspace. A computer that offers no encryption
(Linux without a keyring) stores it as plain text, and the connection page says so.

- When the engine cannot be reached at start (or the window is reloaded while it is down), or it
  refuses the token, the app shows the connection page with the reason: **Retry**, **Change the
  address** or **Use this computer**.
- Back to this computer: Settings › Execution › Engine › Change… › **This computer** (the address
  and token stay saved for later). `MULTIAGENT_ENGINE=local` forces this computer for one start.
- On the engine's computer, not in the window: the CLIs and their sign-ins, the terminals (shown
  in the window, running there), files and folders (type that computer's paths: the folder picker is
  not available), desktop notifications, Keep awake, the control channel, the ↗ external terminal
  and the microphone.
- **Language**: while Settings › General › Language › Interface is unset, the window shows its own
  computer's language, but the AI agents ("Same as the interface") follow the engine's computer's
  language, where they run. To make them agree, choose Interface or AI agents there.
- **Sign-in**: a remote app cannot sign the server in yet (the provider's page would open on the
  engine's computer), so the server runs with `MULTIAGENT_AUTH=off`; the account only counts users.
- Plain HTTP over Tailscale is encrypted by WireGuard. For HTTPS, leave `npm run serve` on
  `127.0.0.1` and put `tailscale serve` in front of it on that computer:

  ```powershell
  npm run serve -- --host 127.0.0.1 --port 7300 --allow-host <machine>.<tailnet>.ts.net
  tailscale serve --bg 7300
  ```

  Then type `https://<machine>.<tailnet>.ts.net` in the app or the browser
  (`tailscale serve --bg --https=8443 7300` serves it on `:8443`). `tailscale serve` forwards that
  name as `Host`; the server allows its own MagicDNS name when Tailscale is running at start, and
  `--allow-host` keeps it allowed when it is not. Check the start banner: `Also answers (tailscale
  serve): …` must list the name. `tailscale serve` proxies only to loopback: pointed at this
  computer's own Tailscale address (`http://100.x.y.z:7300`, a server on `--host tailscale`) it
  answers 502.
- Any other plain `http://` address (a LAN IP such as `192.168.1.10`, a server on `0.0.0.0`) is not
  encrypted: the token and every page could be read or replaced on the network. Saving it needs
  **Allow an insecure connection**, and the connection page warns about it every time it shows it.
  The app sends the token in an `Authorization` header, never in the address, and lets the engine's
  page read the clipboard only over https (writing to it works on http too).
- Desktop-only actions (native folder picker, opening files in their app, external console
  windows, changing the workspace) are not available in the browser; folder paths are typed.
  **Keep awake** is disabled there ("Not available in the browser client"): only the desktop app
  keeps the computer from sleeping.

Local build: `npm run build` (writes `build/`) or `npm run package` (writes `dist/`, used by the deploy).
Both build for the current machine; `npm run package -- --platform darwin|linux|win32 --arch arm64|x64`
picks another target (the macOS signature step needs a Mac).
