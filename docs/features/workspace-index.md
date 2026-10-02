---
order: 200
---

<!-- section:workspace-tree -->
  index.db   SQLite index next to the files: runs cache, Backlog queues, pending gates, notifications

<!-- section:workspace -->
- **The files are the source of truth; `index.db` is an index next to them** (built into Node, no
  extra dependency). It caches the run list (Workflows › Runs, Projects, Usage and Analytics read it
  instead of every run folder), keeps the Backlog queues in transactions (two dispatchers never start
  the same issue; `backlog/<id>.queue.json` stays as a readable snapshot), records the gates waiting
  for you (after a restart, gates of runs that did not survive show as interrupted) and every
  notification (the bell in the sidebar: history, unread count, mark as read; kept for
  **Settings › Execution › Keep notifications** days). Deleting it loses no run and no queued issue (only the notification history): the app rebuilds it
  at the next start, and **Settings › General › Index › Rebuild index** reads every run again.
  Details: `docs/agents/storage.md`.
