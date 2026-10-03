---
name: backlog-refresh-gh
description: Reads a GitHub repository's open issues, closed issues and merged pull requests with the gh CLI (read-only) for a backlog refresh; the workflow applies the answer with the shared skill's apply.js --platform gh. Use in the backlog-refresh workflow on a GitHub project.
uses: [backlog-refresh]
summary: "Backlog refresh on GitHub: read issues and PRs with `gh`, apply.js --platform gh"
used_by: "backlog-refresh (refresher)"
---

# Backlog refresh: GitHub (gh CLI)

Follow the shared **backlog-refresh** skill. On GitHub, read with `gh` only (one command per call):

- Open issues with their body and `updatedAt`:
  `gh issue list --state open --limit 200 --json number,title,body,labels,updatedAt`
- One issue: `gh issue view <n> --json number,title,body,labels,updatedAt,state`
- Closed issues and merged PRs since a date:
  `gh issue list --state closed --search "closed:>=<YYYY-MM-DD>" --json number,title,closedAt`,
  `gh pr list --state merged --search "merged:>=<YYYY-MM-DD>" --json number,title,mergedAt,files`

`updated_at` in your answer is `updatedAt` copied exactly (e.g. `2026-10-01T21:24:59Z`).
You never edit, comment, label or close: the workflow runs
`node <backlog-refresh folder>/apply.js --platform gh ...` with your answer (GitHub keeps every earlier body).
