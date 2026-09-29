# Windows, paths and packaging gotchas

Read this before patching files with scripts, comparing paths, touching node-pty/terminals,
packaging, or installing dependencies.

## Line endings and scripted edits

Many files are CRLF in the working tree. Patching with scripts must normalize `\r\n` → `\n` and
restore; prefer the Edit tool. Git Bash heredocs mangle backslashes, backticks and quotes: write
scripts with the Write tool into the scratchpad and run them with node.

## Paths

Never compare paths with `path.resolve` + lowercase alone. The GitHub Windows runner's temp folder
is an 8.3 short path (`RUNNER~1`) while git prints long paths, and macOS `/var` is `/private/var`.
Use `canonicalPath`/`samePath` from `src/engine/worktree.js`.

## node-pty

- A GUI-subsystem binary (Electron's exe, even with `ELECTRON_RUN_AS_NODE`) writes nothing into a
  pseudoterminal → the live log follower runs in-process (virtual terminal).
- node-pty re-quotes array args: pass `cmd.exe` its command line as **one string**.
- In the packaged app node-pty must be loaded from `app.asar.unpacked` (its worker thread can't
  read app.asar); `scripts/package.js` sets `asar.unpack` for it.
- `kill()` after exit prints "AttachConsole failed" (harmless).

## Packaged exe

- Hardened (`scripts/package.js` flips Electron fuses): no `ELECTRON_RUN_AS_NODE`, no
  `NODE_OPTIONS`/`--inspect`, only loads `app.asar` and refuses a modified one (integrity check);
  DevTools off and `--remote-debugging-port` exits when `app.isPackaged`. So the packaged app can't
  spawn itself as node: anything that must run as a node child ships unpacked (`asar.unpack`) and
  runs under the system `node` (e.g. the external live terminal).
- The packaged `.exe` returns immediately to the shell; its stdout doesn't show in Git Bash/PowerShell.
- Orphan test processes can lock `build/` (EBUSY/ENOTEMPTY): find them by command line before
  rebuilding, and never kill the owner's running app (`electron.exe .`).
- `npm install` of Electron fails with EBUSY while the app is open: ask the owner to close it.
