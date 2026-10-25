---
order: 152
---

<!-- section:engine -->
### Roadmap cost estimates and the spending budget

**Estimates before running** (#206, `src/domains/usage/cost-estimate.js`). Each roadmap item shows "≈ $X" and each
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

**The roadmap's summary** (#421, `src/shared/roadmap-summary.js`). The roadmap bar shows "Planned
≈ $X · ≈ T (n items, m stages)" for what is left: the items of the enabled stages that are not
finished, a running item for its estimate minus what its run has spent and elapsed (never below
zero). Disabled stages, done and skipped items are left out. Stages run one after another and a stage
lasts as long as its longest item, so the time is the sum of the stages' times: work time, human
gates not included. Items without an estimate are listed as "+ n without estimate" (the tooltip
names them), never counted as zero. "Spent $Y" next to it is the real cost of the roadmap's done and
running items, since its oldest item. With release cut lines (#260), **By release** lists each cut
line's stages (from the previous line) plus its release run when the release workflow has history,
then the part after the last line.

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
