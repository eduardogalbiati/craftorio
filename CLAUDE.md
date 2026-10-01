# Multiagent Orchestrator: project context

Electron desktop app (Windows first) that runs multi-agent workflows defined in YAML. Each agent
turn is a headless CLI process: Claude Code (`claude -p`), Codex CLI (`codex exec`) or Grok Build
(`grok --prompt-file`). A deterministic engine walks the workflow graph; an AI supervisor is called
only when a step fails, or on demand. Everything is recorded in a local workspace folder. Owner:
Eduardo Galbiati (`eduardogalbiati/multiagent-orchestrator`, branch `main`). The README is the
user-facing doc; the topic docs below are read on demand.

## Hard rules

- **Everything in the app is English**: UI, YAML, skills, README, comments, logs, errors, test
  names, and every message an agent writes (step outputs, handoffs, final answers).
- **Skill naming**: language/platform skills are `<capability>-<suffix>`, one per suffix in every
  family (a test enforces it). Languages: `js`, `python`, `go`, `java`, `csharp`; platforms: `gh`,
  `gl`. What a family shares is a suffix-less skill referenced with `uses:`. `code-review` is one
  skill with per-language `rules/*.md`.
- **Agents run unattended**: skills never "ask the user"; they record an assumption or a default.
- **The workspace is the product** (packaged .exe): everything the user edits or produces lives in
  the workspace folder; the app folder (read-only app.asar) only holds bundled defaults. Never read
  or write user data relative to `__dirname`.
- **The supervisor works on workflows, not on the user's code**: it unblocks runs and helps
  customize workflows/skills; it never prescribes code fixes (it routes them to the workflow's
  agents with evidence and hypotheses).
- **Never let automation cross a human gate** (`human_approval`), including the supervisor.
- **Branch + PR**, never commit to `main`; the owner merges, then asks to "go back to main and
  pull". Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Real-model calls cost the owner's money: say so and keep them minimal.
- **Never start real runs in automated checks**: they run with `MULTIAGENT_SIMULATION_ONLY=1`
  (the engine refuses real runs, real providers and CLI terminals). Workflow agents already have
  it in their environment: run `npm test` / `node --test …` without a `VAR=` prefix. UI checks go through
  `scripts/smoke.js` (scratch workspace), never a hand-written script that launches `src/main`.
- **Add, don't edit shared lists**: document a file in its header comment (the code map is built
  from it) or a topic doc, not here. Shared name lists: one item per line, sorted
  (`npm run lint:lists`).

## Commands

```
npm start                  # the app
npm test                   # unit tests + a full mock run of software-development
npm run run -- --file ai-arena.yaml --mock --auto-approve --input project_path=C:/x --task "..."
npm run serve -- --port 7300 [--host h] [--workspace dir]   # engine server + UI in a browser
npm run build              # packaged app in build/ (npm run package → dist/)
npm run docs               # README tables + docs/agents/code-map.md (generated)
npx electron scripts/smoke.js <out.png>   # UI smoke test: mock run + screenshot
npm run screenshot -- --view backlog --mode kanban [--ref origin/main] --out <dir>   # one screen, simulated data
```

## Topic docs (read the one that matches your task)

- [docs/agents/code-map.md](docs/agents/code-map.md): what each file does, and how to add a channel, screen or skill. Generated (gitignored): run `npm run docs` if it is missing.
- [docs/agents/engine.md](docs/agents/engine.md): workflow YAML features, sessions and handoff notes, gates, how a run ends, template context. Read before changing the engine or a workflow.
- [docs/agents/capabilities.md](docs/agents/capabilities.md): what agents may use, isolation per CLI, calling `gh`/`glab`, read-only agents. Read before changing an agent's tools or a read-only skill.
- [docs/agents/worktrees.md](docs/agents/worktrees.md): per-run git worktrees and branch gotchas. Read before touching worktrees, merges or branches.
- [docs/agents/storage.md](docs/agents/storage.md): files vs the SQLite index (index.db). Read before touching runs, queues, gates or notifications.
- [docs/agents/testing.md](docs/agents/testing.md): CI matrix, machine-independent tests, the mock provider, real CLIs. Read before writing tests.
- [docs/agents/windows-gotchas.md](docs/agents/windows-gotchas.md): line endings, paths, node-pty, the packaged exe, EBUSY. Read before scripted edits, path code, terminals or packaging.
- [docs/agents/environment.md](docs/agents/environment.md): Node/npm/Electron versions, installed CLIs, workspace layout. Read before installing or upgrading.
- [docs/agents/renderer.md](docs/agents/renderer.md): the UI and how to check it. Read before changing `src/renderer/`.
- [docs/agents/backlog.md](docs/agents/backlog.md): open ideas. Read when planning new work.
