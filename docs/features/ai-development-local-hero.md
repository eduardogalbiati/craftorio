---
order: 205
---

<!-- section:workflows -->
## AI Development, local hero (`workflows/ai-development-local-hero.yaml`)

The local-hero pipeline with the tests written **first** (#220): acceptance tests → red check → develop → code review → suite → build → verify → local merge. No push, no PR/MR, no CI.

- **Acceptance tests before the code**: the test writer (Opus 5.5) writes the tests of the issue from its criteria, not from the implementation, on the run's branch. It gets the project's code → tests map (`test_map: true`) to put them where they belong. A task with nothing testable goes straight to develop.
- **Red first, really**: the orchestrator runs exactly those files once (a suite step with `files` and `expect: red`, no agent). A test already green before any code is reported to the developer (it guards existing behaviour or is wrong); a file that cannot run goes back to the test writer once. The existing tests related to them come from the code → tests graph and are given to the developer, not guessed.
- **Locked for the developer**: the engine refuses a developer turn that changes an acceptance test (`protect_files`), while the developer may add its own internal tests; the reviewer checks the files are unchanged too.
- `unit_tests` defaults to `run_existing` (the suite after the review, no second test-writer step) and `e2e_tests` to `off`. Reviewer and test writer run on Claude Opus 5.5.
