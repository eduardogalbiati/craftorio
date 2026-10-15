---
order: 205
---

<!-- section:workflows -->
## AI Development, local hero (`workflows/ai-development-local-hero.yaml`)

The local-hero pipeline with the tests written **first** (#220): acceptance tests → red check → Warm Up → develop → code review → suite → build → verify → local merge. No push, no PR/MR, no CI.

- **Acceptance tests before the code**: the test writer (Opus 5.5) writes the tests of the issue from its criteria, not from the implementation, on the run's branch. It gets the project's code → tests map (`test_map: true`) to put them where they belong. A task with nothing testable goes straight to develop.
- **Red first, really**: the orchestrator runs exactly those files once (a suite step with `files` and `expect: red`, no agent). A test already green before any code is reported to the developer (it guards existing behaviour or is wrong); a file that cannot run goes back to the test writer once. The existing tests related to them come from the code → tests graph and are given to the developer, not guessed.
- **Warm Up** (#301): before the first develop turn only, a read-only agent (the mapper, skill `code-mapping`, on the developer's model and effort) maps per issue the files and line numbers to change, how they connect, the conventions and the tests to run for each file (#304: direct, then transitive, from the code → tests map, as a `run-tests` block). The developer reads only what the map names and the test step runs the map's tests; a Warm Up that fails or times out goes on to develop without a map.
- **Affected suite** (#304): the suite step runs with `scope: affected`: each round the test files the change reaches (plus the ones that failed before), then the whole suite once when they pass. The Run screen's suite card and Analytics › Run's suite rounds show the scope and why each file ran.
- **Locked for the developer**: the engine refuses a developer turn that changes an acceptance test (`protect_files`), while the developer may add its own internal tests; the reviewer checks the files are unchanged too.
- **Merge conflicts in test files** (#380): when the local merge conflicts, Merge & Resolve rebases the branch. A protected test file that only combines both sides (every line from the branch's or the base's version, nothing either side added dropped) is accepted. A test conflict that needs new or changed test lines is left in the rebase and handed to the test writer, then the developer finishes the rebase: the developer still never writes tests.
- `unit_tests` defaults to `run_existing` (the suite after the review, no second test-writer step) and `e2e_tests` to `off`. Reviewer and test writer run on Claude Opus 5.5.
- **Developer model and effort** per run: `developer_model` (Opus 5.5 or Fable 5.1, 3x turn timeout from the workflow's `models`; any agent's model can also be chosen in the Start drawer's Agents, #262) and `developer_effort` (#286: `default` passes no `--effort`, the CLI's own effort for the model; `low` to `xhigh` are passed as `--effort`, `xhigh` doubles the turn timeout). The reviewer runs at `effort: high`, passed through the providers' `effort_args`. The Product Owner's Cost step leaves the developer's effort alone.
