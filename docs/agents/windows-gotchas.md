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
Use `canonicalPath`/`samePath` from `packages/engine/engine/worktree.js`.

## node-pty

- A GUI-subsystem binary (Electron's exe, even with `ELECTRON_RUN_AS_NODE`) writes nothing into a
  pseudoterminal → the live log follower runs in-process (virtual terminal).
- node-pty re-quotes array args: pass `cmd.exe` its command line as **one string**.
- In the packaged app node-pty must be loaded from `app.asar.unpacked` (its worker thread can't
  read app.asar); `scripts/package.js` sets `asar.unpack` for it.
- `kill()` after exit prints "AttachConsole failed" (harmless).

## Memory: commit, not the working set (#276)

- A runaway Windows process is measured by its **committed (private) bytes**, not its working set:
  in the #274 incident a `node --test` process passed 70 GB of commit while its working set stayed
  near 22 GB. Windows grows the page file until the commit limit is reached, then everything that
  allocates fails. The memory guard (`packages/engine/engine/memory-guard.js`) reads `Win32_Process.PrivatePageCount`
  and the free commit (`Win32_OperatingSystem.FreeVirtualMemory`) through **one long-lived
  PowerShell helper**: when the commit is gone, starting a new process (even `git`) fails.
- Out-of-memory signatures in other runs' logs (they are the machine's, not the change's):
  `Mingw-w64 runtime failure: VirtualProtect failed with code 0x5af` (git), `O arquivo de paginação
  é muito pequeno para que esta operação seja concluída` / "The paging file is too small for this
  operation to complete", `spawnSync git UNKNOWN`, exit code 3221225794 (0xC0000142, a DLL that could
  not initialize), and waits that time out. A suite round that fails while the guard recorded an
  incident reruns by itself (engine/agents-and-steps.md, "Memory guard").
- A failing `assert` serialises both operands: a fake DOM node or a `vm` sandbox drags the whole
  graph into the message (the #274 cause). Compare primitives (`skills/testing-principles`).

## Packaged exe

- Hardened (`scripts/package.js` flips Electron fuses): no `ELECTRON_RUN_AS_NODE`, no
  `NODE_OPTIONS`/`--inspect`, only loads `app.asar` and refuses a modified one (integrity check);
  DevTools off and `--remote-debugging-port` exits when `app.isPackaged`. So the packaged app can't
  spawn itself as node: anything that must run as a node child ships unpacked (`asar.unpack`) and
  runs under the system `node` (e.g. the external live terminal). The supervisor's MCP server is
  the exception since #341: the Rust `multiagent-mcp.exe` in `resources/bin/` needs no node.
- Rust on Windows (#341) builds with the **MSVC** toolchain: `link.exe` comes from the Visual Studio
  Build Tools ("Desktop development with C++"). `cargo build` failing with "link.exe not found" (or
  Git Bash's `/usr/bin/link` picked instead) means those tools are missing; the GNU toolchain is not
  used. A running `multiagent-mcp.exe` (a live Supervisor or Oracle session) locks
  `native/target/release/`: cargo then fails with "Access is denied" until that session ends.
- The packaged `.exe` returns immediately to the shell; its stdout doesn't show in Git Bash/PowerShell.
- Orphan test processes can lock `build/` (EBUSY/ENOTEMPTY): find them by command line before
  rebuilding, and never kill the owner's running app (`electron.exe .`).
- `npm install` of Electron fails with EBUSY while the app is open: ask the owner to close it.
