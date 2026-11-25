---
order: 170
---

<!-- section:workflows -->
## Fix (`workflows/fix.yaml`)

Code & Build (#630). A bug from its reproduction to the merge: reproduce → develop → rule checks
→ code review → suite → verify → merge. The rule checks (#50, no agent) run after each fix commit, with
Feature's rounds and gates (Rule checks: what is found in a project). The developer first gets one command that shows the bug for the reported
reason (a failing regression test when it can), then fixes the root cause with the regression test
that failed before it (skill `bug-diagnosis`). `mode` works as in Feature: `local` merges into the
local base and pushes it, `remote` opens a PR/MR and waits for its CI. `hotfix` marks the urgent lane:
the smallest change, meant for a patch release from the last tag.
