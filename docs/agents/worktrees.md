# Git worktrees per run

Read this before touching `src/engine/worktree.js`, `setupWorktree`/`finishWorktree`, merge
actions, or any code that deletes or checks out branches.

## How runs use them

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: each run
  works in its own worktree (`<workspace>/worktrees/<run_id>`, detached at a freshly fetched
  `origin/<base>`). Removed on success, kept on failure/cancel for resume. Approval actions run in
  `worktree_dir`. Falls back to the repo path when it isn't a git repo; mock runs never create
  worktrees. Only `software-development` uses it (`multi-model-review` reviews the checked-out branch).
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
