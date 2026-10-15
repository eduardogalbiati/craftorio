---
order: 195
---

<!-- section:engine -->
### A workflow as a step (child runs)

A step can run another workflow, once or once per item of a list, and use its outputs:

```yaml
- id: develop
  type: workflow
  workflow: software-development.yaml
  inputs: { task: "{{ item.title }}", repo_path: "{{ inputs.repo_path }}" }
  foreach: "{{ steps.plan.output.issues }}"   # optional: one child run per item
  max_parallel: 2                             # optional, with foreach (default 1)
```

Each child is a normal run (its own folder, worktree, sessions and gates), listed under its parent;
the Run screen links both ways. Its gates wait for you, and so does the parent.

- **Limits and cost**: a child takes a slot of Settings › Execution › Concurrent runs like any run;
  its parent, which only waits, lends it its own slot. When no slot is free the child waits for one
  instead of failing (with a limit of 1 the children run one at a time). Children count in the
  monthly budgets. Each child has its own context limit (`max_total_context`); the parent's
  `max_total_cost_usd` includes what its children cost. The run lists and the Run screen show the
  children's total cost next to the parent's own.
- **Stop and resume**: stopping the parent stops its running children, and the Stop button asks
  first. Resuming the parent from that step reuses the children that succeeded and resumes the
  others from where they stopped (gates still ask again), instead of starting them from scratch.

Engine details: [docs/agents/engine/workflow-step.md](docs/agents/engine/workflow-step.md).
