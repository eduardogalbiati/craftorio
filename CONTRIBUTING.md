# Contributing

Thanks for your interest in Multiagent Orchestrator. Issues and pull requests are welcome. New here?
Issues labelled [`good first issue`](https://github.com/eduardogalbiati/multiagent-orchestrator/labels/good%20first%20issue)
are small and self-contained; [`help wanted`](https://github.com/eduardogalbiati/multiagent-orchestrator/labels/help%20wanted)
marks the ones the maintainer would welcome a hand with. How the code fits together:
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Setup

1. Install the Node version in [`.nvmrc`](.nvmrc) (`nvm use`, or install it by hand).
2. `npm install`
3. `npm start` opens the app.
4. Optional: the Rust toolchain (`rustup`, stable; on Windows with the MSVC build tools). `cargo`
   builds the native sidecars in `native/` (the supervisor's MCP server, `multiagent-mcp`). It is
   optional for JS-only changes: without cargo the app uses the JS fallback
   (`packages/engine/domains/supervisor/supervisor-mcp.js`) and `npm test` skips the binary's cases. A change under `native/`, and
   `npm run package`, need it.

**Sign-in during development**: the packaged app asks for an account (it only counts the people
using the app). From source, set `MULTIAGENT_AUTH=off` to skip it:

```
MULTIAGENT_AUTH=off npm start          # bash
$env:MULTIAGENT_AUTH = 'off'; npm start  # PowerShell
```

**Developer mode** (Settings › Execution › Developer mode) shows the "Simulation" checkboxes: a
simulated run goes through the whole workflow with the mock provider, without calling any model,
so you can try a change for free.

## Environment variables

Read when running from source; the packaged app ignores the ones marked "source only".

| Variable | What it does |
|---|---|
| `MULTIAGENT_AUTH` | `off` skips the sign-in (development, tests, screenshots, `npm run serve`). Source only. |
| `MULTIAGENT_SUPABASE_URL` | The accounts backend's URL instead of the one in `packages/engine/domains/account/auth-config.js`. Source only. |
| `MULTIAGENT_SUPABASE_KEY` | Its publishable key, with `MULTIAGENT_SUPABASE_URL`. Source only. |
| `MULTIAGENT_WORKSPACE` | The workspace folder (runs, repos, worktrees). Unset from source: a scratch workspace when another app already holds the owner's one, or in simulation-only mode. |
| `MULTIAGENT_USER_DATA` | Electron's `userData` folder (settings, account session). Source only. |
| `MULTIAGENT_SIMULATION_ONLY` | `1` refuses every real run: only the mock provider (`npm test` sets it). |
| `MULTIAGENT_SERVER_TOKEN` | The `npm run serve` token; unset, a random one at every start. Full control of the machine: keep it secret. |
| `MULTIAGENT_E2E_WORKERS` | Parallel workers of `npm run test:e2e`; unset, sized from the machine. |

## Running the app on this repository

`main` is protected and only the maintainer merges. On your own clone, use the
`ai-development-remote-hero` workflow: it pushes the run's branch, opens a pull request and stops at
Team review, where the maintainer takes over.

1. Add your clone as a project in the app. The repository's manifest (`.multiagent/project.yaml`)
   names `ai-development-remote-hero` as the project's default workflow and as the workflow of a
   Feature: the import sets both, nothing to configure by hand.
2. On the Workflows screen, accept `ai-development-remote-hero`. Accept it again whenever the file changes.
3. Plan it from the Backlog or the Roadmap. The Start drawer lists the workspace's workflows only.

A bug fix lands here through the manifest's Fix workflow: `fix` in Remote mode, which pushes a
branch and opens a pull request for the maintainer. Avoid `feature` and `fix` in Local mode here:
they merge into your local `main`, GitHub refuses the push, and the run still ends with your work
only on your machine.

## Checks

- `npm test` runs the unit tests and a full simulated run of the feature workflow.
  It is simulation-only (`MULTIAGENT_SIMULATION_ONLY=1`): it never calls a model and never starts
  a real run, so it costs nothing.
- `node scripts/docs.js --check` checks that the generated README tables are up to date
  (`npm run docs` regenerates them).
- `npm run lint:lists` checks that shared name lists are one item per line, sorted.
- Rust changes (`native/`): `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and
  `cargo test`, each with `--manifest-path native/Cargo.toml` (CI runs them on every OS).
- UI changes: `npx electron scripts/smoke.js <out.png>` (a simulated run and a screenshot) or
  `npm run screenshot -- --view <screen> --out <dir>`.
- `npm run test:e2e` sizes its parallel workers from your machine (`auto`); on a slow machine set
  `MULTIAGENT_E2E_WORKERS=1` (or any number) to choose them yourself.
- A dependency change: `npm run licenses` regenerates `resources/THIRD_PARTY_LICENSES.txt`.

## Rules

These come from [`AGENTS.md`](AGENTS.md), which holds the full list (`CLAUDE.md` imports it):

- **English everywhere** in the source: UI, YAML, skills, docs, comments, logs, errors, test names.
  What agents write follows Settings › Language (English by default).
- **Branch + pull request**: never commit to `main`; the maintainer merges.
- **Tests with every change**: new or fixed behaviour comes with a test that fails without it.
- Real model calls cost money: automated checks never start real runs.

## Translations

The interface text lives in `packages/shared/i18n/`: `en.json` is the source, one file per translation
(`pt-BR.json`). To fix a translation, edit its value; to add a language, copy `en.json` to
`<code>.json` (a BCP 47 code, e.g. `es`, `fr`), translate the values (keep the keys and the
`{name}` placeholders; a plural is an object of `Intl.PluralRules` forms: `one`, `other`...), add
the code to `PAGE_LANGUAGES` in `packages/shared/i18n.js`, and run
`node --test test/i18n-329.test.js test/i18n-catalog-check-329.test.js`. A key you leave out shows
the English text. Check the screens with `npm run screenshot -- --view settings --lang <code>`.
Details: [`docs/agents/renderer/interface-language.md`](docs/agents/renderer/interface-language.md).

## Where the docs live

- [`README.md`](README.md): the user-facing documentation, generated by `npm run docs` from the fragments in
  `docs/readme/` (one file per section): edit or add a fragment, never `README.md` itself.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): a short tour of the engine, the service, the
  renderer and the native sidecars, for people.
- [`docs/agents/`](docs/agents): topic docs for contributors (engine, storage, worktrees, testing,
  Windows gotchas, the renderer...). `npm run docs` also builds the code and test maps there.

## Releasing

GitHub Actions run only for a release (2026-10-31, `docs/agents/decisions.md`, #489):

1. A push to `main` builds nothing. The app records each merge as a release candidate
   (`vX.Y.Z-rc.N`) on its Releases screen.
2. To ship a stable version, tag the candidate's commit `vX.Y.Z` and push the tag (the app's Releases
   screen does it with "Promote to stable"). **Deploy** builds and smoke-tests every OS from that tag,
   runs the tests, and publishes the release, marked latest; **Pages** publishes the public page.
3. To try a build first, run **Deploy** by hand on `main`: it publishes a **prerelease**
   `v<package.json version>-rc.N`, never marked latest.
4. Bump `version` in `package.json` (`npm version <x.y.z> --no-git-tag-version`) before the tag, so
   the app reports the version it ships as.

The changes of each version are in [CHANGELOG.md](CHANGELOG.md) and in its notes on
[GitHub Releases](https://github.com/eduardogalbiati/multiagent-orchestrator/releases).

## Built by its own workflows

Most of this project is written by its own workflows: agents implement issues on a branch, a
reviewer checks them, and the maintainer merges. [`AGENTS.md`](AGENTS.md) is the agents' context
(Codex and Grok read it, `CLAUDE.md` imports it for Claude Code); keep it short and accurate when you change how the project works.

### Stacked pull requests

When a roadmap stage waits for its pull request's merge, the Roadmap may stack the next stage on it
(#807, Remote mode only, at most 3 pull requests): the next pull request starts from the previous
one's branch and targets it, so its diff shows only its own work. Review and merge a stack **from
the bottom up**: merge the lowest pull request (the one on `main`) first, with a merge commit or a
squash; the run of the one above rebases onto `main` without the merged commits and moves its base
to `main`, then review it in turn. A pull request closed without merging stops the runs stacked on
it, which ask whether to rebase onto `main` or stop. Never merge an upper pull request into its
parent's branch: merge each one into `main` in order.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
Code adapted from another project must keep its notice in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
