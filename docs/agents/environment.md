# Environment

Read this when installing dependencies, upgrading Node/Electron, calling the CLIs, or working with
the workspace folder.

- Node **24** (`engines`, `.nvmrc`), npm 11. **npm 11 runs install scripts only for packages in
  `allowScripts`** (package.json): `node-pty@1.1.0` is approved. After upgrading it, run
  `npm approve-scripts node-pty`.
- Electron **44.4.5** (bundles Node 24.21). Electron 44 has no postinstall: its binary downloads on
  first use (`node node_modules/electron/install.js` to force it).
- Electron 44's `clipboard` is **async and `ClipboardItem`-based**: only `clear`, `has`, `read`,
  `readText`, `write` and `writeText`, all but `clear` returning promises. `writeImage`,
  `writeBuffer`, `readImage` and `readBuffer` are gone: write an image as
  `clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()]) })])` and await it
  (`src/main.js`, #139). Raw OS formats use `electron application/osclipboard;format="<name>"`.
- Installed CLIs: `claude` (~/.local/bin), `codex` (WinGet), `grok` (~/.grok/bin), `gh` in
  `C:\Program Files\GitHub CLI\gh.exe`, `glab` optional. Inside runs the engine refreshes PATH
  (`refreshWindowsPath`), so agents call bare `gh`/`glab` (see [capabilities.md](capabilities.md)).
  A shell opened outside the app may still lack it on PATH.
- Voice input (optional, `src/speech.js`): `whisper-cli` from whisper.cpp. On Windows download
  `whisper-bin-x64.zip` from https://github.com/ggml-org/whisper.cpp/releases, unzip it (e.g. to
  `%LOCALAPPDATA%\whisper.cpp`) and add that folder to PATH, or put the full path of
  `whisper-cli.exe` in Settings › General › Voice input. Models (`ggml-<id>.bin`) are downloaded
  from Settings into `%APPDATA%\<app>\speech-models` (Electron's userData; the engine server uses
  `%APPDATA%\multiagent-orchestrator\speech-models`). Tests use a fake CLI, never the real one.
- Workspace: `%USERPROFILE%\multiagent-workspace` (registry `HKCU\Software\MultiagentOrchestrator\WorkspacePath`,
  overridable with `MULTIAGENT_WORKSPACE`). Layout: `runs/`, `repos/` (git checkouts, `<owner>-<repo>`),
  `worktrees/` (one git worktree per run, `<run_id>`), `backlog/` (issue sync per project), `projects/` (`<id>.json`),
  `skills/`, `agents/` (`<id>.json`), `settings.json`. The owner's project `multiagent-orchestrator`
  points at `repos/eduardogalbiati-multiagent-orchestrator` (SSH remote; the repo is private).
- **Developing while runs are active**: pulling or merging changes `src/` under the running app.
  Ctrl+R reloads only the window (renderer + preload); the main process (or the `npm run serve`
  server) keeps the code it started with, so new channels are missing. The process records its
  code version at startup (`src/code-version.js`: app version + a hash of `src/` without
  `renderer/` and `preload.js`; the packaged app uses its version only) and the window compares it
  with the code on disk (`app:codeVersion`) when it loads and gets the focus. On a difference a
  banner offers **Restart** (`app:relaunch`): it lists the runs in progress with their step,
  refuses without that confirmation, pauses the Backlog queues and relaunches; after the restart
  the interrupted runs are listed with Resume. A missing channel shows "This feature needs an app
  restart" instead of the IPC error. So: pull, then restart. With the browser UI, restart the server
  and reload the page.
- **The app updates itself** (#279, `src/app-update.js`, `areas/app-update.js`): with Self-healing
  and Settings › Execution › Oracle › "Apply merged fixes to this app" on, a source checkout
  (`app.isPackaged` false) whose repository is a project of the workspace (same `origin`, or the
  app's commit in the clone's local main) takes the fixes merged into that clone's **local main**
  (never the network): after a merged roadmap item marked "Update the app after this" (or after
  every stage, in that mode) it pauses the roadmaps ("Updating the app") and the Backlog queues,
  waits for every run in progress (a gate is waited for, never answered), refuses a dirty app
  folder or a history that is not a fast-forward (`git merge --ff-only`), runs `npm install` only
  when `package-lock.json` changed (a failure resets the folder to the previous commit), writes
  `<workspace>/oracle/app-update.json` and restarts through `app:relaunch`'s path (`host.relaunch`).
  The new process seeds the workspace copies as at every start (so a copy is never newer than the
  app, nor reverted), sets the paused roadmaps back to running **before** the start-up dispatch and
  deletes the intent. Still there 2 minutes after the restart: the new code did not start, a banner
  gives `git -C <app folder> checkout <from>` until dismissed. Undo ("Go back to <from>", the
  Night watch's actions) is the same cycle with `git reset --keep <from>`. Never in
  simulation-only mode, never pushes, never touches a packaged install.
- The owner uses **subscription plans** (Claude, ChatGPT free for Codex, SuperGrok), not API keys.
