---
name: pr-babysitter-gh
description: Watches a GitHub pull request until it is mergeable - checks mergeability, conflicts, reviews and unresolved review threads, classifies each comment as actionable or doubtful, and replies with the fixing commit hash (gh CLI). Use to drive a GitHub PR to ready-to-merge.
uses: [pr-comment-triage]
---

# PR babysitting: GitHub (gh CLI)

## 1. Read the PR state

```
gh pr view <n> --json state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,comments,reviews
gh pr checks <n> --json name,bucket
```

| Signal | Meaning |
|---|---|
| `state: MERGED` / `CLOSED` | merged / closed without merge |
| any check `bucket: fail` | CI failed |
| `mergeable: CONFLICTING` or `mergeStateStatus: DIRTY` | conflict with base |
| `mergeStateStatus: BEHIND` | base moved; branch must be updated if the repo requires it |
| `mergeable: UNKNOWN` | GitHub still computing: treat as waiting |
| `reviewDecision: REVIEW_REQUIRED` | waiting for a required review |
| `reviewDecision: CHANGES_REQUESTED` | there are change requests to handle |
| `mergeStateStatus: CLEAN` (or `HAS_HOOKS`/`UNSTABLE` with only non-required checks failing) + approved or no review required | ready to merge |

## 2. Find unresolved review threads

Review threads are only available through GraphQL:

```
gh api graphql -F owner='{owner}' -F repo='{repo}' -F n=<n> -f query='
query($owner:String!,$repo:String!,$n:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$n){
  reviewThreads(first:100){nodes{id isResolved isOutdated
    comments(first:20){nodes{databaseId author{login} body path line url}}}}}}}'
```

Also read top-level conversation comments (`comments` from `gh pr view`). Ignore bots that only
report status (coverage, preview links) and comments already answered by the author.

## 3. Classify and reply

Classify each open comment and write `fix_request`/`question` following pr-comment-triage.
Replies, on the same thread:

```
gh api -X POST repos/{owner}/{repo}/pulls/<n>/comments/<comment-databaseId>/replies -f body="<reply>"
```

Top-level comment: `gh pr comment <n> --body "<reply> (re: <link to comment>)"`.
Do not resolve threads yourself unless the repository convention is that the author resolves them.

## 4. Update a branch that is behind or conflicting

Ask for a fix (`needs_fix`) with: "update the branch with `<base>` (merge or rebase, per repo
convention) and resolve the conflicts in <files>". You never push code yourself.

## Never

Merge, approve, dismiss reviews, or resolve a thread the human decided to keep open.
