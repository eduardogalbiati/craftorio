---
order: 151
---

<!-- section:engine -->
### Agents: calibrating the Product Owner

How the Backlog's Product Owner trades speed for quality when it plans is the owner's call: a
**Speed ↔ Quality** slider with five steps, in Agents › Product Owner (its **Planning** section,
saved with Save) and in the Product Owner's drawer (the settings button next to **Clear**: a panel
over the conversation, with the model and the effort too; each change saves at once and applies to
the next answer). Both edit the same setting, `calibration` (1-5, default 2) in
`<workspace>/agents/product-owner.json`. Each step's tooltip (hover or keyboard focus) and the text
under the slider say what it prioritises:

| | Speed (1) | 2 | Balanced (3) | 4 | Quality (5) |
|---|---|---|---|---|---|
| parallel runs per stage | as many as do not share files | up to 4 | up to 3 | up to 2 | 1-2 |
| max complexity per group | 6 | 6 | 5 | 5 | 4 |
| UI issues mode | auto unless the owner asks | validated for new screens | validated for new screens | validated for any screen | validated for any screen |
| placement | earliest stage without shared files | earliest stage without shared files | after the work it builds on | after the work it builds on | its own stage after the most stable base |
| review rounds | - | - | - | - | a developer self-review (#179) when the workflow has it |

The Product Owner's prompt states the step and its parameters (they replace the skill's defaults),
the simulated Product Owner follows them, and every plan answer is kept to the step's runs per stage
(a stage with more groups is cut into consecutive stages) with a warning on a group over its
complexity. Plan questions in the drawer, the Oracle's questions to the Product Owner, the "place it
in the roadmap" chain step and the live roadmap's refills all use the saved step, so Add to roadmap
applies groups planned with it. Each answer shows the step it planned with ("Planned for Speed").

**For one question only**: the chip next to the settings button shows the step of the next
question; pick another one there, or write it in the question ("plan this one for quality"), and
only that question uses it: the saved setting does not change.

**The second axis, Cost: Economy ↔ Generous** (#205). Most of a run's cost is decided when the work
is planned: how many runs (each pays a fixed overhead), which tests run (#203) and which models the
agents use. A second five-step slider sits under Speed ↔ Quality in both places (same tooltips and
"what this step does" line), saved as `cost` (1-5, default 3) in the same file:

| | Economy (1) | 2 | Balanced (3) | 4 | Generous (5) |
|---|---|---|---|---|---|
| max complexity per group | 8 | 7 | the Speed ↔ Quality step's | 5 | 4 |
| grouping | issues of one area or files packed into one run ("grouped to pay the run overhead once") | the same | as Speed ↔ Quality plans | as Speed ↔ Quality plans | as Speed ↔ Quality plans |
| `unit_tests` | run existing, then a `test-backfill` item after the stage | write and run | write and run | write and run | write and run |
| `e2e_tests` | write | write | write | write | write and run |
| `screenshots` | off | changed screens | changed screens | all | all |
| agents | cheaper models and a medium effort where the workflow has an input for them | the same | the workflow's | the workflow's | the workflow's |

When the two sliders disagree, cost wins: the group cap is the Cost step's (Speed + Economy gives
fewer, larger runs); the runs per stage stay the calibration's. The orchestrator applies the step to
every planned group, whatever the model wrote: it packs a stage's groups that share an area (name,
files, epic or topic label) within the cap, sets `unit_tests`, `e2e_tests` and `screenshots` when the
group's workflow declares them, and at Economy adds a stage with one `test-backfill` item for the issues
that ran with their existing tests only (a test-backfill item may name issues another item holds, and
runs even when they are closed). An input a workflow does not declare is not adjustable: the group
says so (the bundled development workflows have no model or effort input, so "agents: not
adjustable"), and no workflow is edited. Each group, and the roadmap item added from it, carries a
cost badge with these choices; you can still change the item's inputs. Each plan answer shows both
steps ("Planned for Speed · Economy") and the plan's estimated total. For one question: the Cost chip
next to the calibration chip, or "plan this one cheap" in the question.

**Screenshots on or off** (`screenshots` input of both development workflows, #205): `all` (the
default: as before), `changed` (only the screens the issue changes, original and modified) or `off`
(no `developer_screenshots` step, no `npm run screenshot` by the test or evidence agents: the evidence
is the diff, the logs and the test results, and the gates say "Screenshots: off"). The evidence step
costs about $0.3-1.5 and 5-10 minutes of Electron time per run.

To measure: compare $/run and $/issue over a week at Economy with the baseline of 2026-10-01/02
(~$11.7-11.9 per run, the test step about half of it), from the runs' `summary.json` or Usage.
