---
name: deploy-gl
description: Publishes a merge request preview (GitLab pipeline with DEPLOY_TARGET=preview, review app or pre-release) and tracks the production pipeline triggered by the merge, diagnosing failed jobs (glab CLI). Use for preview and production deploys on GitLab.
uses: [ci-failure-triage]
summary: "Preview and production deploy tracking and cleanup"
used_by: "deployer"
---

# Deploy: GitLab (glab CLI)

In `glab api` paths, `:id` is replaced by the current project automatically.

## How to call glab

Your allowlist only accepts `glab` (and `git`) called **bare, in the Bash tool, one command per
call**: `glab ci list --per-page 5`. Every other form is refused, and each refusal burns a turn:

- no PowerShell tool, no `cmd /c`, no full or 8.3 path to `glab.exe`: the orchestrator already
  put `glab` on the PATH;
- no `PATH`/`$env:PATH` changes, no variables, no `;`, `&&`, `||` or pipes: one command per call;
- long texts go inline with `--notes "..."` (no files, no heredocs).

If a bare `glab` call is refused, do not try other forms: say so in `error_summary`. The
orchestrator stops a loop whose agent stays blocked.

Convention in this project:
- **Preview** = a pipeline on the MR branch run with variables `DEPLOY_TARGET=preview` and
  `MR_IID=<iid>`. Its deploy job publishes a review app (environment `review/<branch>`) and/or a
  release tagged `preview-mr-<iid>`. The workflow inputs `preview_workflow`/`deploy_workflow`
  are GitHub file names and are not used here.
- **Production** = the pipeline that runs on the target branch after the merge.

Check `.gitlab-ci.yml` once to confirm which of these the project actually uses (job names,
`rules:` on `DEPLOY_TARGET`, `environment:` blocks) and follow what is there.

## Preview

Trigger (only if not triggered yet, or the last attempt failed):

```
glab ci run --branch <branch> --variables "DEPLOY_TARGET:preview" --variables "MR_IID:<iid>"
```

Track it: `glab api "projects/:id/pipelines?ref=<branch>&per_page=5&order_by=id"` → newest
pipeline created after the trigger.

- `created`, `pending`, `running`, `waiting_for_resource`, `preparing` → `pending`
- `manual` → the deploy job needs a click: report `pending` and name the job; if it stays manual
  across checks, report `failed` with "manual deploy job not started"
- `success` → `success`; `release_url` = environment URL
  (`glab api "projects/:id/environments?search=review/<branch>"` → `external_url`)
  or `glab release view preview-mr-<iid>` URL
- `failed`, `canceled` → `failed`; summarize the failed job (`glab ci trace <job-id>`) and set
  `failure_class` (see below)

After a fix the preview is triggered again: track the pipeline of the branch's current head
(`git ls-remote origin refs/heads/<branch>` gives the sha; pick the pipeline whose `sha` matches),
never the older failed pipeline.

## Production (after the merge)

1. Merge commit: `glab mr view <iid> --output json` → `merge_commit_sha` (or `squash_commit_sha` when squashed).
2. Pipeline for that commit: `glab api "projects/:id/pipelines?ref=<target>&sha=<sha>"`.
3. Map status as in the preview. On `success`:
   - `release_url`: `glab release list` (latest non-preview) or the production environment `external_url`;
   - clean up the preview: `glab release delete preview-mr-<iid> --with-tag --yes` and stop the
     review environment if one exists (`glab api -X POST "projects/:id/environments/<env-id>/stop"`).
     Ignore "not found".

## Failure summary and class

`error_summary` follows ci-failure-triage. Every `failed` answer also carries `failure_class`,
which decides what the orchestrator does next:

| failure_class | When | Next |
|---|---|---|
| `code` | a commit on the branch can fix it: compile, test or lint errors (including tests that only fail on the preview's runner), a lockfile out of sync, a build script or `.gitlab-ci.yml` in the repository (triage classes code and environment drift) | the developer fixes it; CI, the MR check and the preview run again |
| `infra` | no commit can: runner lost, network or registry errors, timeouts, quota, a missing variable or permission, a protected environment waiting for approval, a manual job nobody started (triage classes infrastructure and needs-human) | a human decides: publish again or stop |
| `unknown` | the log does not tell | a human decides |

For a preview failure that looks like infrastructure, trigger it once more yourself and answer
`pending`; if it fails again, answer `failed` with `failure_class: infra`. Only answer `code` with
the log lines that prove it: a wrong `code` sends the developer after a problem the code does not have.

## Evidence

On success, report the preview/release URL so it can go in the PR/MR's Evidence section
(pr-description), and state the merge danger you observed (e.g. the release includes a migration).

## Never

Retry a production deploy job, delete regular releases, or change environments/variables.
