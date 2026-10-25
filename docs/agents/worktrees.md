# Git worktrees per run

Read this before touching `packages/engine/engine/worktree.js`, `setupWorktree`/`finishWorktree`, merge
actions, or any code that deletes or checks out branches.

## How runs use them

- `orchestrator.worktree: { repo, base }` + `defaults.working_dir: "{{ worktree_dir }}"`: each run
  works in its own worktree (`<workspace>/worktrees/<run_id>`, detached at a freshly fetched
  `origin/<base>`). Removed on success. Approval actions run in
  `worktree_dir`. Falls back to the repo path when it isn't a git repo; mock runs never create
  worktrees. `software-development` and `software-development-local-hero` use it (`multi-model-review` reviews the checked-out branch).
- **Lifecycle: the branch is the record, the folder is temporary (#202)**. No worktree folder is
  kept for an ended run. Success: `removeWorktree` (the folder, and the local branch once merged).
  Failed, cancelled, stopped: `retireWorktree` (from `finishWorktree`) gives a detached worktree a
  branch (`run/<run id>`), commits anything uncommitted as one WIP commit (`WIP: uncommitted work of
  run <id>`, `--no-verify`, the deps cache's links removed first), then removes the folder and the
  run's scratch; the branch is never deleted. The run records `worktree.removed` { dir, removed,
  branch, branch_deleted: false, wip_commit } and `summary.worktree.branch`. A WIP commit that cannot
  be made keeps the folder (`worktree.kept`). **Resume from step** (and Retry → Resume the old run):
  `resumeSpec` takes the branch from that event, `prepareWorktree` recreates the folder from it
  (`worktree.ready` with `recreated: true`; dependencies from the cache as for a new worktree), and
  `restoreWork` soft-resets a WIP tip: the work is back as staged changes and the resumed step's
  prompt says "uncommitted work from the previous attempt". The kept-work question (#170,
  `runWorktreeWork` in `packages/engine/service/areas/resume.js`) counts the run's own commits on its branch, in
  the repository, once the folder is gone. **Cleanup** (`cleanupWorktrees`, service
  `cleanupRunWorktrees`): at start and every 30 minutes (`apps/desktop/host/main.js`, `packages/engine/bin/multiagent-engine.js`), one pass
  at a time. It never touches the runs in progress here (`active`), a run live in another app process
  (`owner.json` alive, #112) or a run waiting at a human gate (`approval.requested` without
  `approval.resolved`); any other run's worktree is retired the same way (interrupted runs included)
  and recorded in its events.jsonl. A folder a process holds (EBUSY) stays for the next pass; a folder
  git does not know (`shots-*`) goes once older than an hour.
- **Local workflows**: `orchestrator.worktree.remote: false` starts the worktree from the **local** `<base>` without fetching (it may hold local merges never pushed), and `removeWorktree` checks "merged" against the local base. A transition with `merge: local` (validated by `loadWorkflow`; needs `orchestrator.worktree`) calls `mergeLocally`: the run's worktree must be on a branch with everything committed; the branch is rebased onto the local base when it moved (a conflict aborts the rebase, leaves the branch untouched and fails with the files); then the base is fast-forwarded with `merge --ff-only` where it is checked out (refused when that checkout has uncommitted changes to tracked files) or by `update-ref` (compare-and-swap) when it is checked out nowhere. No push, no fetch; simulated runs skip it (`action.executed` skipped). Emits `worktree.merged` (`branch`, `base`, `commit`, `checkout`, `rebased`, and `base_commit`: the base's tip before the merge, which `run:diff` uses as the merge base once the branch is deleted (#289); for a run merged before that field existed it reads the base's reflog). Used by `software-development-local-hero`.
- **Conflicts in protected test files (#380)**: the step after a failed `merge: local` (`resolve_merge`) has the developer rebase in its own turn, so the `protect_files` / `edits_tests: false` guard (`changedTestFiles`, `packages/engine/engine/test-paths.js`) sees the rebased test files as changed. It accepts a file that only combines both sides: changed on both sides since the merge base of the turn's starting HEAD and the base ref, every line of the result from one of the two versions (the ones `git show :2:`/`:3:` give during the rebase), and every line either side added kept. A new line or a dropped one is refused as before. A file still unmerged after the turn (`--diff-filter=U`: git's markers, not the agent's) is not counted: ai-development-local-hero leaves such a test conflict in the rebase (`test_conflict`) and delegates it to the test writer, then the developer finishes the rebase. Placement flags two runs of one stage that add scenarios to the same `.feature` file (product-owner).
- **The branch is brought up to date before each suite round (#403)**: in a local workflow (`remote: false`), before each `type: suite` round (the unit suite and the E2E rounds alike), the engine (`bringBaseIn`, `packages/engine/engine/run/checkout.js` → `syncWithBase` in `worktree.js`) rebases the run's branch (or detached HEAD) onto the local `<base>` when the base moved past it, real git even in a simulation, so a fix that landed on the base meanwhile reaches the run before the final merge. The round's output says which base commit it tested on (`base_commit`), a `log` line names the base commit and the commits brought in, and the next single-agent turn (developer, test writer) gets a note in its prompt. A resumed run ("Resume from step") recreates the folder from its branch and gets the base the same way before its first suite or E2E round. A base that does not apply cleanly (a conflict) aborts the rebase: the round runs on the branch as it is, its log line and message say so, and the conflict is left to the final `merge: local` and `resolve_merge` (#380). Uncommitted changes to tracked files skip it too. Skipped for `base_check: false` (the worktree is the base) and for remote workflows (a pushed branch must not be rewritten). The base itself is never modified and nothing is fetched or pushed.
- **Dependencies from a shared cache (#198, `packages/engine/engine/deps-cache.js`)**: after `worktree.ready`
  the engine (`prepareDeps`) links the worktree's `node_modules` to
  `<workspace>/cache/deps/<project>/<key>/node_modules` (a junction on Windows, a symlink elsewhere)
  and records `deps.ready` (`for`, `status` hit | linked | miss | local | failed | not_cached, `key`,
  `seconds`, `waited`). key = sha256 of the lockfile + package manager and version + Node version
  + platform/arch (a project's Electron is in its lockfile). Miss: `npm ci` / `pnpm install
  --frozen-lockfile` / `yarn install --frozen-lockfile` runs in the worktree (its lifecycle scripts
  see the project), then `node_modules` is renamed into the cache and linked back; `entry.json` is
  written last (an entry without it, a crash or a cancel, is never used and is replaced). One
  installer per key: `<key>.lock` (pid, host; a dead holder's is taken over); the second run waits
  and gets a hit. After each agent step the same call runs again: a changed lockfile installs its
  new key once (the old entry stays for the runs that link it); an entry changed through the link
  (its hidden lockfile changed) or emptied is marked `unusable` in entry.json and never given to a
  new worktree. A move or link that fails (EBUSY, another volume) keeps the install in the worktree
  (`local`) and the cache untouched. Not cached (agents install as before, told by the command
  guide): npm/yarn/pnpm workspaces, `file:`/`link:` dependencies, and the other languages
  (`NOT_CACHED`: poetry/uv/requirements, go.sum, Gemfile.lock). Agents are told in their command
  guide (`depsGuide`); Claude refuses `npm ci` and `rm -rf node_modules` (`DEPS_DENIED_COMMANDS`
  in capabilities.js; Codex/Grok: the after-step check). `removeWorktree` and `cleanupWorktrees`
  unlink the links first (`unlinkDeps`), so no delete follows one into the cache. At app start
  (`cleanupRunWorktrees`) `pruneDepsCache` removes the entries no worktree links: unusable or
  incomplete ones, unused for 14 days, then the least recently used above 20 GB. Settings ›
  General › Dependency cache shows the size and clears the unlinked entries (`depsCache:info`,
  `depsCache:clear`). Simulated runs have no worktree: nothing is installed.
- **The base checkout (#198)**: a step with `base_worktree: true` (the test step of both
  development workflows) gets `<worktreesDir>/<run_id>-base`, detached at the current base
  (refreshed on each visit) with its dependencies from the same cache, as `base_worktree_dir` in
  its prompt, for the pre-existing-failure check (`setupBaseWorktree`, `prepareBaseWorktree`).
  Removed in `finishWorktree` whatever the status; `cleanupWorktrees` removes an orphan once its run
  is not live.
- **Run locally at a gate (#70)**: a gate with `local_preview: true` (developer_check, human_review,
  approve_merge) whose run has a config (the project's `localPreview`, else
  `orchestrator.local_preview: { install, command, url }`) carries `local_preview` and `work_dir`
  in `approval.requested` / `pendingGates()`. `localPreview:start` (service `startLocalPreview`,
  helpers in `packages/engine/domains/local/local-preview.js`) runs `install && command` (install only when node_modules is
  missing or the lockfile hash changed since the run's last preview) in the worktree, in a pty of
  `packages/engine/domains/machine/terminals.js`; one per run; a busy `url` port is refused with a message. Env: always
  `MULTIAGENT_SIMULATION_ONLY=1`, `MULTIAGENT_WORKSPACE` = a scratch copy under
  `<workspace>/local-previews/<run>/workspace` (projects, agents, skills, workflows, settings; never
  runs) and `MULTIAGENT_USER_DATA` (read by `apps/desktop/host/main.js`, dev only) unless the owner chose the
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
  `packages/engine/domains/local/local-preview.js`, used by `apps/desktop/host/main.js`): it never opens the owner's workspace. Prefer **Run App**.
- **The run's scratch workspace (#120)**: a run with a worktree gets `runs/<id>/scratch/{workspace,
  user-data}` (`WorkflowRun.scratchWorkspace`, same content rules as `scratchWorkspace` in
  `packages/engine/domains/local/local-preview.js`: agents, skills, workflows, settings, project entries pointing to empty
  folders; never runs, repos or worktrees), created on the first agent turn. Every agent of the run
  gets it as `MULTIAGENT_WORKSPACE` / `MULTIAGENT_USER_DATA` (`capabilities.agentEnv`), so
  `npm run run -- --mock`, `npm run screenshot`, `npm start` and `node -e` engine scripts from the
  worktree write there, never to the owner's runs, roadmap, queue or backlog. Removed with the
  worktree (`finishWorktree` on success, `cleanupWorktrees` for orphans, `removeScratch` in
  `packages/engine/engine/worktree.js`), whatever the status (#202); the cleanup also removes the scratch of a
  run that ended 3 days ago and has no worktree folder (#201). Scratch files are not artifacts:
  `walkFiles` (`packages/engine/domains/run/run-artifacts.js`) skips `scratch/` like `sessions/`; a `file.saved` under it is
  still listed. The
  evidence agents keep lives in `runs/<id>/logs` and `runs/<id>/evidence`, which stay. Without
  the variable, `resolveWorkspace` under `MULTIAGENT_SIMULATION_ONLY=1` falls back to
  `<os tmp>/multiagent-simulation/workspace`, never the registered workspace.
- **The run's temp folder (#414)**: `runs/<id>/tmp`, one of `RUN_DIRS` (so Claude Code gets it with
  `--add-dir`). `TMP`, `TEMP` and `TMPDIR` point to it for the agents of a non-mock run with a
  worktree (`scratch.tmp` from `WorkflowRun.scratchWorkspace` → `capabilities.agentEnv`) and for
  every suite / e2e round (`runSuite` creates it, `suiteEnv({ tmpDir })`), so the tests' temp files
  stay in the workspace (the antivirus exclusion covers them) and go with the run. A short name
  directly under the run, for `MAX_PATH`. Removed at every end but `paused` (`finishWorktree`,
  `removeRunTmp` in `packages/engine/engine/worktree.js`, with or without a worktree); `cleanupWorktrees` removes
  the `tmp` of ended runs like their scratch (a live run or one waiting at a gate keeps it). A
  resumed run has its own id, so its own fresh `tmp`. The stray-process watcher attributes a process
  under `runs/<id>/tmp` to run `<id>` (`watchStrayProcesses` in `packages/engine/service/areas/runs.js`), and
  `walkFiles` skips `tmp/` (not artifacts). A mock run creates none.
- **One app per workspace (#112)**: `apps/desktop/host/main.js` takes Electron's single-instance lock (the owner's
  user data folder) and `<workspace>/.lock` (pid, host, heartbeat; `lockWorkspace` in
  `packages/engine/domains/run/run-owner.js`). A second copy offers a scratch copy or quit; a stale lock (dead pid, old
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
- The base comes from the run's inputs (`base_branch`): `prepareWorktree` refuses a base that is not
  a valid branch name (one starting with `-` would be a git option, `--upload-pack=<program>`), and
  `removeWorktree` ignores it with a warning; `git fetch` passes `--end-of-options` before the ref
  (SEC-23, #481). Git 2.24+ knows `--end-of-options`.

## Fewer merge conflicts between parallel runs (#77)

- Shared tables are generated from per-feature files (`npm run docs`, see the code map's header):
  the code map is gitignored, the README tables are committed with an out-of-date check. The
  channels of `window.api` are one file per area (`packages/engine/service/channels/`), and so are the
  service's helpers and state (`packages/engine/service/areas/`) and its tests (`packages/engine/test/service/`).
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
