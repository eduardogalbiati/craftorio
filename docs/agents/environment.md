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
  (`apps/desktop/host/main.js`, #139). Raw OS formats use `electron application/osclipboard;format="<name>"`.
- Rust (#341): **stable** through `rustup` (cargo 1.99 here; the workspace needs 1.85+ for edition
  2024), with the **MSVC** build tools on Windows (Visual Studio Build Tools, "Desktop development
  with C++"; `rustup` installs the `x86_64-pc-windows-msvc` toolchain). The cargo workspace is
  `native/` (one crate per sidecar binary, `Cargo.lock` committed, never-crash clippy lints
  denied outside tests via `native/clippy.toml`). Checks: `cargo fmt --manifest-path
  native/Cargo.toml --all -- --check`, `cargo clippy --manifest-path native/Cargo.toml
  --all-targets -- -D warnings`, `cargo test --manifest-path native/Cargo.toml`. The **target
  folder is per worktree** (`native/target/`, gitignored; `CARGO_TARGET_DIR` moves it, and
  `test/supervisor/supervisor-mcp.test.js` follows it): a run's first `npm test` builds `craftorio-mcp` in
  release (about a minute), later ones are incremental. Without cargo, `npm test` skips the
  binary's cases with one line; CI never does. `mcpCommand` (`packages/engine/domains/supervisor/supervisor-bridge.js`) starts
  `native/target/release/craftorio-mcp[.exe]` when it exists (packaged: `resources/bin/`), else
  `packages/engine/domains/supervisor/supervisor-mcp.js` under Node; never a binary from PATH. `npm run package` builds the
  release target of the platform and arch (`rustup target add` first) and needs cargo.
- **No system Node in the packaged app** (#342): it ships three sidecars in `resources/bin/`
  (`nativeBinaryPath`, `packages/engine/domains/machine/native-bin.js`): `craftorio-mcp`, `craftorio-tail` (the external
  live terminal, `tailCommand` in `terminalSpec`; the embedded one keeps `followSession` in
  `packages/engine/domains/session/session-tail.js`) and `craftorio-ctl` (the control channel's client, its path shown in
  Settings › Execution). Node is needed for development only: `npm start`, the tests and the
  JS fallbacks of a checkout without cargo (`packages/engine/domains/session/session-tail.js`, `packages/engine/domains/supervisor/supervisor-mcp.js`,
  `scripts/ctl.js`). `test/session/session-tail-342.test.js` and `test/ctl-342.test.js` build the two
  binaries in release on their first run, like `craftorio-mcp`.
- Installed CLIs: `claude` (~/.local/bin), `codex` (WinGet), `grok` (~/.grok/bin), `gh` in
  `C:\Program Files\GitHub CLI\gh.exe`, `glab` optional. Inside runs the engine refreshes PATH
  (`refreshWindowsPath`), so agents call bare `gh`/`glab` (see [capabilities.md](capabilities.md)).
  A shell opened outside the app may still lack it on PATH.
- macOS and Linux (#316): `resolveCommand` (`packages/engine/engine/providers.js`) returns the absolute path
  of an executable file on PATH or in the known folders (`~/.local/bin`, `~/.grok/bin`,
  `~/.npm-global/bin`, the `~/.npmrc` prefix, `/opt/homebrew/bin`, `/usr/local/bin`), else `null`
  (as on Windows). Before the first lookup it merges the login shell's PATH once per process
  (`mergeLoginShellPath`, 3 s timeout; a failing or noisy shell changes nothing). Config folders
  follow `CLAUDE_CONFIG_DIR` and `CODEX_HOME` (`packages/engine/domains/cli/cli-config-dirs.js`).
- Spawned CLIs get the lookup's folders (#397): `withCliPath` (`packages/engine/engine/providers.js`) appends
  the `cliDirs()` that exist (the known folders above; Windows `~\.local\bin`, `%APPDATA%\npm`),
  re-read per launch, after the env's own PATH, without duplicates. `cliEnv()`
  (`packages/engine/service/common.js`: command, shell, Sessions and supervisor terminals) and agent turns use it.
- macOS without Homebrew (#398): `installCommands(platform, { brew })` (`packages/engine/domains/machine/install-commands.js`)
  offers brew commands only when `brew` resolves; otherwise git gets `xcode-select --install` and
  gh, glab and whisper-cli get prose (`MAC_NO_BREW_TEXT`). The command terminal's allowlist uses the
  same list.
- **Packaging per OS** (#317, `apps/desktop/scripts/package.js`): `npm run package` builds for the current
  machine into `dist/Craftorio-<platform>-<arch>/`; `-- --platform win32|darwin|linux
  --arch x64|arm64` picks another target. Same asar ignore/unpack lists everywhere; the fuses are
  flipped in the `.exe`, the `.app`'s `Contents/MacOS` binary or the ELF, and on macOS the `.app` is
  re-signed ad hoc right after (needs `codesign`, so a Mac). macOS: bundle id, `.icns`,
  `NSMicrophoneUsageDescription`; no Developer ID signing nor notarization (owner decision later).
  Icons: `apps/desktop/assets/icon-source.png` → `npm run icons` (`scripts/icons.js`, runs under Electron).
  `scripts/release-assets.js` turns a build into the release files (Windows zip, macOS zip made with
  `ditto`, Linux `.tar.gz` and AppImage through `appimagetool`), and `scripts/smoke-package.js`
  starts a packaged app in simulation on a scratch workspace and waits for it to quit by itself
  (`CRAFTORIO_SMOKE_FILE`, honoured only with `CRAFTORIO_SIMULATION_ONLY=1`, `apps/desktop/host/main.js`).
  On macOS the packaged smoke and the screenshot tool run on Chromium's mock keychain (`use-mock-keychain`, #623).
- **Release jobs**: `deploy.yml` (a `vX.Y.Z` tag or a manual dispatch) runs one build job per target on `windows-latest`
  (win32 x64), `macos-latest` (darwin arm64), `macos-15-intel` (darwin x64) and `ubuntu-latest`
  (linux x64: `npm rebuild node-pty` against Electron's headers, AppImage + tar.gz, smoke under
  `xvfb-run`), then one `publish` job puts every asset in the same GitHub Release. A failing build or
  smoke stops the release. `preview.yml` runs the same jobs for the OS its `os` input picks
  (`windows` by default, `macos`, `linux`, `all`).
- Voice input (optional, `packages/engine/domains/chat/speech.js`): `whisper-cli` from whisper.cpp. On Windows download
  `whisper-bin-x64.zip` from https://github.com/ggml-org/whisper.cpp/releases, unzip it (e.g. to
  `%LOCALAPPDATA%\whisper.cpp`) and add that folder to PATH, or put the full path of
  `whisper-cli.exe` in Settings › General › Voice input. Models (`ggml-<id>.bin`) are downloaded
  from Settings into `%APPDATA%\<app>\speech-models` (Electron's userData; the engine server uses
  `%APPDATA%\craftorio\speech-models`). Tests use a fake CLI, never the real one.
- Workspace: `%USERPROFILE%\craftorio-workspace` (registry `HKCU\Software\Craftorio\WorkspacePath`,
  overridable with `CRAFTORIO_WORKSPACE`). Layout: `runs/`, `repos/` (git checkouts, `<owner>-<repo>`),
  `worktrees/` (one git worktree per run, `<run_id>`), `backlog/` (issue sync per project), `projects/` (`<id>.json`),
  `skills/`, `agents/` (`<id>.json`), `settings.json`. The owner's project `craftorio`
  points at `repos/eduardogalbiati-craftorio` (SSH remote; the repository is public, MIT).
- **Developing while runs are active**: pulling or merging changes the sources (`packages/`, `apps/`) under the running app.
  Ctrl+R reloads only the window (renderer + preload); the main process (or the `npm run serve`
  server) keeps the code it started with, so new channels are missing. The process records its
  code version at startup (`packages/engine/domains/workspace/code-version.js`: app version + a hash of `src/` without
  `renderer/` and `preload.js`; the packaged app uses its version only) and the window compares it
  with the code on disk (`app:codeVersion`) when it loads and gets the focus. On a difference a
  banner offers **Restart** (`app:relaunch`): it lists the runs in progress with their step,
  refuses without that confirmation and relaunches; after the restart
  the interrupted runs are listed with Resume. A missing channel shows "This feature needs an app
  restart" instead of the IPC error. So: pull, then restart. With the browser UI, restart the server
  and reload the page.
- **The app updates itself** (#279, `packages/engine/domains/workspace/app-update.js`, `areas/app-update.js`): with Self-healing
  and Settings › Execution › Oracle › "Apply merged fixes to this app" on, a source checkout
  (`app.isPackaged` false) whose repository is a project of the workspace (same `origin`, or the
  app's commit in the clone's local main) takes the fixes merged into that clone's **local main**
  (never the network): after a roadmap stage ends (the one trigger since #285; a merged item alone
  never updates the app) it pauses the roadmaps ("Updating the app"),
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

## Repository layout: npm workspaces (phases 2 and 3 of the reorganisation study)

One repository, one `node_modules` (default hoisting), the workspaces of the root `package.json`
(`workspaces: ["packages/*", "fronts/*", "apps/*"]`), decisions 6 and 7 of 2026-10-24:

- `packages/shared/` = `@craftorio/shared`: the pure dual-load modules, files at the package root.
- `packages/engine/` = `@craftorio/engine`: `engine/`, `service/`, `server/`, `control/`, `domains/`
  at the package root (requires inside the package are relative), `bin/craftorio-engine.js`
  (`npm run serve`). `node-pty` is an optional peer: the desktop app provides it.
- `packages/ui-kit/` = `@craftorio/ui-kit` (phase 3, #579): the UI kit every page starts from (the
  shell, the run kernel, the controls, `style.css`, the shell's screens in `views/`), plain page scripts.
- `fronts/<id>/` = `@craftorio/front-<id>` (phase 3): the four fronts `analyser`, `build`, `plan`,
  `ai`, each its `views/`, `features/` and `test/`. An app's `composition.js` lists the fronts it ships
  ([loading-and-composition.md](renderer/loading-and-composition.md)).
- `apps/desktop/` = `@craftorio/desktop`: `host/` (Electron's main, the root `package.json`'s `main`),
  `renderer/` (its page, `index.html`, generated from its composition; the engine connection page),
  `assets/`, `scripts/package.js` (`npm run build`). `node-pty`, xterm, marked, dompurify and html-to-image are its
  dependencies.
- `apps/web/` = `@craftorio/web` (phase 3): the browser UI the engine server serves at `/` (the root
  `package.json`'s `craftorio.ui` names `apps/web/renderer`): its `composition.js`, its page and
  `api-http.js`. Not in the desktop asar.
- Across packages, require by name: `@craftorio/shared/<file>`, `@craftorio/engine/<folder>/<file>`
  (npm links the workspaces in `node_modules/@craftorio/`; `npm ci` / `npm install` at the root).
  The engine never requires the desktop app (`node scripts/layers.js`). A new workspace is learnt once
  in `scripts/source-tree.js` (the code map, the ratchets, the layering check and the test runner read it).
- Tests live in each workspace's `test/` (`npm test -w packages/engine` runs one; the root `npm test`
  runs them all plus the root `test/`, the repository's own tests).
- **The app root** (`packages/engine/domains/workspace/app-root.js`): the bundled defaults
  (`workflows/`, `skills/`, `pipelines/`, `seeds/`, `fragments/`), the app version and the server's static
  root come from the first `package.json` above the module with `workspaces` or a `craftorio` section
  (the repository's; `resources/app`'s in the packaged app, where the packager strips `workspaces`),
  never from a package's own folder (`__dirname`); `CRAFTORIO_APP_ROOT` overrides it. The root
  `package.json`'s `craftorio.ui` names the UI folder the engine server serves.
- **Packaging**: the packaged app is still the workspace root. `@electron/packager` dereferences the
  workspace links, so the asar holds `packages/`, `apps/` and the copies under `node_modules/@craftorio/`
  that `require('@craftorio/…')` resolves (the renderer's `<script>` paths reach `packages/shared/`
  directly); its prune follows the root's dependencies (the three workspaces) into theirs; the
  workspaces' `test/` and `scripts/` folders are ignored. `node scripts/smoke-package.js` checks a build.

## Platforms (#318)

The app runs on Windows, macOS and Linux. What differs per OS, and where:

- **Path comparison**: one rule, `samePath` / `pathKey` in `packages/engine/domains/machine/platform-paths.js`:
  case-insensitive on Windows and macOS, case-sensitive on Linux. Never compare paths with an
  inline `process.platform === 'win32' ? toLowerCase()`; use the helper (store, runs, artifacts,
  permissions, worktrees, deps cache, process lists, `path:open`).
- **External terminal (↗)**: `apps/desktop/host/external-terminal.js`. Windows `cmd.exe start ... cmd /k`;
  macOS Terminal.app through `osascript` (the app's environment is exported in the command line,
  Terminal.app does not inherit it); Linux the first installed of `$TERMINAL`,
  `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`. None found: the preload's
  `api.externalTerminal` says why and the ↗ buttons are disabled with that tooltip.
- **Process trees**: Windows `taskkill /T /F`. macOS/Linux: every process `killTree` may stop is
  spawned with `OWN_GROUP` (`detached: true`, its own process group) and `killTree` signals the
  group (SIGTERM, SIGKILL after 2 s), so grandchildren (test servers, sub-agents, npm) die too.
  Embedded terminals (node-pty) have their own kill in `packages/engine/domains/machine/terminals.js`.
- **Microphone**: macOS asks `systemPreferences.askForMediaAccess('microphone')` before the first
  recording (`packages/engine/domains/chat/mic-permission.js`, channel `voice:mic-access`); a denial points to System
  Settings. Other OSes never ask. The `NSMicrophoneUsageDescription` string belongs to packaging.
- **App data**: Electron's `userData` on every OS (speech models in `<userData>/speech-models`).
  Without Electron (`npm run serve`, tests) `packages/engine/domains/chat/speech.js` falls back to `%APPDATA%`,
  `~/Library/Application Support` or `$XDG_CONFIG_HOME`/`~/.config`, plus `craftorio`.

## Remote engine (the app as a window onto `npm run serve`)

- The setting is per machine: `<userData>/engine-connection.json` (`{ mode, address, token }`, the
  token `{ encrypted }` with `safeStorage`, `{ plain }` without OS encryption), never in the
  workspace. Rules in `apps/desktop/host/engine-connection.js` (pure), windows in `apps/desktop/host/engine-connection-window.js`,
  the page in `apps/desktop/renderer/connection/` with its own preload (`apps/desktop/host/engine-connection-preload.js`).
- `apps/desktop/host/main.js` decides at `whenReady` (`decideMode`): remote mode creates no workspace, lock,
  account, keep-awake, control channel or cleanup timer; the service is constructed but never gets a
  workspace. `CRAFTORIO_ENGINE=local` forces local; under `CRAFTORIO_SIMULATION_ONLY=1` a remote
  engine is used only on 127.0.0.1 (a check never drives an engine that can start real runs).
- The remote window has only the capture preload (`remote-window-preload.js`, #751: `captureWindow`
  uses it; [findings.md](renderer/findings.md)), `sandbox`, its own session (`persist:remote-engine`, user agent
  marked `CraftorioRemoteClient`, clipboard permissions for the engine's origin only); the page
  (`api-http.js`) reads the mark for `api.engineConnection` and opens the connection page by opening
  `/__desktop__/engine-connection`, which the window catches.
- Check it end to end with `npx electron scripts/smoke-remote.js <out-dir>` (a scratch
  `npm run serve` on 127.0.0.1, simulation only, a scratch user data folder).
- **A web client installs and signs in CLIs on the engine** (#740, Settings › Agents & CLIs):
  `cli-setup:start { id, action: install | login }` runs `domains/machine/install-commands.js`'s command as a job
  (`service/areas/cli-setup.js`; output, one-time code and URL on `cli-setup:changed`; the CLI is re-checked at
  the end; behind the token, #479). Only `gh` / `glab` sign in headless; `claude`, `codex`, `grok` answer
  `status: manual` with the command for a server terminal. Simulation installs nothing
  (`domains/machine/simulated-clis.js`; `CRAFTORIO_E2E_CLI_MISSING=<id>` hides a CLI until the simulated
  install). The desktop app keeps its terminal dock for a sign-in.
