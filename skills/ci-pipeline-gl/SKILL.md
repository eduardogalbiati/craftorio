---
name: ci-pipeline-gl
description: Pushes a branch to GitLab, opens or reuses its merge request, checks GitLab CI pipeline status and triages failed jobs down to a root cause (glab CLI). Use when you need to get a branch's CI green on GitLab.
uses: [ci-failure-triage, pr-description]
---

# CI pipeline: GitLab (glab CLI)

Requires an authenticated `glab` (`glab auth status`). Run commands from the repository root.
In `glab api` paths, `:id` is replaced by the current project automatically.

## 1. Push the branch

```
git push -u origin <branch>
```

Never `--force` unless the orchestrator explicitly asks for it (then use `--force-with-lease`).

## 2. Ensure a merge request exists

```
glab mr list --source-branch <branch> --target-branch <base> --output json
```

- Found → reuse it.
- Not found → `glab mr create --source-branch <branch> --target-branch <base> --title "<title>" --description "<body>" --yes`,
  with the title and body written following the pr-description skill.

In the workflow output, `pr_number` is the MR **iid** and `pr_url` its `web_url`.

## 3. Check pipeline status

Prefer the MR pipeline (it may differ from the branch pipeline):

```
glab api "projects/:id/merge_requests/<iid>/pipelines?per_page=1"
```

Map the latest pipeline `status`:
- `created`, `waiting_for_resource`, `preparing`, `pending`, `running`, `scheduled` (or none yet) → `pending`
- `failed`, `canceled` → `failed`
- `success` → `success`
- `manual` → the pipeline is waiting on a manual job: `pending`, and say which job in the summary
- `skipped` → `success` only if the project has no required jobs for this change; otherwise `failed` and explain

## 4. Triage a failure

1. Failed jobs: `glab api "projects/:id/pipelines/<pipeline-id>/jobs?scope[]=failed"`
   (jobs with `allow_failure: true` do not block; ignore them). The job's `failure_reason`
   (`runner_system_failure`, `stuck_or_timeout_failure`, `scheduler_failure`) points to infrastructure.
2. Log: `glab ci trace <job-id>` (or `glab api "projects/:id/jobs/<job-id>/trace"`); keep the tail.
3. Classify and report it following ci-failure-triage; that is your `failure_log`.
4. Infrastructure/flaky: retry once with `glab ci retry <job-id>` and report `pending`.

## Never

- Merge the MR, change protected-branch settings, or edit `.gitlab-ci.yml` to make CI pass.
- Mark `success` without checking the real pipeline state.
