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

**Pause after current turn** (#368, next to Stop) holds a run without cutting any agent: the agents
at work finish their turns (every agent of a parallel step, and a build or suite command its run),
then the run ends **Paused**, its worktree, branch, outputs and sessions kept. While it waits the Run
screen says "Pausing: waiting for developer to finish its turn (develop)" with **Cancel pause**;
then "Paused at code_review, next: reviewer's turn" and when, with **Resume**, which continues there
(also after the app or a CLI was updated): no finished turn runs again, and the confirmation shows
what each agent's next turn re-reads (a cold cache with its extra cost). A run waiting at a gate
pauses at once and asks the same gate again on Resume. Only you resume a paused run: the Night watch,
the Oracle and the supervisor never do. A roadmap stage's ⋮ menu pauses all its runs the same way.

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
client) are the Rust binaries shipped in `resources/bin/` (`multiagent-mcp`, `multiagent-tail`,
`multiagent-ctl`). npm 11 only runs install scripts that are approved in `allowScripts`
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
  separators) and compare them with `samePath`/`canonicalPath` (`src/engine/worktree.js`). The
  worktree tests deliberately pass non-canonical spellings: a symlink (a junction on Windows) and,
  on Windows, an 8.3 short name, since git prints canonical paths (macOS `/var` is
  `/private/var`; the GitHub Windows runner's temp folder is `C:\Users\RUNNER~1\...`);
- line endings: files may be checked out with CRLF (Windows `core.autocrlf`); do not compare raw
  file contents with `\n`-only literals.

```bash
npm run run -- --task "Task description" --repo C:/path/to/repo --input language=python --input git_platform=gl
```

Runs the workflow for real. `--file ai-arena.yaml` picks another workflow: a name or relative path is
looked up in `<workspace>/workflows/` first, then in the repository's `workflows/`; an absolute path is
used as is (e.g. to try an edited repository copy while the workspace copy is modified). `--auto-approve`
approves every human gate without interaction (tests only: in practice the AI must not cross the gates).

### Engine server (HTTP + WebSocket)

```bash
npm run serve -- --port 7300 --host 127.0.0.1 --workspace C:/path/to/workspace
```

Runs the engine without Electron and serves the same UI to a browser: open the printed
`http://…/?token=…` URL. The token (from `MULTIAGENT_SERVER_TOKEN`, else random) is kept in an
HttpOnly cookie after the first visit; API clients send `Authorization: Bearer <token>`.

- API: `POST /api/<channel>` with `{ "arg": … }` → `{ "result": … }` or `{ "error": … }`. The channels are the
  desktop app's IPC channels (`projects:list`, `run:start`, `artifacts:read`, `auth:state`, …).
- `GET /ws` (WebSocket): the server pushes `{ "channel", "payload" }` for `run:event`, `term:data`,
  `term:exit` and `auth:changed`; the client sends `term:input` / `term:resize` the same way.
- Requests from another origin are refused. Beyond `127.0.0.1` the traffic is plain HTTP: put the
  server behind a reverse proxy with TLS.
- The server asks for the same account as the app (sign in from the browser UI; the sign-in page
  opens on the server machine). `MULTIAGENT_AUTH=off` disables it in development.
- Desktop-only actions (native folder picker, opening files in their app, external console
  windows, changing the workspace) are not available in the browser; folder paths are typed.
  **Keep awake** is disabled there ("Not available in the browser client"): only the desktop app
  keeps the computer from sleeping.

Local build: `npm run build` (writes `build/`) or `npm run package` (writes `dist/`, used by the deploy).
Both build for the current machine; `npm run package -- --platform darwin|linux|win32 --arch arm64|x64`
picks another target (the macOS signature step needs a Mac).
