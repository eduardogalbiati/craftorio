---
menu: Settings › Projects
order: 111
---

The projects, a tab of Settings (#254): create, edit, folders and repository; the header's selector chooses the one every screen shows. Projects in `<workspace>/projects/<id>.json`. Every project has a folder and optionally a git repository. With a repository and no folder, it is cloned into `<workspace>/repos/<owner>-<repo>`; without either, the folder is `<workspace>/projects/<id>/`. Clicking a project shows every workflow run in it (status, cost, task), and for each run its sessions, with **Live terminal** / **Open in CLI** to watch or resume any of them, then two columns: **Artifacts** (what the run produced first, **Show all** for its notes and logs, chips by category and kind, as in the run's Details) and **Repository** (the run's branch and its state, its commits newest first, **Review changes** opening the changes viewer, a click on a commit opening it on that commit). Runs are linked by the project id they were started with (older ones by the project's current or previous folders)
