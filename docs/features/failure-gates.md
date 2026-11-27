---
order: 130
---

<!-- section:workflows -->
Failure gates (a step that ran out of fix rounds, or a failure no commit can fix) only offer what
can change the outcome:

| Gate | Options |
|---|---|
| `test_failed`, `verify_failed` | continue anyway / stop (`failed`) |
| `build_failed` (also reached at once by an `infra` build failure, e.g. a file locked by a running process) | continue to verification anyway / build again (after fixing the environment) / stop (`failed`) |
| `ci_failed` | one more fix round by the developer / check CI again (stuck or flaky pipeline) / stop (`failed`) |
| `preview_failed` | publish the same commit again (infrastructure) / send it to the developer (then CI, PR check, preview) / stop (`failed`) |
| `merge_failed` (a merge that failed for another reason than a conflict, a blocked developer, or 2 conflict rounds) | merge now (checked right before) / send it to the developer to resolve / stop (`failed`) |
| `deploy_failed` (after the merge) | new development cycle / track the deploy again (after re-running it yourself) / stop (`failed`) |
| `human_review`, `approve_merge` | rejecting ends the run as `cancelled` |

Once a fix loop reaches its limit the engine goes to the gate without asking for yet another fix,
and a gate never re-runs the same failed thing as the only way forward.

A suite red only outside the change (#396): every counted failure of the suite says whether it is
**in the change** (its test file is changed or reaches a changed file through the import graph) or
**outside the change** (it reaches none, passes alone, or fails or hangs on the base too), with the
reason, in the gate's summary. AI Development (local hero) has the input **Suite red outside the
change**: *Ask* (default) opens `test_failed` as for any red suite; *Continue* lets such a run go on
to the build and the merge without the gate. A failure in the change always opens it. A run that
reaches the build without a green suite (the policy, or your Continue at the gate) shows a **Not
tested green** badge on the Run screen and in its chat, `tested: "not green"` with the failures in
its `summary.json`, and its build and verification prompts get the failures.

A project with no tests (#71): no test command is found and the project has no test file, so there is
nothing to run. The suite ends **not run: the project has no tests** and the run goes on without
`test_failed` (Feature) or `verify_failed` (Fix), with `tested: "no tests"` in its `summary.json`. The
Run screen, its chat, the roadmap item, the pull request's text and the base check say **Not tested:
the project has no tests**, never Not tested green. The input **A project with no tests**
(`no_tests`) set to *Ask* keeps the gate: its recommendation tells the supervisor on call that only
you answer it, and in Fix your Approve goes on to the verification, never straight to the merge. A project with no test runner (no `test_command` given and
none found: a plain HTML site, a Markdown-only repository) is decided when the run starts: the test
writer writes no test file, the test steps are skipped, and the build and the verification still run,
reported as **Not tested: no test command** (`tested: "no test command"`); test files found with no
known command go on the same way. If the project does have a runner Craftorio does not know, set
`test_command`. When the supervisor on call answers a gate itself, the Run screen and the
chat say so, with the answer; it is told the gate's own recommendation and says why when it differs.
It answers alone only with the gate's recommended answer or one that merges and pushes nothing
(retry, stop); "the failures are pre-existing" counts only when the engine confirmed every failure on
the base (#211). Any other answer opens the gate for you, with the supervisor's answer and reason
under the workflow's recommendation (#124); the morning summary lists the gates it answered alone.
