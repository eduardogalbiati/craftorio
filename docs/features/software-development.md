---
order: 100
---

<!-- section:workflows -->
## Software development flow (`workflows/software-development.yaml`)

| Stage | Agent | Model | What it does | Skills |
|---|---|---|---|---|
| Build & Test | Developer | Opus 5.5 | Implements and fixes everything the other agents report, in production code only: it never writes or runs the test suite and says what to test in `test_notes`. Always branches from a freshly fetched `origin/<base_branch>`. Handoff session: each fix round starts fresh from its handoff note | `long-commands`, `bug-diagnosis`, `merge-conflict-resolver`, `context-economy`, `decision-log` |
| | Code Review | Codex gpt-6-luna | Reviews the diff on correctness, spec and standards, plus a reuse pass (a rule or mapping that already exists elsewhere is major); requests changes only for blocker/major | `code-review` |
| | Test Writer | Sonnet 5 | Owns the tests: writes/updates them (from the developer's `test_notes`) and runs the full suite, the only full run before CI; production-code failures go back to the developer. | `unit-test-writer-<language>` |
| | Evidence | Sonnet 5 | After the build, collects what shows the change working, picked by the kind of change: UI screenshots before/after (in the run's `screenshots/` folder, shown in Artifacts), HTTP requests with their responses, CLI output or log lines of a simulated run. Local and simulated only; never blocks, the verifier uses it | `implementation-evidence` |
| | Builder | Sonnet 5 | Build + dependency audit, no test suite; a broken build or a high/critical production vulnerability goes back to the developer | `build-audit-<language>` |
| | Verifier | Sonnet 5 | Proves the change does what the task asked: same command on the base and on the branch (no full suite); `not_verified` goes back to the developer, `inconclusive` does not block | `claim-verification` |
| CI/CD | CI Pusher | Sonnet 5 | Push, opens the PR/MR, **/goal** CI green with **/loop**; on failure fetches the log and calls the developer. A PR/MR that conflicts with the base (CI never starts) is reported as failed on the first visit. Posts the evidence step's screenshots on the PR/MR (one comment, before/after) | `ci-pipeline-<platform>`, `pr-screenshots-<platform>` |
| | PR Babysitter | Opus 4.8 | **/goal** PR/MR mergeable with **/loop**; actionable comments → developer (replies with the hash), doubtful ones → human | `pr-babysitter-<platform>`, `decision-log` |
| | Deployer | Sonnet 5 | Publishes the preview, and after the merge tracks the production deploy. A failure carries `failure_class` (`code`, `infra`, `unknown`): a preview `code` failure goes to the developer, then CI, the PR check and the preview run again (2 rounds at most) | `deploy-<platform>` |

Two inputs choose the skills:
- `language`: `js`, `python`, `go`, `java`, `csharp` or `rust`, or several, main one first
  (`js,rust` for a repository that mixes them, #340). With several, the test writer and the builder
  load the skills of each language whose files the run changed (a JS-only change gets only the JS
  skills); before anything changed (acceptance tests written first), all of them. The Start panel
  shows one toggle per language and preselects every language found in the project's files.
- `git_platform`: `gh` (GitHub, `gh` CLI) or `gl` (GitLab, `glab` CLI). This also picks the merge
  command at the approval gate.

Only the test writer writes tests. The developer has `edits_tests: false`: after each of its turns
(the `develop` step and every fix delegated to it) the engine checks what the turn changed (its
new commits, base excluded, and uncommitted files) against the workflow's `tests_paths` (default:
the usual test folders and file names of every language, e.g. `**/test/**`, `*.test.*`,
`*_test.go`, `test_*.py`, `*Tests.cs`, `**/src/test/**`), and sends the turn back with the list of
files, twice at most before the step fails. Claude also gets them as `Edit(...)` deny rules.

Human gates: a doubtful PR/MR comment (fix / justify / ignore) and the merge, which produces
the production release. Agents never talk to each other: the orchestrator (engine) hands
failures to the developer and returns the result to the agent that asked.
