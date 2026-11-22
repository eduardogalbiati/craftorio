---
order: 120
---

<!-- section:workflows -->
**Run App at a gate.** `developer_check`, `human_review` and `approve_merge` (any gate with
`local_preview: true`) always offer **Run App** (its label says what it runs, e.g. "Run App: npm
start"). It uses the project's Local preview (Projects › Edit › Local preview), else the
workflow's:

```yaml
orchestrator:
  local_preview:
    install: "npm ci"      # only when dependencies are missing or the lockfile changed
    command: "npm start"   # or "npm run dev"
    url: null              # or "http://localhost:5173" (a link at the gate; a busy port is reported)
```

It runs in the run's worktree in an embedded terminal (the dock, labelled with the run's issues),
with **■ Stop**, and stops by itself when the gate is answered or the run ends. It never answers the
gate. The copy runs in simulation only (`CRAFTORIO_SIMULATION_ONLY=1`) on a scratch workspace
(`<workspace>/local-previews/<run>/`: a copy of your projects, agents, skills, workflows and
settings, never your runs) with its own user-data folder, so trying this app can't spend on real
models or touch your workspace; **real workspace** (with a warning) points it at yours instead.
"Local preview started/stopped" is recorded in the run's history and chat. The gate shows the
app's state (running / stopped / failed, with the busy-port message), **Terminal** to show or hide
its terminal and **Open URL** when a URL is set.

Which command runs, first match wins: the project's Local preview (Projects › Edit) > the
repository's `.craftorio/local-preview.yaml` > the workflow's `orchestrator.local_preview` >
detection. A repository declares how it runs once, committed, and everyone gets one-click Run App:

```yaml
# .craftorio/local-preview.yaml
install: npm ci          # optional
command: npm run dev
url: http://localhost:5173   # optional
cwd: apps/web            # optional: a monorepo's app
env:                     # optional
  API_URL: http://localhost:8080
```

Running a repository's command is code execution on your machine, so Run App asks once per
project, in one click: a small popover over the gate, "Run with `npm ci` + `npm start` (from
package.json)? **Run** · **Edit**". A declared command that changes (the file edited) asks again;
your own Local preview never asks. With nothing declared, it detects: package.json's `start`/`dev`
script (`npm ci` / `yarn` / `pnpm` per lockfile, a framework URL), a monorepo's apps (workspaces or
several package.json: pick one, stored as `cwd`), Docker Compose (`docker compose up`, the first
published port), a dev container's `postStartCommand` (forwarded port), a Procfile's `web:`, a
Makefile `run`/`dev`/`start` target, the README's run command, Django, Go, Rust or .NET; each
suggestion says where it came from. **Run** saves a detected command as the project's Local preview;
**Edit** opens the fields, and **Save and run** can also write them to
`.craftorio/local-preview.yaml` in the project folder (a change you commit). Projects › Edit
shows what the project's folder declares or is detected to run with (**Use it**), before any gate;
Projects › Add detects nothing until the project is saved (only a project's folder or a run's
worktree is read, so a browser on `npm run serve` cannot list any folder of the machine). For this
app itself it proposes `npm ci` and `npm start`. In a simulation (no git worktree) the gate's
**Changed files** are the ones the simulated developer reported, labelled "simulated".
`developer_check` also offers **Show the diff**: the branch's changes since the base branch, in the
diff viewer (see Reviewing a run's changes).
