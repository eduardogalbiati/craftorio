---
order: 230
---

<!-- section:local-hero -->
- **Issues close when you push**: commits end with `Closes #<n>` for the run's issues, so GitHub closes them when you push the base branch. Until then the Backlog shows them in **Merged locally** (a "not pushed" badge), not in Done: Done means closed on GitHub/GitLab.
- **A project with no remote** (#73) has no push: `push_main` ends with "Merged locally, this project has no remote", with no warning, and the Backlog shows no push status. The run closes the local issues it was started for when it ends well, with the run and the merge commit in each issue's record (`closedBy`).
- **Push from the Backlog**: when the project's local base has commits that `origin/<base>` hasn't (checked with a fetch on every Backlog sync and after every local merge), a bar above the issues says how many and which issues they close. **Push…** lists the commits, then runs `git push origin <base>` in the project's repository (the clone under `<workspace>/repos/`, not your own checkout): never forced, never another branch. The Backlog syncs afterwards, so the closed issues move to Done. The sidebar's Backlog item and the project's page show the count of commits not pushed; the run's chat and its notification say "merged locally, not pushed yet".
- **When `origin` moved** (a PR merged meanwhile), the push is rejected: **Update and push** runs `git pull --rebase origin <base>` where the base is checked out (a temporary worktree when it is checked out nowhere), then pushes. A conflict undoes the update (the local base keeps every local commit), lists the files, and offers **Resolve in a run**: a run of the local workflow whose developer merges `origin/<base>` into the local commits and resolves the conflict; after review, tests and the local merge, **Push** goes through as a fast-forward. The run calls the agents' CLIs (real cost) unless simulated.
- **Auto-push** (per project, off by default): the checkbox on the Backlog's bar pushes the base after every successful local merge; a rejected push only notifies you.
- Or push yourself: `git push origin main` from the repository.
