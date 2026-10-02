---
order: 200
---

<!-- section:workflows -->
## Software development, local hero (`workflows/software-development-local-hero.yaml`)

The same develop → code review → test → build → verify pipeline as `software-development`, for working fast on your machine without GitHub or GitLab: no push, no PR/MR, no CI, no preview, no deploy.

<!-- generated:local-hero -->

<!-- /generated:local-hero -->

Engine options behind it: `orchestrator.worktree.remote: false`, a transition with `merge: local` and `on_error`, and `orchestrator.limits.max_total_context` (see `docs/agents/worktrees.md` and `docs/agents/engine.md`).

<!-- section:local-hero -->
- Each run still gets its own git worktree, started from your **local** `base_branch` (nothing is fetched, so a run sees the local merges of earlier runs you haven't pushed).
- **No merge approval**: once `verify_change` passes, the engine merges the run's branch into the local `base_branch` automatically: rebased onto it first if it moved (another run merged meanwhile), fast-forward only (linear history), never pushed. The run's worktree and branch are then removed.
- **Conflicts are resolved automatically**: a failed merge goes to `resolve_merge`, where the developer rebases onto the local base and resolves the conflicts (skill `merge-conflict-resolver`). Then only what the resolution changed is checked again: the review covers the rebase against the last approved commit (`git range-diff`; findings on untouched code are not blocking), the tests are the ones related to the files the resolution touched plus a smoke check (the full suite when it touched more than 5 files), the build runs, the verifier re-checks only the claims whose files were touched, and the merge is attempted right after. A resolution that changes behaviour (the developer answers `behaviour_changed: true`) goes through the full review, suite and verification. Merges of concurrent runs go one at a time. At most 3 rounds; what the developer can't fix, such as uncommitted changes in the checkout where the base is checked out (your work), stops at the `merge_blocked` gate (retry / stop).
