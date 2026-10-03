---
order: 110
---

<!-- section:workflows -->
**Modes: automatic or validated** (input `mode`, in the Start drawer next to the task, the
Backlog's **Assign to a workflow** dialog and the Workflows screen; remembered per workflow and
shown in the run's Details). `auto` (default) goes from the developer straight to the review, as
above. `validated` stops right after the developer at the `developer_check` gate, before any review
or test token is spent: its message has the developer's summary, the issues (done / not done), the
files changed, the commits on the branch, the diff command, the `test_notes` and `evidence_plan`,
and the worktree path and branch. On a wide window the gate has two columns: on the left a short
list (the summary and one line per issue: done / not done, the full message expandable), the
tools and the choices; on the right the run's **Artifacts** so far, newest first (handoff notes,
`decisions.tsv`, documents, screenshots), the **changed files** (each opens its diff) and the
developer's test notes and evidence plan, each previewed in place. Try it (**Run App**, **Open
the worktree**, **Terminal there**), then:
- **Approve**: on to `code_review`;
- **Ask for changes** (needs a text): the developer gets it as your change request, fixes it on the
  same branch with a new commit, answers each point, and the run comes back to `developer_check`.
  No automatic limit: you decide when to stop;
- **Stop**: ends the run (`cancelled`); its branch keeps the work to resume it.

Only the first implementation and your own change requests stop there; the reviewer's, the tests',
the build's and the verifier's fix rounds go on without it, unless **Validate every round** is on (`validate_every_round: true`, a switch shown under Validated).
It is a human gate: no timeout, no supervisor, no retry ever answers it. The time a run waits for
you at its gates is recorded apart from agent time (`summary.timing.gate_wait_ms`, the Details
panel and the Time tooltip).

<!-- section:local-hero order:210 -->
- **Modes**: the same `mode: auto | validated` as `software-development`. In `auto` nothing waits for you (the run merges locally by itself); in `validated` the run stops at `developer_check` after the developer so you try the change (Run locally, Open the worktree) and approve it or ask for changes before the review and the tests. `human_review` offers Run locally too.
