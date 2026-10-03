---
order: 140
---

<!-- section:workflows -->
**Merge conflicts at the approval.** With several runs at once, a PR/MR that was clean when checked
can conflict by the time you approve it. The engine checks the PR/MR itself (`gh pr view` /
`glab mr view`, no model call) right before `approve_merge` opens (the message says "CI green and
mergeable, checked at …"), again whenever another run merges into the same repository while the
gate is open, and once more right before the merge; merges of concurrent runs go one at a time. A
PR/MR that is not mergeable is never merged and never offered for approval: the run supervisor
decides first. A conflict sends the run back to `resolve_conflict` (the developer merges
`origin/<base>` into the branch and resolves it, skill `merge-conflict-resolver`), then
`code_review` of the resolution only (the merge commit, not the whole change), the full suite, CI,
the PR check, a new preview and `approve_merge` again: the code changed after your first "yes", so
you approve again. The supervisor's record ("went back to resolve_conflict at 00:10 UTC because
PR #64 conflicted with main after the #35 merge") shows in the run chat, `decisions.tsv` and the
Backlog card. Anything else, 2 rounds, or no supervisor interventions left → the `merge_failed` gate,
with the supervisor's diagnosis.
