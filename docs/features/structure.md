---
order: 100
---

<!-- section:structure -->
src/main.js              Electron main process + IPC
src/preload.js           safe API exposed to the renderer
src/workspace.js         workspace folder (Windows registry, runs/, repos/, workflows/, clone)
src/projects.js          projects: CRUD and folder/repository setup
src/backlog.js           backlog: project issues via gh/glab, sync cache, issue ↔ run links, workflow queue
src/roadmap.js           backlog roadmap: ordered stages of runs, each after the previous one merged
src/local-push.js        local merges not pushed: status (commits, issues they close), push, update and push
src/seed.js              seeding of bundled defaults into the workspace (.seeded.json, origin status, restore)
src/skills.js            skills: CRUD, lookup, seeding and prompt block
src/agents.js            agents: CRUD, appearance validation, the built-in supervisor, the workflows' agents (read-only)
src/workflows.js         workflows: seeding, origin status, lookup (workspace, then bundled)
src/workflow-builder.js  visual builder: spec <-> workflow YAML, what the builder can't draw
src/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
src/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
src/actions-usage.js     GitHub Actions minutes of the month vs the included quota (Usage, CI step)
src/engine/workflow.js   engine that runs the YAML graph
src/engine/providers.js  claude / codex / grok / mock adapters
src/engine/capabilities.js  agent capabilities and isolation → each CLI's flags
src/engine/recorder.js   writes to disk (jsonl + summary)
src/engine/worktree.js   git worktree per run: create, reuse on resume, remove, orphan cleanup
src/renderer/            UI (plain HTML/CSS/JS)
workflows/               bundled workflow definitions (copied into <workspace>/workflows)
skills/                  bundled skills (copied into <workspace>/skills)
.github/workflows/       CI (PRs) and deploy (merge into main)
scripts/                 terminal runner, tests, build, UI smoke test and UI screenshots (screenshot.js)
test/                    unit tests (node:test) and fixtures
AGENTS.md, docs/agents/  context for coding agents working on this repository (short index, imported by CLAUDE.md, + topic docs)
