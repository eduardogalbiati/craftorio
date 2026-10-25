---
order: 100
---

<!-- section:structure -->
src/host/main.js              Electron main process + IPC
src/host/preload.js           safe API exposed to the renderer
src/domains/workspace/workspace.js         workspace folder (Windows registry, runs/, repos/, workflows/, clone)
src/domains/project/projects.js          projects: CRUD and folder/repository setup
src/domains/backlog/backlog.js           backlog: project issues via gh/glab, sync cache, issue ↔ run links, workflow queue
src/domains/roadmap/roadmap.js           backlog roadmap: ordered stages of runs, each after the previous one merged
src/domains/local/local-push.js        local merges not pushed: status (commits, issues they close), push, update and push
src/domains/seed/seed.js              seeding of bundled defaults into the workspace (.seeded.json, origin status, restore)
src/domains/agents/skills.js            skills: CRUD, lookup, seeding and prompt block
src/domains/agents/agents.js            agents: CRUD, appearance validation, the built-in supervisor, the workflows' agents (read-only)
src/domains/workflow/workflows.js         workflows: seeding, origin status, lookup (workspace, then bundled)
src/domains/workflow/workflow-builder.js  visual builder: spec <-> workflow YAML, what the builder can't draw
src/domains/usage/usage.js             token/cost usage per provider and scope, budgets and the pre-run CLI check
src/domains/local/local-usage.js       readers of the CLIs' own local usage logs (Claude Code, Codex, Grok)
src/domains/usage/actions-usage.js     GitHub Actions minutes of the month vs the included quota (Usage, CI step)
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
docs/12-factor-agents/   the engine read against 12-Factor Agents: one page per factor, what applies here and what is missing
