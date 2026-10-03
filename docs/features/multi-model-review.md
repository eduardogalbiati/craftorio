---
order: 400
---

<!-- section:workflows -->
## Multi-model code review (`workflows/multi-model-review.yaml`)

Reviews an existing branch without changing anything or posting to the PR/MR.

| Stage | Who | What it does |
|---|---|---|
| review | Opus 5.5, Sonnet 5, gpt-6-luna **in parallel** | Each reviews the diff with `code-review` (`review/<agent>.json`) |
| blast_radius | Sonnet 5 | `blast-radius`: consumers outside the diff and the key safety fact, proven by running code |
| judge | Opus 5.5 (own session) | `review-synthesis`: reads the diff, merges and verifies the anonymized findings into act on / consider / noted / dismissed, with a verdict (`review.md`) |
