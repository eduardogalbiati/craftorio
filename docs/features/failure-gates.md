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
