---
name: issue-creator-gl
description: Files, updates or comments on GitLab issues with the glab CLI, after searching for duplicates, using the issue-writing structure (context, evidence, decisions, verifiable acceptance criteria). Use when an agent must record a bug, an enhancement or a follow-up on GitLab.
uses: [issue-writing]
summary: "Search for duplicates, create/comment/edit issues with gh or glab, existing labels only (new ones only when a person confirmed them)"
used_by: "issue-tracker (code_analyzer, issue_filer), backlog planner (#30), any agent that files issues"
---

# Issue creator: GitLab (glab CLI)

Requires an authenticated `glab` (`glab auth status`). Write the content following
`issue-writing`; this skill covers only the commands.

## How to call glab

Call `glab` **bare, in the Bash tool, one command per call**, with `--repo <group>/<project>`
(or the full project URL for self-hosted GitLab) on every command. No PowerShell tool, no full
paths, no `;`/`&&`/pipes, no files: long descriptions go inline with `--description "..."`
(escape inner double quotes). Read JSON with `--output json`.

## Steps

1. **Find the project**: `glab repo view --output json` (field `path_with_namespace`), or take
   it from the task.
2. **Search for duplicates**, open and closed:
   `glab issue list --repo <r> --all --search "<2-4 keywords>" --output json`.
   Try two different keyword sets. If one covers the problem:
   - add what is new as a note: `glab issue note <iid> --repo <r> --message "..."`;
   - or, when the task list itself changes, read the description
     (`glab issue view <iid> --repo <r> --output json`, field `description`) and replace it:
     `glab issue update <iid> --repo <r> --description "<full new description>"` (keep the
     existing content).
3. **Check the label exists**: `glab label list --repo <r> --output json`. Use only existing
   labels; don't create labels. Only exception: your task lists labels a person confirmed
   creating (the issue-tracker's review gate): create exactly those that are still missing, once,
   `glab label create --repo <r> --name <name> --color "#<hex>"`.
4. **Create**: `glab issue create --repo <r> --title "<title>" --label <label> --description "<body>" --yes`.
   It prints the issue URL. A description with a product-wide "Decision (owner)" line has the
   Docs task "record the decision in `docs/agents/decisions.md`" (see `issue-writing`).
5. **Link**: reference related issues in the description (`#<iid>`); when a new issue splits or
   follows up another, add a note on the other one with the new link.

## Output

Report the URL of each issue created or updated, and whether it was new, a note, or an edit.

## Done when

Every problem ends up in exactly one issue (new or existing), each URL is reported, and nothing
was created with a label that doesn't exist.
