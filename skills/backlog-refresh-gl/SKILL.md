---
name: backlog-refresh-gl
description: Reads a GitLab project's open issues, closed issues and merged merge requests with the glab CLI (read-only) for a backlog refresh; the workflow applies the answer with the shared skill's apply.js --platform gl. Use in the backlog-refresh workflow on a GitLab project.
uses: [backlog-refresh]
summary: "Backlog refresh on GitLab: read issues and MRs with `glab`, apply.js --platform gl"
used_by: "backlog-refresh (refresher)"
---

# Backlog refresh: GitLab (glab CLI)

Follow the shared **backlog-refresh** skill. On GitLab, read with `glab` only (one command per call),
always with `--repo <repository>`, the URL your prompt names (the clone's origin may be a local folder,
where `glab` finds no project):

- Open issues with their description and `updated_at`:
  `glab issue list --repo <repository> --opened --per-page 100 --output json` (the body is `description`)
- One issue: `glab issue view <iid> --repo <repository> --output json`
- Closed issues and merged MRs: `glab issue list --repo <repository> --closed --per-page 100 --output json` and
  `glab mr list --repo <repository> --merged --per-page 100 --output json`, filtered on `closed_at` / `merged_at`
  for the window since `since`.

Issue numbers are the project's `iid`. `updated_at` in your answer is the issue's `updated_at`
copied exactly. Labels are scoped the same way as on GitHub (`complexity:<n>`).
You never edit, comment, label or close: the workflow runs
`node <backlog-refresh folder>/apply.js --platform gl ...` with your answer (GitLab keeps the
description history). Closing on GitLab adds the reason as a note, then closes.
