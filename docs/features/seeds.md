---
order: 150.9
---

<!-- section:engine -->
### Analysis seeds

Analyses written as prompts, run on any project (#360). A **seed** (`seeds/<name>/seed.md`, seeded
into the workspace like skills; an edited copy is kept) says what it produces, its data and layout
rules, a VERIFY section and what to report back. Four come bundled, adapted from Kent Beck's
ToolSeeds (MIT): `churn-complexity`, `dependency-map`, `quality-gate-report` and
`pipeline-anatomy`.

The **Seeds** section of **Projects › a project › Architecture** lists them with their last run's
date, cost and status (never run, running, stale with the commits since, error, tool available).
**Run** shows the cost estimate first, then the Oracle runs the seed read-only on the project in one
turn of its daily budget. The result, a self-contained HTML page and a JSON model with secrets
scrubbed, is saved as `architecture/<project id>/seeds/<seed>/<date>/` in the workspace;
**Open result** shows it in a sandboxed frame with no network, and **History** lists the earlier
runs.

**Make it a tool** has the Product Owner file an issue in the project's tracker (a preview in
simulation) to build the seed as a deterministic tool in the project's repository: a pure core with
I/O at the edge, network data fetched by a separate step into a cache, JSON with sorted keys and
commit timestamps, a golden test and the seed's VERIFY steps as tests. Once the tool's command is
recorded in the project's settings (`seedTools`), running the seed runs that command instead, free.
A seed reads the network only as it declares, through the platform adapters (the CI's recent runs:
`gh run list` / the GitLab pipelines API). Nothing crosses a human gate.
