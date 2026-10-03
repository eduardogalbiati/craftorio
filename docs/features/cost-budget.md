---
order: 152
---

<!-- section:engine -->
### Roadmap cost estimates and the spending budget

**Estimates before running** (#206, `src/cost-estimate.js`). Each roadmap item shows "≈ $X" and each
stage "≈ $Y" (the sum of its items). The tooltip says how it was computed and from how many runs.
An item's estimate comes from the last 30 successful real runs of its workflow in the project. Each
past run's cost is split by step (its sessions' `step_id`) and divided by its complexity (the
`complexity:n` labels of its issues, 3 for an issue without one). The estimate is the median per
step × the item's complexity. A step the item's inputs change is read from past runs with the same
inputs when there are at least 3, else scaled:
- the test step by `unit_tests` / `e2e_tests` (#203): run existing ×0.35, off ×0.25, E2E write and
  run ×1.3;
- the evidence step by `screenshots` (#205): changed ×0.75, off ×0.5. With screenshots off, the
  `developer_screenshots` step costs nothing.

So the Cost step shows up in the estimate through the inputs it sets and the size of its groups. An
item without history says "no estimate yet". Once an item has a run, its real cost shows next to the
estimate ("so far" while it runs). The Product Owner's plan answers show the plan's estimated total.
Codex reports no cost, so its sessions are priced from tokens × the model prices of Usage, and the
estimate is marked estimated.

**A budget that pauses before overspending** (Settings › General › Budget: `budget.dailyUsd` per
local day, `budget.nightlyUsd` per Night watch night, from its start; empty = no cap). Spending is
what real runs recorded (their sessions' `cost_usd`, live runs included). The cap stops starts,
never runs mid-way or gates. Before a roadmap starts a real item, if what is spent plus the item's
estimate would pass a cap, the roadmap pauses before it. You get a notification: "Budget reached:
$X of $Y today; next stage ≈ $Z". The roadmap bar then offers two buttons:
- **Raise for today** (or tonight): the cap becomes what is spent plus the next stage, for that day
  or that night only (`budget.raised`).
- **Resume anyway**: this roadmap ignores the cap until the day or the night ends (the roadmap's
  `budgetWaived`).

A run already started finishes, and no human gate is answered. The live roadmap's refills (#164)
and the Night watch's roadmaps respect the same cap. The top bar shows today's spending next to the
month's usage, "$38 / $60 today", or tonight's while the Night watch is on.
