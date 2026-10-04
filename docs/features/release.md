---
order: 252
---

<!-- section:workflows -->
## Release (`workflows/release.yaml`)

Code & Build. Decides "this set is good, ship it" (#260): the work of many runs merges into the
local base one after another, and a release run checks their sum. It runs the project's whole unit
suite, then its whole E2E suite, in its own worktree of the local base, with no agent while they
are green. A red suite calls the developer with the history since the last release (the runs,
their issues, decisions and handoff notes, the commits) to find and fix the regression, then both
suites run again, at most `max_rounds`. Then the **Ship** gate, yours only (never the supervisor,
a timeout or `--auto-approve`): **Ship** merges a fix made by the run, pushes the local base to
origin (never forced), tags it with the release's name and runs the optional `build_command`;
**Hold** ends the run with nothing pushed (resume it from the gate to ship later).

It starts from Code & Build › Releases, or when a roadmap reaches a **cut line**: "Release here"
on a stage of the Roadmap draws one after it, with the release's name, and the stages after the
line wait until that release shipped (a held or failed release pauses the roadmap there). Roadmaps
without cut lines run as before. Shipping records the release (version, date, issues, runs, cost,
test results, notes) in `<workspace>/releases/<project>.json` and marks its issues **Released**
on the Backlog; `markReleased` (src/releases.js) does the same for the discovery cards linked to them.
