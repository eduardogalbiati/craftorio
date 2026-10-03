---
order: 700
---

<!-- section:workflows -->
## Run retrospective (`workflows/run-retrospective.yaml`)

Monitor & Improve. Given a `run_id` (default `latest`: the most recent run of another workflow;
an id with no run folder is refused before the run starts), reads that run's `events.jsonl`, sessions,
`decisions.tsv` and `summary.json` with the `run-retrospective` skill, and proposes
evidence-backed edits to skills and workflows (`retrospective.md`, also copied into the analyzed
run's folder). It only proposes; a human applies.
