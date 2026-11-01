---
order: 700
---

<!-- section:workflows -->
## Retrospective (`workflows/retrospective.yaml`)

Monitor & Improve (#631; the old `run-retrospective.yaml` name still runs it). Given a `run_id`
(default `latest`: the most recent run of another workflow; an id with no run folder is refused before
the run starts), reads that run's `events.jsonl`, sessions, `decisions.tsv` and `summary.json` with the
`run-retrospective` skill, and proposes evidence-backed edits to skills and workflows
(`retrospective.md`, also copied into the analyzed run's folder; the `findings` output). It only
proposes; a human applies. Feature's `retrospective` input chains it on the run that just ended.
