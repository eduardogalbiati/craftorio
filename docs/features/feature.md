---
order: 100
---

<!-- section:workflows -->
## Feature (`workflows/feature.yaml`)

Code & Build (#630, #631). The development workflow: one issue (or several in one branch) from the
acceptance tests to the merge. It replaces `software-development`, its two local heroes and
`multi-model-review`: those old names still run, as `feature.yaml` with the inputs of the old
variant (`packages/shared/default-workflow.js`, `ALIASES`).

acceptance tests → red check → Warm Up → develop → code review → suite → build → evidence → verify → merge

| Stage | Agent | What it does | Skills |
|---|---|---|---|
| Acceptance tests | Test Writer (Opus 5.5) | The issue's tests from its criteria, not from the implementation, on the run's branch; with `test_order: e2e_first`, its E2E scenarios too. It gets the project's code → tests map (`test_map: true`). A task with nothing testable goes straight to develop | `unit-test-writer-<language>`, `e2e-test-writer-<language>` |
| Red check | (no agent) | Runs exactly those files once (`expect: red`). A test already green is reported to the developer; a file that cannot run goes back to the test writer once. The existing tests related to them come from the code → tests graph | |
| Warm Up | Mapper (the developer's model) | Before the first develop turn only, maps per issue the files and lines to change, the conventions and the tests to run (#301, #304); a failed Warm Up goes on without a map | `code-mapping` |
| Develop | Developer (Opus 5.5 or Fable 5.1) | Implements until the acceptance tests pass; the engine refuses a turn that changes one (`protect_files`), while the developer may add its own internal tests | `long-commands`, `bug-diagnosis`, `merge-conflict-resolver`, `context-economy`, `decision-log` |
| Code review | Code Review (Opus 5.5) | The diff on correctness, spec, standards and reuse; with `review: multi_model`, a second independent reviewer on another model in parallel | `code-review` |
| Suite | (no agent) | `scope: affected`: the test files the change reaches each round, then the whole suite once when they pass | |
| Build, evidence, verify | Builder, Evidence, Verifier | Build and dependency audit; what shows the change working (screenshots, requests, CLI output); the claims proven on the base and on the branch | `build-audit-<language>`, `implementation-evidence`, `claim-verification` |

The inputs that choose the run:
- `mode`: `local` (default) merges the run's branch into the local `base_branch` and pushes it (push
  main); `remote` pushes the branch, opens a PR/MR and waits for its CI (`git_platform`: `gh` or `gl`);
  the team merges it on the platform.
- `validation`: `auto` (default) goes from the developer straight to the review; `validated` stops at
  `developer_check` so you try the change first (an old `mode: auto | validated` still means this).
- `test_order`: `e2e_first` (default) writes the issue's E2E scenarios with the acceptance tests;
  `code_first` writes unit tests only.
- `review`: `single` (default) or `multi_model` (what `multi-model-review.yaml` did).
- `retrospective` (#631, off by default): when the run ends, `retrospective.yaml` analyses it (what the
  old `develop-to-retrospective` pipeline did; one more model call).
- `language`: `js`, `python`, `go`, `java`, `csharp` or `rust`, or several, main one first (#340);
  `developer_model` and `developer_effort` (#286); `unit_tests` and `e2e_tests` (#203).

Local mode:

<!-- generated:local-hero -->

<!-- /generated:local-hero -->

Engine options behind it: `orchestrator.worktree.remote: false`, a transition with `merge: local` and `on_error`, and `orchestrator.limits.max_total_context` (see `docs/agents/worktrees.md` and `docs/agents/engine.md`).

Human gates: `developer_check` in validated mode, a doubtful PR/MR comment in remote mode, and the
gates a run cannot get past alone (`merge_blocked`, `verify_failed`, `check_failed`). Agents never talk
to each other: the orchestrator (engine) hands failures to the developer and returns the result to
the agent that asked.

<!-- section:local-hero -->
- Each run still gets its own git worktree, started from your **local** `base_branch` (nothing is fetched, so a run sees the local merges of earlier runs you haven't pushed).
- **No merge approval**: once `verify_change` passes, the engine merges the run's branch into the local `base_branch` automatically: rebased onto it first if it moved (another run merged meanwhile), fast-forward only (linear history). The run's worktree and branch are then removed.
- **Conflicts are resolved automatically**: a failed merge goes to `resolve_merge`, where the developer rebases onto the local base and resolves the conflicts (skill `merge-conflict-resolver`). Then only what the resolution changed is checked again: the review covers the rebase against the last approved commit (`git range-diff`), the tests are the ones related to the files the resolution touched plus a smoke check (the full suite when it touched more than 5 files), the build runs, the verifier re-checks only the claims whose files were touched, and the merge is attempted right after. A resolution that changes behaviour (`behaviour_changed: true`) goes through the full review, suite and verification. Merges of concurrent runs go one at a time. At most 3 rounds; what the developer can't fix stops at the `merge_blocked` gate (retry / stop).
- **Merge conflicts in test files** (#380): a protected test file that only combines both sides is accepted; a test conflict that needs new or changed test lines is handed to the test writer, then the developer finishes the rebase.
- **E2E scenarios** (#143): the test writer writes end-to-end BDD scenarios only when the issue has user-visible behaviour, at most 3 per issue, and runs only the run's ones by their issue tag (`@issue-<n>`); the full E2E suite belongs to the release workflow.
