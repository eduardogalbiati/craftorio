---
name: build-audit-js
description: Builds a JavaScript/TypeScript project and audits its dependencies for vulnerabilities, separating production from development (npm, pnpm, yarn). Use to check whether a JS/TS project builds and has vulnerable dependencies.
uses: [dependency-audit-policy, long-commands]
summary: "Build and audit commands, production vs development scope per ecosystem"
used_by: "builder"
---

# Build and audit: JavaScript / TypeScript

## Package manager

From the lockfile: `package-lock.json` → npm · `pnpm-lock.yaml` → pnpm · `yarn.lock` → yarn
(Yarn Berry when `.yarnrc.yml` exists). Never create a new lockfile or switch managers.

## Build

No test suite here (`npm test` and the like): the test writer already ran it, and CI runs it on every platform.

1. Dependencies are ready: the engine links `node_modules` from a shared cache, installed once per
   lockfile. **Never reinstall** (`npm ci`, a frozen pnpm/yarn install) and never delete
   `node_modules`: through the link it would empty the cache for every run. Instead check that the
   lockfile matches `package.json`: npm `npm ls --all` (any `npm ci` is refused, `--dry-run` too; errors such as
   `missing`, `invalid` or `ELSPROBLEMS` = out of sync: `failure_class: code`) · pnpm
   `pnpm install --frozen-lockfile --lockfile-only` · yarn 1 `yarn check --integrity` · Berry
   `yarn install --immutable --mode=update-lockfile`.
   Only when your prompt says the dependencies are not cached for this project, run the clean
   install yourself (`npm ci` · `pnpm install --frozen-lockfile` · `yarn install --frozen-lockfile`).
2. If `package.json` has `scripts.build`, run it (`npm run build`).
3. No build script: TS project → `npx tsc --noEmit`; plain JS → build is OK, say so in the report.
4. Also run `scripts.typecheck`/`scripts.lint` if they exist and CI does not already run them; report (do not block on) lint findings.

## Build failures: code or environment

- **code**: a commit can fix it (compile error, failing script, lockfile out of sync with `package.json`).
- **infra**: no commit can. Typical case: the install fails with `EBUSY`/`EPERM`/`resource busy or locked`
  under `node_modules` (often `node_modules/electron/dist/...`): a program started from this folder
  (an Electron window, a dev server) is still running and holds the file. Report `failure_class: infra`,
  name the locked path in the report, and **stop**: do not retry the install in a loop, do not delete
  `node_modules` by hand, and do not try to find or kill the process (you have no permission to, and
  stopping `electron.exe` by name would close the user's own app). The orchestrator stops processes
  started from the run's folder; a human decides when to build again.
  An interrupted `npm ci` leaves `node_modules` incomplete (missing packages): later `npm test` or
  `npm run build` errors such as `Cannot find module` are a consequence, not a separate code failure.
- **infra** too: the build tool fails on the linked `node_modules` itself (it refuses a directory
  junction or symlink): name the tool and the error in the report; the owner decides.

## Audit

| Manager | Production | Everything |
|---|---|---|
| npm | `npm audit --omit=dev --json` | `npm audit --json` |
| pnpm | `pnpm audit --prod --json` | `pnpm audit --json` |
| yarn 1 | `yarn audit --groups dependencies --json` | `yarn audit --json` |
| yarn Berry | `yarn npm audit --environment production --json` | `yarn npm audit --all --recursive --json` |

- npm counts are in `metadata.vulnerabilities` (`critical`, `high`, `moderate`, `low`; ignore `info`).
- Development = "everything" minus production.
- Dependency path: `npm ls <package>`.
- Fixes: the version that fixes it, `npm audit fix` (never `--force` without saying it changes a major version), or `overrides` in `package.json` for a transitive dependency.
