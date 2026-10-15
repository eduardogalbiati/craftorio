---
order: 500
---

<!-- section:engine -->
### Step groups: progress in the runs list

```yaml
groups:                        # optional; the graph ignores it (transitions still name step ids)
  - name: Develop
    steps: [develop]
  - name: Review
    steps: [code_review, human_review]
  - name: Validate
    steps: [test, test_failed, build, build_failed, evidence, verify_change, verify_failed]
```

- Each run in the runs lists (Workflows › Runs, Projects › a project) shows the groups it has
  visited so far, in order: the robot of each agent that worked there (a person for a human gate;
  hover for step, agent, provider/model, duration and cost), the group name and its state: ✓ done,
  the step running, "waiting for you" at a gate, ✕ and the step where the run failed. Coming back
  to a group shows it as "Develop ×2".
- The Run screen's sidebar lists only the steps that ran, one collapsible section per group (the
  current step's group open); "Show all steps" adds the others.
- A step in no group is shown on its own, by its readable name; a workflow without `groups:` shows
  each visited step. `loadWorkflow` rejects unknown step ids, a step in two groups and duplicate
  group names.
- Names on screen (#245): a step or an agent may set `display: "Final verification"` (1 to 40
  characters); without it the screens make the id readable (`acceptance_tests` → "Acceptance
  tests"). The id stays in the tooltip; prompts, events and transitions keep using the ids. The
  Workflows editor edits it ("Display name").

  ```yaml
  agents:
    verifier:
      display: Final verifier
  steps:
    - id: verify_change
      display: Final verification
      agent: verifier
  ```
- The engine records the groups in `workflow.started` and, in `summary.json`, `progress`: the step
  visits in order with their agents, status, duration and cost. Runs without it (in progress,
  interrupted, older) get it from `events.jsonl`.
