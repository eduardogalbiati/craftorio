---
order: 650
---

<!-- section:workflows -->
## Backlog Refresh (`workflows/backlog-refresh.yaml`)

Plan & Design, read-only on the code. Issues are written against the code of the day they were
filed; after a few merges their paths, line numbers and task lists drift. First, with no model, the
`repository` step finds the GitHub/GitLab repository (the skill's `apply.js --mode repo`): the clone's
`origin` or, for a project created from a local folder, that folder's own `origin`. With none behind it
the run stops at a gate that says so, before any model call. The `refresher` (Claude
Sonnet, git and gh/glab only to read, exploration sub-agents in batches, skill
`backlog-refresh-<git_platform>` on top of the shared `backlog-refresh`) reviews every open issue
(or the `issues` listed) against `base_branch` and the changes since `since`, and answers per issue
`current`, `update`, `partly_done`, `done`, `obsolete` or `duplicate` with evidence, exact
`{ find, replace }` edits for the safe fixes (paths, lines, renamed symbols, tasks done with
evidence), a new `complexity` when the size changed, and `scope` proposals. Its prompt names the repository, which
it copies into `repo`; an answer that would write to another repository is refused (`apply.js` resolves
it again), one with nothing to write is not. A transition action runs
the skill's `apply.js --platform gh|gl --mode safe` (no model): each `find` must match the current
body exactly once, an issue edited after the review (`updatedAt`) or closed is skipped, the refresh
note goes after a `<!-- backlog-refresh -->` marker (replacing an older one), and the platform keeps
the earlier bodies. The `scope` decision gate lists the proposed closes; only your **Apply** runs
`--mode scope` (closes with a comment); rewrites are only reported, and the supervisor never answers
the gate. The run never merges (`metadata.merges: false`): as a roadmap stage it is done when it
succeeds. The Backlog suggests it every 24 hours (see the Backlog screen). Run folder:
`refresh.json`, `report.md`, `applied-safe.json` / `applied-scope.json`, `bodies/<n>.md`.
