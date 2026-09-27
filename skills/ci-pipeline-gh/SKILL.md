---
name: ci-pipeline-gh
description: Pushes a branch to GitHub, opens or reuses its pull request, checks GitHub Actions status and triages failed runs down to a root cause (gh CLI). Use when you need to get a branch's CI green on GitHub.
uses: [ci-failure-triage, pr-description]
---

# CI pipeline: GitHub (gh CLI)

Requires an authenticated `gh` (`gh auth status`). Run commands from the repository root.

## 1. Push the branch

```
git push -u origin <branch>
```

Never `--force` unless the orchestrator explicitly asks for it (then use `--force-with-lease`).

## 2. Ensure a pull request exists

```
gh pr list --head <branch> --base <base> --state open --json number,url
```

- Found → reuse it.
- Not found → `gh pr create --base <base> --head <branch> --title "<title>" --body-file <file>`,
  with the title and body written following the pr-description skill.

`pr_number` is the PR number; `pr_url` its URL.

## 3. Check CI status

```
gh pr checks <n> --json name,state,bucket,link,workflow
```

Map by `bucket`:
- any `pending` (or no checks registered yet, right after a push) → `pending`
- any `fail` or `cancel` → `failed`
- everything `pass` or `skipping` → `success`

## 4. Triage a failure

1. Find the failed run: `gh run list --branch <branch> --json databaseId,name,conclusion,headSha,url --limit 10`
   (use the run whose `headSha` matches the PR head: `gh pr view <n> --json headRefOid`).
2. Get only the failing output: `gh run view <run-id> --log-failed`.
3. Classify and report it following ci-failure-triage; that is your `failure_log`.
4. Infrastructure/flaky: retry once with `gh run rerun <run-id> --failed` and report `pending`.

## Never

- Merge the PR, change branch protection, or edit workflow files to make CI pass.
- Mark `success` without checking the real state of every check.
