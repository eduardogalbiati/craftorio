---
order: 700
---

<!-- section:engine -->
### A git worktree per run

A workflow whose agents change a repository can give every run its own checkout, so runs never
share (or leak) branches, dirty files or a stale local base, and two runs of the same repository
can go at the same time:

```yaml
orchestrator:
  worktree:
    repo: "{{ inputs.repo_path }}"   # the repository (a subfolder works too)
    base: "{{ inputs.base_branch }}" # fetched from origin at run start
defaults:
  working_dir: "{{ worktree_dir }}"  # agents work in the run's worktree
```

- **Start**: `git fetch origin <base>` (no network or no remote only warns and falls back to the
  local base), then `git worktree add --detach <workspace>/worktrees/<run_id> origin/<base>`.
  `worktree_dir` (templates) points to it, and actions (e.g. the merge command) run there.
  `git worktree prune` runs on the repository first. The worktree is outside the run folder, so it
  never shows up as an artifact.
- **Success**: the worktree is removed (`git worktree remove --force` + `prune`) and the run's
  local branch is deleted if it is merged into `origin/<base>` (squash merges included); otherwise
  the branch is kept.
- **Failed, cancelled or interrupted**: the branch keeps the work, not the folder. A detached
  worktree gets a branch (run/<run id>), anything uncommitted becomes a WIP commit naming the run,
  then the folder and the run's scratch are removed (the branch never is). **Resume** from a step
  recreates the folder, at the same path, from the run's branch (so resumed CLI sessions keep their
  working directory) and gives the WIP back as uncommitted work. The app cleans up the folders of
  ended runs at start and every 30 minutes; a run in progress, live in another app window or waiting
  at a human gate keeps its folder.
- The path, branch and outcome are in `summary.json` (`worktree`) and in the `worktree.ready`,
  `worktree.kept` and `worktree.removed` events. Sessions record their `cwd`; a session terminal of
  a removed worktree opens in the repository folder instead.
- **Processes left running**: after each agent step (delegations included) and when the run ends,
  the engine stops the processes started from the worktree that are still running (an Electron UI
  check, a dev server), with their process trees: their executable is inside the worktree (Windows,
  Linux, macOS) or, on Linux/macOS, their working directory is (processes with a terminal, such as
  your own shell there, are spared). Nothing outside the worktree is touched, nor the app itself
  and its terminals. What was stopped is logged (`worktree.processes_stopped` event and a warning).
  Otherwise such a process locks files and every later `npm ci` fails with EBUSY.
- **Not a git repository**, or a simulation (mock) run: no worktree, `worktree_dir` is the
  repository folder itself (the old behaviour).
- **Orphans**: at startup the app removes worktrees whose run succeeded (a removal that failed) and
  worktrees unused for 14 days; failed runs' worktrees stay until then so they can be resumed.
- A fresh worktree has no installed dependencies: the developer and the test/build skills install
  them when missing (`npm ci`, `uv sync`, `dotnet restore`…).
- Merge action: `gh pr merge` runs with `--repo <owner/repo>`, so gh merges and deletes the remote
  branch server side only. Without it, `--delete-branch` also checks out the base and deletes the
  local branch, which fails in a worktree (the base is checked out in the main checkout, and a
  branch checked out in a worktree cannot be deleted). The engine deletes the local branch itself.

Enabled in `software-development`. The other bundled workflows only read a folder
(`multi-model-review` reviews whatever branch the given checkout has) and do not use it.
