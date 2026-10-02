---
name: backlog-refresh
description: Reviews every open issue of a repository against the code as it is now - renamed or moved files, line numbers that drifted, tasks already done on the base branch, issues made obsolete or duplicated by later work, complexity that changed - and returns exact text replacements for the safe fixes plus proposals for the scope changes the owner decides. Shared rules of backlog-refresh-gh / backlog-refresh-gl (and their apply.js).
summary: "Open issues vs today's code: exact find/replace fixes (paths, lines, done tasks, complexity), scope proposals (close, duplicate, rewrite) for the owner"
used_by: "backlog-refresh (refresher), through backlog-refresh-gh / backlog-refresh-gl"
---

# Backlog refresh

Issues are written against the code of the day they were filed. After a few merges their paths,
line numbers and task lists drift, and some are done or overtaken by other work. You find that
drift and describe the fix; a script (`apply.js` in this folder) applies your **safe** fixes
literally, and the owner decides the **scope** changes at a gate. You never edit, comment, label
or close anything yourself. The platform skill (`backlog-refresh-gh` / `backlog-refresh-gl`) says
how to read issues and pull/merge requests on your platform.

You run unattended: nobody answers questions. When unsure, leave the issue as it is and say why.

## 1. What changed

- The base branch is the truth: read the code with `git show <base>:<path>`, `git ls-tree -r
  --name-only <base>`, `git grep <pattern> <base>`, never the working tree (it may be on another
  branch).
- What moved since `since`: `git log <base> --since="<since>" --name-status -M --format="%h %s"`
  (a ref instead of a date: `<since>..<base>`). `R<score> old new` lines are renames; `D` deletions.
- What was closed or merged since: the platform's closed issues and merged PRs/MRs in that window.

## 2. Each open issue

List the open issues with their body and update time. When there are many, give batches of about
eight issues to exploration sub-agents started together, each with the list of renames and
deletions and these rules, and ask for the per-issue result below: their summaries enter your
context, the code they read does not.

For each issue decide one `verdict`:

| verdict | when |
|---|---|
| `current` | every path, symbol and line it cites still exists and says the same; nothing done yet |
| `update` | only references drifted: a path renamed or moved, a line number off, a symbol renamed, a link to an issue that was renumbered or split |
| `partly_done` | some tasks are visibly done on the base (the code, a test, a doc does what the task asks), others not; may also need `update` fixes |
| `done` | every task is done on the base: propose closing (scope) |
| `obsolete` | the problem no longer exists or the approach was replaced by later work: propose closing (scope) |
| `duplicate` | another open issue covers the same thing: propose closing as its duplicate (scope) |

Ground each verdict in evidence (commit sha, file:line on the base); a guess is `current`.

## 3. Safe fixes: exact replacements

Return `edits: [{ find, replace }]` per issue, applied in order to the issue's **current body**:

- `find` is copied **exactly** from the body (same backticks, spaces, punctuation), long enough to
  be unique (a whole line, or a path with its surrounding backticks). The script skips the whole
  issue when a `find` is missing or appears more than once.
- Allowed: a path or file name (`src/renderer/app.js:1537` → the new file and line), a line
  number, a renamed symbol, a ticked task with evidence (`- [ ] **Lead**` → `- [x] **Lead**`), a
  dead issue link replaced by the right one.
- Not allowed in `edits`: rewording a requirement, adding or removing tasks, changing a decision
  ("Decision (owner): ..." is never touched), anything you are not sure about. Those are
  `rewrite` proposals (scope).
- `complexity`: the new score 1-5 only when the remaining work clearly changed size (a task list
  half done, a refactor that already moved the files); otherwise 0 (unchanged).
- `note`: one sentence for the issue's refresh note ("Paths updated to the views/<screen>/
  layout of #153; task 2 done in 4b53b2b"). The script puts it at the end of the body after a
  `<!-- backlog-refresh -->` marker, replacing the note of an earlier refresh.

The script skips an issue that was edited after your review (its update time differs from your
`updated_at`) or that is no longer open.

## 4. Scope proposals (the owner decides)

`scope: [{ number, action, reason, duplicate_of }]` with `action`:
`close_done`, `close_obsolete`, `close_duplicate` (with `duplicate_of`; 0 otherwise), or `rewrite`
(criteria that no longer make sense: say what to change in `reason`; it is reported, never applied).
The owner sees them at a gate; the closes are applied only when they approve.

## 5. Answer

`repo` (owner/name, or the GitLab project path), `base`, `since`, `reviewed` (how many issues),
`issues` (one entry per open issue reviewed, `current` ones included, with `updated_at` exactly as
the platform gave it), `scope` and `report` (Markdown for the owner: counts per verdict, the issues
changed and why, the scope proposals, what you could not decide). Everything in English.
