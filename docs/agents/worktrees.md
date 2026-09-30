# Git worktrees per run

Read this before touching `src/engine/worktree.js`, `setupWorktree`/`finishWorktree`, merge
actions, or any code that deletes or checks out branches.

## How runs use them

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: each run
  works in its own worktree (`<workspace>/worktrees/<run_id>`, detached at a freshly fetched
  `origin/<base>`). Removed on success, kept on failure/cancel for resume. Approval actions run in
  `worktree_dir`. Falls back to the repo path when it isn't a git repo; mock runs never create
  worktrees. `software-development` and `software-development-local-hero` use it (`multi-model-review` reviews the checked-out branch).
- **Local workflows**: `orchestrator.worktree.remote: false` starts the worktree from the **local** `<base>` without fetching (it may hold local merges never pushed), and `removeWorktree` checks "merged" against the local base. A transition with `merge: local` (validated by `loadWorkflow`; needs `orchestrator.worktree`) calls `mergeLocally`: the run's worktree must be on a branch with everything committed; the branch is rebased onto the local base when it moved (a conflict aborts the rebase, leaves the branch untouched and fails with the files); then the base is fast-forwarded with `merge --ff-only` where it is checked out (refused when that checkout has uncommitted changes to tracked files) or by `update-ref` (compare-and-swap) when it is checked out nowhere. No push, no fetch; simulated runs skip it (`action.executed` skipped). Emits `worktree.merged`. Used by `software-development-local-hero`.
- Starts without `node_modules`: the language skills install dependencies when missing.

## Gotchas

- A branch checked out in one worktree can't be deleted (`branch -D`) or checked out in another.
  So `gh pr merge` runs with `--repo <owner/repo>` (server side only, no local branch handling)
  and the engine deletes the local branch itself.
- `git switch -c b origin/<base>` sets `origin/<base>` as upstream: use `--no-track`.
- Git's error wording differs by version ("checked out at" before 2.42, "used by worktree at"
  after; CI runs a newer git than the local 2.32): don't match git messages in tests or code
  without accepting both.
- Compare paths with `canonicalPath`/`samePath` (see [windows-gotchas.md](windows-gotchas.md)).

## Follow-ups (not done)

- Confirm with the first real merge that `gh pr merge --repo` leaves local branches alone.
- "Open in CLI" after a worktree is removed opens in `repo_path`, where `claude --resume` may not
  find the session (Claude keys sessions by folder).
