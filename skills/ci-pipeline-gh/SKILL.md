---
name: ci-pipeline-gh
description: Pushes a branch to GitHub, opens or reuses its pull request, fails fast when it conflicts with the base, checks GitHub Actions status and triages failed runs down to a root cause (gh CLI). Use when you need to get a branch's CI green on GitHub.
uses: [ci-failure-triage, pr-description]
summary: "Push, PR/MR, mergeability (conflicts fail fast), CI status, missing checks, fetching failed logs, retrying flaky jobs"
used_by: "CI pusher"
---

# CI pipeline: GitHub (gh CLI)

Requires an authenticated `gh` (`gh auth status`). Run commands from the repository root.

## How to call gh

Your allowlist only accepts `gh` (and `git`) called **bare, in the Bash tool, one command per
call**: `gh pr view 12 --json state`. Every other form is refused, and each refusal burns a turn:

- no PowerShell tool, no `cmd /c`, no full or 8.3 path (`"/c/Program Files/GitHub CLI/gh.exe"`,
  `C:\PROGRA~1\...`): the orchestrator already put `gh` on the PATH;
- no `PATH`/`$env:PATH` changes, no variables, no `;`, `&&`, `||` or pipes: one command per call
  (use `--json` + `--jq` to filter instead of piping);
- long bodies go inline with `--body "..."` (no files, no `--body-file`, no heredocs).

If a bare `gh` call is refused, do not try other forms: answer with what you know and say that
`gh` is refused in your answer. The orchestrator stops a loop whose agent stays blocked.

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
- Not found → `gh pr create --base <base> --head <branch> --title "<title>" --body "<body>"`,
  with the title and body written following the pr-description skill (pass the body inline:
  you cannot write files, so no `--body-file`).

`pr_number` is the PR number; `pr_url` its URL.

## 3. Check mergeability (every time, before reporting `pending`)

GitHub does not start `pull_request` CI for a PR that conflicts with its base, so a
conflicting PR stays "pending" forever. Check it on every status check:

```
gh pr view <n> --json mergeable,mergeStateStatus,headRefOid,commits
```

- `mergeable: CONFLICTING` or `mergeStateStatus: DIRTY` → report `failed` right away. The
  `failure_log` says the branch conflicts with `<base>`, lists the conflicting files if you
  can find them (`git fetch origin && git merge-tree --write-tree --name-only origin/<base> <branch>`),
  and says the developer must merge `origin/<base>` into the branch, resolve, run the
  tests and push.
- `mergeable: UNKNOWN` → GitHub is still computing; go on to the CI checks.
- Anything else → go on to the CI checks.

## 4. Check CI status

```
gh pr checks <n> --json name,state,bucket,link,workflow
```

Map by `bucket`:
- any `pending` → `pending`
- any `fail` or `cancel` → `failed`
- everything `pass` or `skipping` → `success`
- no checks registered:
  - right after a push (head commit pushed less than ~10 minutes ago) → `pending`
  - later, find out why (`gh workflow list`, the `on:` triggers and path filters in
    `.github/workflows/*`, `gh run list --branch <branch> --limit 5` for runs waiting on
    approval):
    - no workflow runs for this PR by design (no workflows, triggers or path filters exclude
      it) → `success`, and say "no CI configured for this change" in your answer
    - otherwise (Actions disabled, runs waiting for approval, a trigger that should have
      fired) → `failed`, with a `failure_log` explaining why no check started. Never keep
      answering `pending` when nothing will ever run.

## 5. Triage a failure

1. Find the failed run: `gh run list --branch <branch> --json databaseId,name,conclusion,headSha,url --limit 10`
   (use the run whose `headSha` matches the PR head: `gh pr view <n> --json headRefOid`).
2. Get only the failing output: `gh run view <run-id> --log-failed`.
3. Classify and report it following ci-failure-triage; that is your `failure_log`.
4. Infrastructure/flaky: retry once with `gh run rerun <run-id> --failed` and report `pending`.

## Never

- Merge the PR, change branch protection, or edit workflow files to make CI pass.
- Mark `success` without checking the real state of every check.
