## CI/CD

GitHub Actions run only for a release (owner decision of 2026-10-31): a push to `main` and a pull
request build nothing, so no Actions minutes are spent between releases.

- `.github/workflows/ci.yml`: **by hand only** (Actions › CI › Run workflow): a syntax check,
  `npm test` on Ubuntu, Windows and macOS (checks `test (<os>)`) and a production `npm audit`. When
  pull requests trigger it again, it plans per PR: Ubuntu and Windows, macOS too when the PR touches a
  platform-sensitive path (worktrees, processes, terminals, packaging, dependencies, CI) or has the
  `ci:macos` label (from the next push). A docs-only PR
  (`.md` files other than `AGENTS.md`, `CLAUDE.md`, `docs/agents/`, `skills/`, `docs/screens/` and `docs/features/`,
  which the tests read) runs no
  tests. A new push to a PR cancels the previous run. The `test` check is green only when every
  planned OS is: use that name in branch protection. Each run records a `ci/tested` commit status
  on the PR head (a PR's checks belong to GitHub's merge commit, not the head): pending when it
  starts, then success or failure, so only the latest run counts. The
  plan lives in `scripts/ci-plan.js`.
- `.github/workflows/preview.yml`: test environment. Triggered by the Deployer, publishes the
  pre-release `preview-pr-<n>` from the PR branch: the Windows build by default, `-f os=macos`,
  `linux` or `all` for the others. It keeps the builds a pre-release of the same commit already has
  (`-f rebuild=true` forces them) and skips `npm test` when the PR head has `ci/tested`.
- `.github/workflows/deploy.yml`: production. A pushed `vX.Y.Z` tag (the app's **Promote to stable**
  pushes it) packages the app on `windows-latest` (win32 x64), `macos-latest` (darwin arm64),
  `macos-15-intel` (darwin x64) and `ubuntu-latest` (linux x64, AppImage and tar.gz), runs
  `npm test` on each, launches each package in simulation until it quits by itself
  (`scripts/smoke-package.js`, `xvfb-run` on Linux; a failure stops the release) and publishes all of
  them as the release `vX.Y.Z`, marked latest. A manual run on `main` publishes a prerelease
  `vX.Y.Z-rc.N` instead, to try a build before tagging it. A job skips `npm test` only when the PR's
  CI tested the same tree.
- `.github/workflows/pages.yml`: the public page (`site/`, `npm run site`) on GitHub Pages, published
  with each `vX.Y.Z` tag or by hand; off until the repository variable `SITE_PAGES` is `on`.

Standard GitHub-hosted runners are free for public repositories; CI still runs only what a change
needs, so it stays fast, and every job has a `timeout-minutes`. A pull request from a fork gets the
same tests and a green or red `test` check, but records no `ci/tested` status (its token is
read-only), so preview and deploy run the tests themselves. Never use a self-hosted runner
(`runs-on: self-hosted`) on a public repository: a fork's pull request could run its code on that
machine.

**Actions quota in the app.** The Usage screen has a **GitHub Actions** card: this month's quota
minutes (multipliers applied) against the included ones (`actionsIncludedMinutes` in
`settings.json`, 2,000 by default for GitHub Free), per runner, with a warning at 80%. It reads
`gh api users/<login>/settings/billing/usage`, which needs gh's `user` scope
(`gh auth refresh -s user`, optional: without it the card says so). When the quota is exhausted,
the `ci` step of `software-development` does not wait for checks that never start: it finishes as
`failed` with `failure_class: infra` and "GitHub Actions quota exhausted until <date>", and goes
straight to the `ci_failed` gate (no fix round).

The CI/CD agents use the GitHub CLI (`gh`) or the GitLab CLI (`glab`), which must be
authenticated (`gh auth login` / `glab auth login`).
