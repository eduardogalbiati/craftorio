# Multiagent Orchestrator: agent instructions

Electron desktop app (Windows first) that runs multi-agent workflows defined in YAML. Each agent
turn is a headless CLI process: Claude Code (`claude -p`), Codex CLI (`codex exec`) or Grok Build
(`grok --prompt-file`). A deterministic engine walks the workflow graph; an AI supervisor is called
only when a step fails, or on demand. Everything is recorded in a local workspace folder. Owner:
Eduardo Galbiati (`eduardogalbiati/multiagent-orchestrator`, branch `main`). The README is the
user-facing doc.

## Hard rules

- **Everything in the app is English**: source, UI, bundled workflows and skills, README, logs,
  tests. What agents write follows Settings › Language (default English, #327, #328).
- **Skill naming**: language/platform skills are `<capability>-<suffix>`, one per suffix in every
  family (a test enforces it). Languages: `js`, `python`, `go`, `java`, `csharp`; platforms: `gh`,
  `gl`. What a family shares is a suffix-less skill referenced with `uses:`. `code-review` is one
  skill with per-language `rules/*.md`.
- **Agents run unattended**: skills record an assumption or a default; only Grill me may ask.
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
  `scripts/smoke.js` (scratch workspace), never a hand-written script that launches `apps/desktop/host/main`.
- **Add, don't edit shared lists**: document a file in its header comment (the code map is built
  from it) or a topic doc, not here. Shared name lists: one item per line, sorted
  (`npm run lint:lists`).

## Commands

```
npm start                  # the app
npm test                   # unit tests + a full mock run of software-development
npm test -w packages/engine   # one workspace's tests
npm run run -- --file ai-arena.yaml --mock --auto-approve --input project_path=C:/x --task "..."
npm run serve -- --port 7300 [--host h] [--workspace dir]   # engine server + UI in a browser
npm run build              # packaged app in build/ (npm run package → dist/)
npm run docs               # README tables + docs/agents maps (generated)
npx electron scripts/smoke.js <out.png>   # UI smoke test: mock run + screenshot
npm run screenshot -- --view backlog --mode kanban --out <dir>   # one screen, simulated data
```

## Topic docs (read the one for your task)

- [code-map.md](docs/agents/code-map.md), [test-map.md](docs/agents/test-map.md), [channels.md](docs/agents/channels.md): file roles, tests, channel schemas (`npm run docs`, gitignored).
- [docs/agents/decisions.md](docs/agents/decisions.md): the owner's decisions. Read before changing behaviour an earlier decision set.
- [docs/agents/engine.md](docs/agents/engine.md): workflow YAML, sessions and handoff notes, gates, how a run ends, templates. Read before changing the engine or a workflow.
- [docs/agents/capabilities.md](docs/agents/capabilities.md): agents' tools, isolation per CLI, `gh`/`glab`, read-only agents. Read before changing an agent's tools or a read-only skill.
- [docs/agents/worktrees.md](docs/agents/worktrees.md): per-run worktrees, branch gotchas. Read before touching worktrees, merges or branches.
- [docs/agents/storage.md](docs/agents/storage.md): files vs the SQLite index. Read before touching runs, queues, gates or notifications.
- [docs/agents/testing.md](docs/agents/testing.md): CI, machine-independent tests, mock provider, real CLIs. Read before writing tests.
- [docs/agents/windows-gotchas.md](docs/agents/windows-gotchas.md): line endings, paths, node-pty, the exe, EBUSY. Read before scripted edits, terminals or packaging.
- [docs/agents/environment.md](docs/agents/environment.md): Node/npm/Electron, CLIs, workspace layout. Read before installing or upgrading.
- [docs/agents/renderer.md](docs/agents/renderer.md): the UI and how to check it. Read before changing `packages/ui-kit/`, `fronts/` or `apps/*/renderer/`.
- [docs/agents/backlog.md](docs/agents/backlog.md): open ideas. Read when planning new work.
- [seeds.md](docs/agents/seeds.md): writing an analysis seed.
