---
order: 300
---

<!-- section:workflows -->
## AI Arena (`workflows/ai-arena.yaml`)

Up to five models write the same document (default: a PRD) and an orchestrator merges them. The
**AI Arena** screen (sidebar, "lab") starts it: pick 2 to 5 contenders (CLI, model and effort of each),
an optional **project** (read-only for the models; a copy of the final document is saved in it),
reference documents to attach (text files every model reads), the document type (PRD, design doc,
RFC, ADR, test plan, design sketch), blind peer review and lenses. It shows the run as a chat: each contender posts its
proposal and its scores for the others (with the real author of each anonymized proposal, which only
you see), the synthesizer posts the final document, the verifier its verdict, and the supervisor asks
you to accept, redo (with optional instructions for the synthesizer) or discard. A **Peer scores**
panel ranks the contenders; past runs open as a chat from Workflows › Runs › **Open run**, then its **Chat** tab.

| Stage | Who | What it does |
|---|---|---|
| compete | up to 5 contenders **in parallel** (default: Opus 5.5, Sonnet 5.5, gpt-6-luna, Grok 4.7) | Each writes the document without seeing the others, plus a short rationale (alternatives rejected, assumptions), and is told not to drift to a safe middle ground (`arena/proposals/<agent>.md`). With `lenses: on`, each works under a different forced lens (user value, lean MVP, risk first, feasibility first, evidence first) |
| critique | the same, in parallel (`peer_review: yes`) | Each scores the **others'** anonymized proposals and says what it would change in its own |
| synthesize | synthesizer (Opus 5.5, own session) | `arena-synthesis` skill: picks the best proposal as the **base** and grafts the best ideas of the others; convergence/divergence check; opinionated conflict decisions; appendix with scoreboard, base, grafts, rejected ideas, dismissed critiques and dropouts |
| verify | verifier (gpt-6-luna, another family, fresh session) | Checks the final document against the document skill and the proposals (missing sections, contradictions, unsupported claims, dropped consensus); on issues, one more synthesis round |
| review | human | Sees the verifier's verdict and who wrote each proposal; accepts, asks for a new synthesis (2 at most, with optional instructions; a 3rd request ends the run as failed) or discards it (cancelled) |

Proposals are anonymized as "Proposal N" in an order shuffled per run (the `shuffle(run_id)`
template filter), the same in every step, so position and labels do not give the model away.
Base-and-graft, the verify step and the rationale/anti-hedging instructions adapt ideas from the
arena skill in [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack) (MIT).

The final document goes to `<run>/arena/final.md` in the workspace. A copy goes into the project only when the `save_to` input names a subfolder (e.g. `docs/arena`); it is empty by default.
Its format comes from the skill in the `document_skill` input (default `prd-writing`): for an ADR,
tech spec and so on, create a skill with the structure and the rubric and pass its name. The
contenders are five slots (`contender_1` … `contender_5`) set by the inputs `contender_N_provider`,
`_model` and `_effort`; provider `none` leaves a slot out (the agent's `enabled`).
