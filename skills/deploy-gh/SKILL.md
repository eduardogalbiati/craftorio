---
name: deploy-gh
description: Publishes a pull request preview (GitHub pre-release via a workflow_dispatch workflow) and tracks the production deploy triggered by the merge, diagnosing failed GitHub Actions runs (gh CLI). Use for preview and production deploys on GitHub.
uses: [ci-failure-triage]
---

# Deploy: GitHub (gh CLI)

## How to call gh

Your allowlist only accepts `gh` (and `git`) called **bare, in the Bash tool, one command per
call**: `gh run list --workflow preview.yml --limit 5`. Every other form is refused, and each
refusal burns a turn:

- no PowerShell tool, no `cmd /c`, no full or 8.3 path (`"/c/Program Files/GitHub CLI/gh.exe"`,
  `C:\PROGRA~1\...`): the orchestrator already put `gh` on the PATH;
- no `PATH`/`$env:PATH` changes, no variables, no `;`, `&&`, `||` or pipes: one command per call
  (use `--json` + `--jq` to filter instead of piping);
- long texts go inline with `--notes "..."` / `--body "..."` (no files, no heredocs).

If a bare `gh` call is refused, do not try other forms: say so in `error_summary`. The
orchestrator stops a loop whose agent stays blocked.

Convention in this project:
- **Preview** = GitHub pre-release tagged `preview-pr-<n>`, built by the preview workflow
  (input `preview_workflow`, e.g. `preview.yml`) through `workflow_dispatch`.
- **Production** = the deploy workflow (input `deploy_workflow`, e.g. `deploy.yml`) that runs on
  every push to the base branch and publishes a regular release.

## Preview

Trigger (only if not triggered yet, or the last attempt failed):

```
gh workflow run <preview_workflow> --ref <branch> -f pr_number=<n>
```

Track it (the run can take a few seconds to show up):

```
gh run list --workflow <preview_workflow> --branch <branch> --json databaseId,status,conclusion,url,createdAt --limit 5
```

- not listed yet, `queued`, `in_progress`, `waiting` → `pending`
- `completed` + `success` → `success`; `release_url` from `gh release view preview-pr-<n> --json url`
- `completed` + anything else → `failed`; summarize with `gh run view <id> --log-failed` and set
  `failure_class` (see below)

After a fix the preview is triggered again: track the run of the branch's current head
(`git ls-remote origin refs/heads/<branch>` gives the sha; add `headSha` to the `--json` fields and
pick the run whose `headSha` matches), never the older failed run.

## Production (after the merge)

1. Merge commit: `gh pr view <n> --json mergeCommit` (`mergeCommit.oid`).
2. Deploy run for that commit:
   `gh run list --workflow <deploy_workflow> --branch <base> --json databaseId,headSha,status,conclusion,url --limit 10`
   → pick the run whose `headSha` equals the merge commit.
3. Map status as in the preview. On `success`:
   - `release_url`: `gh release list --exclude-pre-releases --limit 1 --json tagName,url` (or `gh release view <tag> --json url`);
   - clean up the preview: `gh release delete preview-pr-<n> --cleanup-tag -y` (ignore "not found").

## Failure summary and class

`error_summary` follows ci-failure-triage. Every `failed` answer also carries `failure_class`,
which decides what the orchestrator does next:

| failure_class | When | Next |
|---|---|---|
| `code` | a commit on the branch can fix it: compile, test or lint errors (including tests that only fail on the preview's OS), a lockfile out of sync, a build script or workflow file in the repository (triage classes code and environment drift) | the developer fixes it; CI, the PR check and the preview run again |
| `infra` | no commit can: runner lost, network or registry errors, timeouts, quota, a missing secret or permission, a protected environment waiting for approval (triage classes infrastructure and needs-human) | a human decides: publish again or stop |
| `unknown` | the log does not tell | a human decides |

For a preview failure that looks like infrastructure, trigger it once more yourself and answer
`pending`; if it fails again, answer `failed` with `failure_class: infra`. Only answer `code` with
the log lines that prove it: a wrong `code` sends the developer after a problem the code does not have.

## Evidence

On success, report the preview/release URL so it can go in the PR/MR's Evidence section
(pr-description), and state the merge danger you observed (e.g. the release includes a migration).

## Never

Re-run a production deploy, delete regular releases, or change environments/secrets.
