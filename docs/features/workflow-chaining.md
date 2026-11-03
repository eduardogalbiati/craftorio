---
order: 190
---

<!-- section:engine -->
### Chaining workflows: When it finishes

A run can hand its result to what comes next. The Start panel, the Backlog's Assign dialog and a
roadmap item's Edit form have an optional **When it finishes** choice:

- **Nothing** (the default).
- **Start a workflow with it**: pick the workflow; each of its inputs can take one of this run's
  declared outputs (e.g. `issues ← issues`, `task ← document`), proposed for the pair and editable,
  and its own short inputs (`mode`…) are set there too. Its folder, branch and language come from
  this run. The next run shows "← from <run>".
- **Ask the Product Owner to place it in the roadmap**: the Product Owner gets the produced issues
  and proposes where they go, as planned roadmap stages. Nothing starts until you press Start.
- **Plan the issues in the roadmap**: what the issue tracker's **Create and plan** does (it is the
  same chain, set by that gate choice): the produced issues become a new last roadmap stage with the
  chosen workflow, planned, never started by itself. A chain saved by an older version with the
  Backlog queue as its target plans the stage the same way.

Under the choice, the workflows that will run and a rough cost from your past runs, marked as an
estimate. The next step starts only when the run finished with **success** (a development workflow
must also have merged). A run that failed, was cancelled or stopped at a gate **pauses** its chain
with a notification: the Run screen's chain banner then offers **Resume chain**, **Edit** and **Drop
chain**. While the run goes, the banner edits or cancels the chain. Chaining never answers a gate:
each workflow's gates still wait for you. Simulated runs only chain simulated runs.

Each workflow declares what it hands over (`outputs:`, recorded in `summary.json`): issue
`issues`; write-doc `document`, `issue`; feature `branch`,
`merged_commit`, `issues`, `pr_url`; analyze-project `issues`, `report`; retrospective `findings`. The run
lists and the run chat show "→ then: <workflow>" on a chained run. Engine details:
[docs/agents/engine/chaining.md](docs/agents/engine/chaining.md).
