---
order: 400
---

<!-- section:engine -->
### Transitions: limits and how a run ends

```yaml
transitions:
  - when: "output.tests_status == 'fail'"
    delegate: { agent: developer, prompt: "Fix: {{ output.failure_report }}" }
    goto: test
    max_visits: 3              # this transition, at most 3 times per run...
    on_exhausted: test_failed  # ...then here, WITHOUT the delegation (nothing would check that fix)
  - when: "rejected"
    goto: end
    status: failed             # the run's outcome: success (default), failed or cancelled
```

- `goto: end` ends the run as `success`. Add `status: failed` or `status: cancelled` when the run
  ends without delivering: a rejected failure gate is `failed`, a rejected merge or review is
  `cancelled`. `status` also applies when `on_exhausted: end` ends the run (e.g. the arena's redo
  limit), and is rejected on a transition that cannot end the run.
- The outcome is the `status` of the `workflow.finished` event and of `summary.json` (with an
  error such as `Run ended as failed at step "preview_failed" (choice == 'stop')`), and the
  `step.transition` event to `end` carries it. Like any failed or cancelled run, the worktree is
  kept so the run can be resumed, and the UI shows it as failed/cancelled.
- `goto: fail` still ends the run as `failed` with "retry limit reached"; it is the default of
  `on_exhausted`.
