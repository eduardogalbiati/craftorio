---
name: build-audit-js
description: Builds a JavaScript/TypeScript project and audits its dependencies for vulnerabilities, separating production from development (npm, pnpm, yarn). Use to check whether a JS/TS project builds and has vulnerable dependencies.
uses: [dependency-audit-policy]
---

# Build and audit: JavaScript / TypeScript

## Package manager

From the lockfile: `package-lock.json` → npm · `pnpm-lock.yaml` → pnpm · `yarn.lock` → yarn
(Yarn Berry when `.yarnrc.yml` exists). Never create a new lockfile or switch managers.

## Build

1. Clean install: `npm ci` · `pnpm install --frozen-lockfile` · `yarn install --frozen-lockfile` (Berry: `yarn install --immutable`).
2. If `package.json` has `scripts.build`, run it (`npm run build`).
3. No build script: TS project → `npx tsc --noEmit`; plain JS → build is OK, say so in the report.
4. Also run `scripts.typecheck`/`scripts.lint` if they exist and CI does not already run them; report (do not block on) lint findings.

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
