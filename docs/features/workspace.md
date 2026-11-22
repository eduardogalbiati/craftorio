---
order: 100
---

<!-- section:workspace-tree -->
<workspace>/
  runs/      logs of each run (see Observability)
  repos/     cloned repositories
  worktrees/ one git worktree per run (<run_id>), see "A git worktree per run"
  projects/  projects (one .json per project)
  skills/    skills (one folder with SKILL.md per skill)
  backlog/   last issue sync of each project (one .json per project; <id>.po.jsonl = the Product Owner's conversation)
  agents/    user-defined agents (one .json per agent; supervisor.json = the supervisor's look, product-owner.json = the Product Owner's look, model, effort, Speed ↔ Quality calibration and Economy ↔ Generous cost)
  workflows/ workflow definitions (one .yaml per workflow)
  settings.json  app preferences, budgets and prices

<!-- section:workspace-tree order:300 -->
  .lock      the app that has the workspace open (pid, host, heartbeat)

<!-- section:workspace -->
- **One app per workspace.** The app locks the workspace it opens. A second copy on the same
  workspace (or on the same user data folder) says so and offers a **scratch copy** (your agents,
  skills, workflows and settings copied to a new workspace, simulations only) or to quit; it never
  opens your workspace read-write. A lock left by an app that died is taken over. Each run in
  progress records its owner (`runs/<id>/owner.json`, refreshed every few seconds): another copy
  shows it as **running (another window)**, never as interrupted, and its roadmap, Retry and Resume
  leave it alone. A run is only interrupted once its owner is gone.
- **Trying a run's worktree**: use **Run App** at the gate. Started by hand from
  `<workspace>/worktrees/<id>` (`npm start`), the app uses a scratch workspace and user data folder
  of its own (`<workspace>/local-previews/app-<id>/`), simulations only, as Run App does.
- **Safe state files**: the roadmap and queue files are checked before each write (an invalid one
  is refused and logged), written atomically, and the previous version is kept as `<file>.bak`.

<!-- section:workspace order:300 -->
- **Bundled defaults.** The app folder (read-only `app.asar` in the packaged app) only holds the
  default skills and workflows; the app and `scripts/run.js` copy them into `skills/` and
  `workflows/` on startup, and everything is read and edited there. `.seeded.json` in each folder
  records the content hash of each copied default:
  - a default not copied yet is copied (unless you already have a file with that name, which is kept);
  - an untouched copy is updated when a new app version ships a new version of it (e.g.
    `software-development` 0.9.0 → 0.10.0);
  - a copy you edited is never overwritten; Workflows > Definitions shows it as **modified**, with
    **newer default** when the app ships a newer version, and **Restore default** (your copy goes to
    the trash);
  - a default you deleted is not brought back (to get it back, remove its entry from `.seeded.json`);
  - files you created are never touched.
- Runs record the workflow file name. Resuming a run (or opening its sessions or supervisor) reads
  the workflow from `<workspace>/workflows/`; if you deleted it, the bundled copy is used and the run
  log says so.

<!-- section:workspace order:400 -->
- On startup the app looks for `%USERPROFILE%\multiagent-workspace`. If it does not exist, it asks
  whether to create it or pick another folder.
- The chosen path is stored in the Windows registry at
  `HKCU\Software\Craftorio\WorkspacePath` and reloaded on the next launches
  (on other OSes, in `~/.multiagent-orchestrator.json`). If the stored folder disappears, the app asks again.
- Settings shows the current workspace, with **Open** and **Change…**.
- The `repo_path` input accepts a git URL (`https://…` or `git@…`): the app clones it into
  `repos/<owner>-<repo>` (or runs `git fetch` if already cloned) and runs the workflow on that copy.
- `CRAFTORIO_WORKSPACE=<folder>` overrides the workspace without writing to the registry (used by `npm test`).
- `scripts/run.js` uses the same workspace; with nothing stored, it creates the default folder.
