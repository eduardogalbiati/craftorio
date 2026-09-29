---
name: pr-babysitter-gl
description: Watches a GitLab merge request until it is mergeable - checks detailed merge status, conflicts, approvals and unresolved discussions, classifies each comment as actionable or doubtful, and replies with the fixing commit hash (glab CLI). Use to drive a GitLab MR to ready-to-merge.
uses: [pr-comment-triage]
---

# MR babysitting: GitLab (glab CLI)

In `glab api` paths, `:id` is replaced by the current project automatically.
`<iid>` is the MR number shown in the UI (`!123`).

## How to call glab

Your allowlist only accepts `glab` (and `git`) called **bare, in the Bash tool, one command per
call**: `glab mr view 12 --output json`. Every other form is refused, and each refusal burns a turn:

- no PowerShell tool, no `cmd /c`, no full or 8.3 path to `glab.exe`: the orchestrator already
  put `glab` on the PATH;
- no `PATH`/`$env:PATH` changes, no variables, no `;`, `&&`, `||` or pipes: one command per call;
- long bodies go inline with `--message "..."` / `-f body="..."` (no files, no heredocs).

Call `glab` again on **every** iteration, even if an earlier one was refused: never answer from
memory. If a bare `glab` call is refused, do not try other forms: say so in `summary`. The
orchestrator stops a loop whose agent stays blocked.

## 1. Read the MR state

```
glab mr view <iid> --output json
```

Key fields: `state` (`opened`/`merged`/`closed`), `draft`, `has_conflicts`, `detailed_merge_status`, `head_pipeline.status`.

| `detailed_merge_status` | Meaning |
|---|---|
| `mergeable` | ready to merge |
| `ci_must_pass`, `ci_still_running` | pipeline not green yet (check `head_pipeline.status`: `failed` → CI failed, otherwise waiting) |
| `conflict`, `need_rebase` | conflict with / behind the target branch |
| `discussions_not_resolved` | unresolved threads block the merge |
| `not_approved` | waiting for required approvals (`glab api "projects/:id/merge_requests/<iid>/approvals"` → `approvals_left`) |
| `draft_status` | MR is a draft: waiting (tell the human) |
| `checking`, `unchecked`, `preparing` | GitLab still computing: waiting |
| `blocked_status`, `jira_association_missing`, `external_status_checks` | blocked by a rule: needs human |

## 2. Find unresolved discussions

```
glab api "projects/:id/merge_requests/<iid>/discussions?per_page=100"
```

Open threads: notes with `resolvable: true` and `resolved: false`. Ignore system notes
(`system: true`) and bots that only report status.

## 3. Classify and reply

Classify each open comment and write `fix_request`/`question` following pr-comment-triage.
Replies, on the same discussion:

```
glab api -X POST "projects/:id/merge_requests/<iid>/discussions/<discussion-id>/notes" -f body="<reply>"
```

Resolve the thread only if it was an actionable request that is now fixed and the project lets
the author resolve threads:
`glab api -X PUT "projects/:id/merge_requests/<iid>/discussions/<discussion-id>?resolved=true"`.

Threads the human chose to justify or ignore stay open for the human to resolve. If they are
the only thing blocking the merge (`discussions_not_resolved`), report `waiting` and say so in
the summary; do not resolve them yourself.

## 4. Update a branch that is behind or conflicting

Ask for a fix (`needs_fix`): "update the branch with `<target>` (merge or rebase, per project
convention) and resolve the conflicts in <files>". You never push code yourself.

## Never

Merge, approve, unapprove, or change MR settings.
