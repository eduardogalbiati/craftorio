---
order: 100
---

<!-- section:structure -->
src/host/main.js              Electron main process + IPC
src/host/preload.js           safe API exposed to the renderer
packages/engine/domains/workspace/workspace.js         workspace folder (Windows registry, runs/, repos/, workflows/, clone)
packages/engine/domains/project/projects.js          projects: CRUD and folder/repository setup
packages/engine/domains/backlog/backlog.js           backlog: project issues via gh/glab, sync cache, issue ↔ run links, workflow queue
packages/engine/domains/roadmap/roadmap.js           backlog roadmap: ordered stages of runs, each after the previous one merged
packages/engine/domains/local/local-push.js        local merges not pushed: status (commits, issues they close), push, update and push
packages/engine/domains/seed/seed.js              seeding of bundled defaults into the workspace (.seeded.json, origin status, restore)
packages/engine/domains/agents/skills.js            skills: CRUD, lookup, seeding and prompt block
packages/engine/domains/agents/agents.js            agents: CRUD, appearance validation, the built-in supervisor, the workflows' agents (read-only)
packages/engine/domains/workflow/workflows.js         workflows: seeding, origin status, lookup (workspace, then bundled)
packages/engine/domains/workflow/workflow-builder.js  visual builder: spec <-> workflow YAML, what the builder can't draw
packages/engine/domains/usage/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
packages/engine/domains/local/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
packages/engine/domains/usage/actions-usage.js     GitHub Actions minutes of the month vs the included quota (Usage, CI step)
packages/engine/engine/workflow.js   engine that runs the YAML graph
packages/engine/engine/providers.js  claude / codex / grok / mock adapters
packages/engine/engine/capabilities.js  agent capabilities and isolation → each CLI's flags
packages/engine/engine/recorder.js   writes to disk (jsonl + summary)
packages/engine/engine/worktree.js   git worktree per run: create, reuse on resume, remove, orphan cleanup
src/renderer/            UI (plain HTML/CSS/JS)
workflows/               bundled workflow definitions (copied into <workspace>/workflows)
skills/                  bundled skills (copied into <workspace>/skills)
.github/workflows/       CI (PRs) and deploy (merge into main)
scripts/                 terminal runner, tests, build, UI smoke test and UI screenshots (screenshot.js)
test/                    unit tests (node:test) and fixtures
AGENTS.md, docs/agents/  context for coding agents working on this repository (short index, imported by CLAUDE.md, + topic docs)
