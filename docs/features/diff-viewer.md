---
order: 125
---

<!-- section:workflows -->
### Reviewing a run's changes

The diff viewer shows a run's changed files the way GitHub's "Files changed" does. It opens from a
gate's **Show the diff**, from a **Changed files** entry of the gate's Artifacts panel (on that
file), and from **Review changes** on the Run screen of any run with a worktree or reported files.
The changes are `git diff --find-renames <base>...HEAD` in the run's worktree: everything since
the merge base with the run's base branch. They are read-only: nothing is checked out or written.

- **Files** on the left are grouped by folder. Each has an added / modified / deleted / renamed
  icon and `+n −m` counts, and a filter box narrows the list. Mark a file **Viewed** to track your
  progress ("n of m viewed", remembered per run). ↑ / ↓ or j / k move between files.
- **The diff** is **Split** (before | after, aligned, line numbers on both sides) or **Unified**,
  switchable at any time and remembered. Both modes have syntax highlighting, word-level
  highlights and **Wrap lines**. Unchanged regions are collapsed; ↑ 20 / ↓ 20 / **Expand all**
  shows them.
- **Binary files** say "Binary file changed", and images show before and after previews (click to
  enlarge). Huge files such as lockfiles are collapsed with **Load diff**.
- **Commits** shows all the branch's changes or only one of its commits, e.g. the developer's new
  commit after *Ask for changes*.
- **Esc** or ✕ closes it, and the gate is still there. A simulated run (no worktree) lists the files
  the developer reported, with a "Simulated: no diff" note.
