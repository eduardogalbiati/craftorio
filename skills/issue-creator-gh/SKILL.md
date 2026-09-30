---
name: issue-creator-gh
description: Files, updates or comments on GitHub issues with the gh CLI, after searching for duplicates, using the issue-writing structure (context, evidence, decisions, verifiable acceptance criteria). Use when an agent must record a bug, an enhancement or a follow-up on GitHub.
uses: [issue-writing]
summary: "Search for duplicates, create/comment/edit issues with gh or glab, existing labels only"
used_by: "backlog planner (#30), any agent that files issues"
---

# Issue creator: GitHub (gh CLI)

Requires an authenticated `gh` (`gh auth status`). Write the content following `issue-writing`;
this skill covers only the commands.

## How to call gh

Call `gh` **bare, in the Bash tool, one command per call**, with `--repo <owner>/<repo>` on
every command (the working directory may be a worktree or another repository). No PowerShell
tool, no full paths, no `;`/`&&`/pipes, no files: long bodies go inline with `--body "..."`
(escape inner double quotes). Filter JSON with `--json` + `--jq`.

## Steps

1. **Find the repository**: `gh repo view --json nameWithOwner --jq .nameWithOwner` (or take it
   from the task).
2. **Search for duplicates**, open and closed:
   `gh issue list --repo <r> --state all --search "<2-4 keywords>" --json number,title,state --limit 20`.
   Try two different keyword sets. If one covers the problem:
   - add what is new as a comment: `gh issue comment <n> --repo <r> --body "..."`;
   - or, when the task list itself changes, edit the body: `gh issue view <n> --repo <r> --json body --jq .body`,
     then `gh issue edit <n> --repo <r> --body "<full new body>"` (keep the existing content).
3. **Check the label exists**: `gh label list --repo <r> --json name --jq '.[].name'`. Use only
   existing labels (`bug`, `enhancement`, `documentation`…); don't create labels.
4. **Create**: `gh issue create --repo <r> --title "<title>" --label <label> --body "<body>"`.
   It prints the issue URL.
5. **Link**: reference related issues in the body (`#<n>`); when a new issue splits or follows
   up another, comment on the other one with the new link.

## Output

Report the URL of each issue created or updated, and whether it was new, a comment, or an edit.

## Done when

Every problem ends up in exactly one issue (new or existing), each URL is reported, and nothing
was created with a label that doesn't exist.
