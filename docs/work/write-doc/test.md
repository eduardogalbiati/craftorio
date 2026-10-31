---
item: write-doc
issue: "#636"
stage: test
status: not started       # filled by the runs: suite, E2E, screenshots, evals
approver: code owner (at the PR or the developer's gate)
translation: test.pt-BR.md
---

# Test: write doc evidence

This stage has no file a person writes: it gathers the evidence the runs produce, so the code owner approves by looking at what was proven. It stays empty until the first Build run.

## Suite and tests

Each run adds a row: the unit suite, the tests written (E2E first for a feature, when there is an E2E suite) and the result.

| Run | Unit | E2E | Result |
|---|---|---|---|
| — | — | — | nothing yet |

## Before and after screenshots

The original/modified pairs of the `screenshots` step, with the axe checks (contrast, target size). The editor's screens go here: Documents, the editor with a selection, changes by request, review and the sign-off gate.

## Evals

Only in the Full work model: the result of the skills' and workflows' evals in CI, and whether the change lowered the pass rate.
