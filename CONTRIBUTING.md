# Contributing

Thanks for your interest in Multiagent Orchestrator. Issues and pull requests are welcome.

## Setup

1. Install the Node version in [`.nvmrc`](.nvmrc) (`nvm use`, or install it by hand).
2. `npm install`
3. `npm start` opens the app.

**Sign-in during development**: the packaged app asks for an account (it only counts the people
using the app). From source, set `MULTIAGENT_AUTH=off` to skip it:

```
MULTIAGENT_AUTH=off npm start          # bash
$env:MULTIAGENT_AUTH = 'off'; npm start  # PowerShell
```

**Developer mode** (Settings › Execution › Developer mode) shows the "Simulation" checkboxes: a
simulated run goes through the whole workflow with the mock provider, without calling any model,
so you can try a change for free.

## Checks

- `npm test` runs the unit tests and a full simulated run of the software-development workflow.
  It is simulation-only (`MULTIAGENT_SIMULATION_ONLY=1`): it never calls a model and never starts
  a real run, so it costs nothing.
- `node scripts/docs.js --check` checks that the generated README tables are up to date
  (`npm run docs` regenerates them).
- `npm run lint:lists` checks that shared name lists are one item per line, sorted.
- UI changes: `npx electron scripts/smoke.js <out.png>` (a simulated run and a screenshot) or
  `npm run screenshot -- --view <screen> --out <dir>`.

## Rules

These come from [`CLAUDE.md`](CLAUDE.md), which holds the full list:

- **English everywhere**: UI, YAML, skills, docs, comments, logs, errors, test names.
- **Branch + pull request**: never commit to `main`; the maintainer merges.
- **Tests with every change**: new or fixed behaviour comes with a test that fails without it.
- Real model calls cost money: automated checks never start real runs.

## Where the docs live

- [`README.md`](README.md): the user-facing documentation (some tables are generated).
- [`docs/agents/`](docs/agents): topic docs for contributors (engine, storage, worktrees, testing,
  Windows gotchas, the renderer...). `npm run docs` also builds the code and test maps there.

## Built by its own workflows

Most of this project is written by its own workflows: agents implement issues on a branch, a
reviewer checks them, and the maintainer merges. [`CLAUDE.md`](CLAUDE.md) is the agents' context;
keep it short and accurate when you change how the project works.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
Code adapted from another project must keep its notice in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
