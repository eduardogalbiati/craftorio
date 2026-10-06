---
order: 600
---

<!-- section:engine -->
### Run titles and PRs

- Every run has a **display title**: its issue ("#12 Notifications"), else the first line of its
  task. Hover it and click the pencil to give it your own ("Notifications, 2nd try after
  conflict"); an empty title goes back to the default. It is saved in `runs/<id>/meta.json`
  (`events.jsonl` is never changed), a resumed run inherits it, and it is shown everywhere a run is
  listed: Workflows › Runs, Settings › Projects › Project, the left sidebar's run list, the Run screen, the run
  chat, Backlog cards, toasts and desktop notifications. The workflow name stays next to it.
- A run that opened a pull/merge request (the latest step output with `pr_url` / `pr_number`, e.g.
  the `ci` step; a resumed run shows the PR of the run it resumes) shows it in the same places: the
  pull-request icon coloured by the PR state and its number, a link that opens the PR in the
  browser. Blue: open, checks running; green: ready to merge; red: checks failing; orange with "!":
  conflict; grey: draft (or state unknown); purple: merged; grey struck: closed without merge. The
  tooltip says the state in words and when it was checked. The app reads it with
  `gh pr view` / `glab mr view` (no model call): every minute and on run events for the runs in
  progress, when a list shows them for finished runs (cached 5 minutes; merged and closed PRs are
  final). Simulated runs' PRs are not real and are not read.
- **View run** opens any run in the Run screen, also one this window never saw: a finished run is
  rebuilt from its `events.jsonl`, read-only (no Stop, no gates). After a reload (Ctrl+R) or
  reopening the app, the runs in progress are rebuilt the same way, so their steps, sessions,
  orchestrator log and pending gates are all there.
