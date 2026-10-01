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
- **Run locally at a gate (#70)**: a gate with `local_preview: true` (developer_check, human_review,
  approve_merge) whose run has a config (the project's `localPreview`, else
  `orchestrator.local_preview: { install, command, url }`) carries `local_preview` and `work_dir`
  in `approval.requested` / `pendingGates()`. `localPreview:start` (service `startLocalPreview`,
  helpers in `src/local-preview.js`) runs `install && command` (install only when node_modules is
  missing or the lockfile hash changed since the run's last preview) in the worktree, in a pty of
  `src/terminals.js`; one per run; a busy `url` port is refused with a message. Env: always
  `MULTIAGENT_SIMULATION_ONLY=1`, `MULTIAGENT_WORKSPACE` = a scratch copy under
  `<workspace>/local-previews/<run>/workspace` (projects, agents, skills, workflows, settings; never
  runs) and `MULTIAGENT_USER_DATA` (read by `src/main.js`, dev only) unless the owner chose the
  real workspace. Stopped on `approval.resolved` and `workflow.finished` (and by `terminals.killAll`
  at quit); it never answers the gate. `local_preview.started` / `local_preview.stopped` events land
  in the run's history and chat. Mock runs have no worktree: `work_dir` is `repo_path`.
- **Run App's config (#115)**: `gateRunConfig` (service) resolves project `localPreview` >
  `.multiagent/local-preview.yaml` read from the gate's `work_dir` (the run's branch, so a run that
  edits it sees its own version) > `orchestrator.local_preview` > the gate's; `suggestConfig`
  detects from `work_dir` only when none applies. A non-project config runs only after the owner's
  one click (`localPreview:start` with `confirm`), which stores its fingerprint as the project's
  `localPreviewConfirmed`; a different fingerprint (the file edited) asks again. `cwd` must stay
  inside `work_dir`; the lockfile check (install) stays at the root. `localPreview:save` writes the
  file to the project's folder (the owner's checkout, never the run's worktree).
- **The app started by hand in a worktree (#112)**: `npm start` in `<workspace>/worktrees/<id>`
  (dev only, no `MULTIAGENT_WORKSPACE`) gets a scratch workspace and user data folder under
  `<workspace>/local-previews/app-<id>/` and simulations only (`worktreeAppScratch` in
  `src/local-preview.js`, used by `src/main.js`): it never opens the owner's workspace. Prefer **Run App**.
- **The run's scratch workspace (#120)**: a run with a worktree gets `runs/<id>/scratch/{workspace,
  user-data}` (`WorkflowRun.scratchWorkspace`, same content rules as `scratchWorkspace` in
  `src/local-preview.js`: agents, skills, workflows, settings, project entries pointing to empty
  folders; never runs, repos or worktrees), created on the first agent turn. Every agent of the run
  gets it as `MULTIAGENT_WORKSPACE` / `MULTIAGENT_USER_DATA` (`capabilities.agentEnv`), so
  `npm run run -- --mock`, `npm run screenshot`, `npm start` and `node -e` engine scripts from the
  worktree write there, never to the owner's runs, roadmap, queue or backlog. Removed with the
  worktree (`finishWorktree` on success, `cleanupWorktrees` for orphans, `removeScratch` in
  `src/engine/worktree.js`); a failed or cancelled run keeps it while its worktree is kept. The
  evidence agents keep lives in `runs/<id>/logs` and `runs/<id>/screenshots`, which stay. Without
  the variable, `resolveWorkspace` under `MULTIAGENT_SIMULATION_ONLY=1` falls back to
  `<os tmp>/multiagent-simulation/workspace`, never the registered workspace.
- **One app per workspace (#112)**: `src/main.js` takes Electron's single-instance lock (the owner's
  user data folder) and `<workspace>/.lock` (pid, host, heartbeat; `lockWorkspace` in
  `src/run-owner.js`). A second copy offers a scratch copy or quit; a stale lock (dead pid, old
  heartbeat) is taken over. Each run in progress has `runs/<id>/owner.json` with a heartbeat
  (`claimRun`): another process lists it as `running` (`runningElsewhere`), never `interrupted`,
  and the roadmap, Retry, Resume and a new run for the same issues leave it alone.

## Gotchas

- A branch checked out in one worktree can't be deleted (`branch -D`) or checked out in another.
  So `gh pr merge` runs with `--repo <owner/repo>` (server side only, no local branch handling)
  and the engine deletes the local branch itself.
- `git switch -c b origin/<base>` sets `origin/<base>` as upstream: use `--no-track`.
- Git's error wording differs by version ("checked out at" before 2.42, "used by worktree at"
  after; CI runs a newer git than the local 2.32): don't match git messages in tests or code
  without accepting both.
- Compare paths with `canonicalPath`/`samePath` (see [windows-gotchas.md](windows-gotchas.md)).

## Fewer merge conflicts between parallel runs (#77)

- Shared tables are generated from per-feature files (`npm run docs`, see the code map's header):
  the code map is gitignored, the README tables are committed with an out-of-date check. The
  channels of `window.api` are one file per area (`src/service/channels/`).
- Shared name lists (`module.exports`, destructured requires) are one item per line, sorted
  (`npm run lint:lists`, `-- --fix`); new functions go next to related code, not before the same
  section comment every run uses.
- Agents' git runs with `rerere.enabled` (the engine sets it through `GIT_CONFIG_*` in the agents'
  environment, not in the repo's config): a resolution git recorded once is replayed. It is a help,
  not relied on. No `merge=union` in `.gitattributes`: no append-only line list is left.

## Follow-ups (not done)

- Confirm with the first real merge that `gh pr merge --repo` leaves local branches alone.
- "Open in CLI" after a worktree is removed opens in `repo_path`, where `claude --resume` may not
  find the session (Claude keys sessions by folder).
