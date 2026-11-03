---
order: 200
---

<!-- section:workspace-tree -->
  index.db   SQLite index next to the files: runs cache, pending gates, notifications

<!-- section:workspace -->
- **The files are the source of truth; `index.db` is an index next to them** (built into Node, no
  extra dependency). It caches the run list (Workflows › Runs, Projects, Usage and Analytics read it
  instead of every run folder), records the gates waiting
  for you (after a restart, gates of runs that did not survive show as interrupted) and every
  notification (the bell at the top right of the header: history, unread count, mark as read; kept for
  **Settings › Execution › Keep notifications** days). Deleting it loses no run and no planned issue (only the notification history): the app rebuilds it
  at the next start, and **Settings › General › Index › Rebuild index** reads every run again.
  Details: `docs/agents/storage.md`.
