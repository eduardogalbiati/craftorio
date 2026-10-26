# packages/engine: agent notes

Read first: [engine.md](../../docs/agents/engine.md) (the topic index: read only the subtopic you
touch) and, for worktrees, merges or branches, [worktrees.md](../../docs/agents/worktrees.md).

- **Simulation only in checks and tests**: they run with `MULTIAGENT_SIMULATION_ONLY=1` (the engine
  refuses real runs, real providers and CLI terminals); never start a real run or a real CLI from a
  test. Use the mock provider (`--mock`, [testing.md](../../docs/agents/testing.md)).
- **Worktrees**: a mock run never creates a worktree; a worktree folder a process still holds
  (`EBUSY` on Windows) stays for the next cleanup pass. Compare paths with `canonicalPath` /
  `samePath` (`engine/worktree.js`), never `path.resolve` + lowercase.
- **Bundled defaults** (workflows, skills, fragments) come from the app root, never from this
  package's folder or `__dirname`.
