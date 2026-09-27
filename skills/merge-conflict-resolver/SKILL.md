---
name: merge-conflict-resolver
description: Resolves merge or rebase conflicts hunk by hunk by tracing the intent of both sides from commits and PR/MR descriptions, preserving both intents, then verifies with typecheck, tests and formatting. Use when a branch must be updated with its base and git reports conflicts.
---

# Merge conflict resolution

Adapted from the resolving-merge-conflicts skill in mattpocock/skills (MIT). You run
unattended: record trade-offs instead of asking.

## 1. Assess

- Follow the repository's convention: merge the base into the branch, or rebase, whichever
  recent history shows. If unclear, **merge** (it does not rewrite pushed history).
- `git status` and `git diff --name-only --diff-filter=U` list the conflicted files.
- Never run `git merge --abort`/`git rebase --abort` to escape a hard conflict, and never
  `git push --force` unless the orchestrator explicitly asks (then `--force-with-lease`).

## 2. Trace intent, per side

For each conflicted file, find out **why** each side changed it:
- `git log --oneline <base>..HEAD -- <file>` (ours) and `git log --oneline HEAD..<base> -- <file>` (theirs);
- the commit messages and the PR/MR titles/descriptions they belong to;
- the task you are working on.

## 3. Resolve hunk by hunk

- **Preserve both intents** whenever possible: usually the result contains both changes,
  adapted to each other (a renamed function plus a new call site means the new call uses the new name).
- Never invent behaviour that neither side had.
- Lockfiles and generated files: do not hand-merge; take the base version and regenerate
  with the project's tool (`npm install`, `uv lock`, `go mod tidy`, ...).
- If the intents are truly incompatible, resolve toward the goal of this branch's task and
  record the trade-off.

## 4. Verify

Run, as the project supports: typecheck/compile, the test suite, the formatter/linter.
Only then `git add` the files and commit (merge) or `git rebase --continue`.

## Report

Per file: the intent of each side, how you combined them, and any trade-off made
(these go to the human reviewer). Include the resulting commit hash.

## Done when

No conflict markers remain (`git diff --check` and a grep for `<<<<<<<` come back clean), the
build and tests pass, and the resolution is committed.
