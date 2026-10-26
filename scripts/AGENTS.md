# scripts: agent notes

Read first: [windows-gotchas.md](../docs/agents/windows-gotchas.md).

- **Line endings**: many files are CRLF in the working tree; a script that patches or compares text
  normalises `\r\n` to `\n` (and restores it when it writes back). Prefer the Edit tool; write a
  script to a file and run it with node, never a Git Bash heredoc.
- **Paths**: never compare paths with `path.resolve` + lowercase alone (the 8.3 short form
  `RUNNER~1`, macOS `/private/var`): use `canonicalPath` / `samePath` (`packages/engine/engine/worktree.js`).
- **EBUSY**: orphan test processes or the open app lock `build/` or `node_modules` (EBUSY/ENOTEMPTY):
  find them by command line, never kill the owner's running app (`electron.exe .`).
- UI checks go through `scripts/smoke.js` or `npm run screenshot`, never a hand-written launcher.
