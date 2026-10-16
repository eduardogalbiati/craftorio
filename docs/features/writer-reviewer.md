---
order: 500
---

<!-- section:workflows -->
## Writer & Reviewer (`workflows/writer-reviewer.yaml`)

Plan & Design. Give it a **prompt** (what to write) and a **goal** (when it is good enough), and
pick the CLI, model and effort of the writer and of the reviewer. Optionally pick a **project**: the
writer and the reviewer then work in its folder and read its files (read-only) to ground the document;
the run shows up under that project. The **Write & Review** screen
(sidebar, "lab") starts it and shows the run as a chat between the agents, with a robot per model.

| Stage | Who | What it does |
|---|---|---|
| write | writer (your pick) | Drafts the document, then revises it with the notes (`drafts/vN.md`, `document.md`) |
| review | reviewer (your pick) | Scores the draft 0-10 against the goal and lists major/minor notes. The engine approves at the threshold (default 8), otherwise back to write, up to `max_rounds` reviews |
| signoff | supervisor (Opus 5.5, internal) | Checks the approved draft against each part of the goal and reports to you with a recommendation |
| decide | you, asked by the supervisor | Accept, send it back to the writer, or stop; plus optional instructions (e.g. "keep the pricing open") |
| out_of_rounds | you | When the rounds run out: accept the last draft, one more round, or stop; plus optional instructions |

Whatever you write at these questions goes into every later prompt of the writer, the reviewer
and the supervisor, and takes precedence over the goal where they conflict.

Past runs open as a chat again from Workflows › Runs › **Open run**, then its **Chat** tab.

**Document type** (optional, the `document_skill` input): the skill the writer and the reviewer load,
with its structure and rubric: `issue-writing` (an enriched issue), `rfc-writing`, `prd-writing`,
`design-doc-writing`, or your own. Empty, the document is free-form, as before.

<!-- section:workflows order:520 -->
**Simulation** (Settings › Execution › **Developer mode**): shows the "Simulation" checkboxes, checked
by default, and a **Scenario** picker on Write & Review: approved on the 3rd review (5.5 → 7 → 8.6),
approved on the 1st review, never reaches the score (rounds run out), the supervisor finds gaps in the
approved draft, and the reviewer answers in the wrong format (asked again twice, then the supervisor
steps in). Without developer mode every run is real.
