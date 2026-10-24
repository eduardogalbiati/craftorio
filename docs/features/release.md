---
order: 252
---

<!-- section:workflows -->
## Release (`workflows/release.yaml`)

Code & Build. Decides "this set is good, ship it" (#260): the work of many runs merges into the
local base one after another, and a release run checks their sum. For a Node project (a
`package.json`), it first writes the release's version (a semver such as `1.2.0` or `v1.2.0`) into
`package.json` and the root of its lockfile and commits it on the run's branch, so the suites check
the commit Ship tags (#325; a name that is not a semver, a project without `package.json` or a lower
version writes nothing and the run log says why). It runs the project's whole unit suite, then its
whole E2E suite (`e2e_suite: skip` for a project without one), in its own worktree of the local
base, with no agent while they are green; a test that fails there is never waved through as
"failing on the base too". A red suite calls the developer with the history since the last release
(the runs, their issues, decisions and handoff notes, the commits) to find and fix the regression,
then both suites run again, at most `max_rounds`: the unit suite whole, the E2E suite first only on
the feature files that failed in its previous round, then whole once they pass (#324: only a green
whole pass leads to Ship). Then the **Ship** gate, yours only (never the supervisor, a timeout or
`--auto-approve`): **Ship** merges the run's version commit and fix, pushes the local base to
origin (never forced), tags it with the release's name and runs the optional `build_command`; it
is refused when the local base moved since the suites ran (another
run merged: check the release again) or when the tag already names another commit. **Hold** ends
the run with nothing pushed (resume it from the gate to ship later).

When the run needed a fix or a second round, a **Release summary** step runs before Ship (#290): a
cheap read-only agent (Sonnet, one turn, 5 minutes, no edit, no web) gets the round-by-round trail,
every fix round's `summary`, `regression`, `test_notes` and commit, both suites' results, the fix
branch's `git log --stat`, the release's version, the project's version and its last tags, and
writes a verdict line, a Timeline table, The fixes (what, why, and whether each was a regression, an
older defect or the machine), Before you ship (the diff's size, what Ship does, anything that does
not match, e.g. the version against `package.json`) and Follow-ups. It leads the Ship gate's
message, is saved as `release-summary.md` (Reports in the run's Artifacts) and is linked from the
release on the Releases screen. It is a recommendation: the choices are unchanged and only you
answer the gate. A run with one green round of each suite skips it; a review that fails or times out
never blocks: the gate opens with a line saying the summary is missing.

It starts from Code & Build › Releases, or when a roadmap reaches a **cut line**: "Release here"
on a stage of the Roadmap draws one after it, with the release's name, and the stages after the
line wait until that release shipped (a held or failed release pauses the roadmap there; a release
run of that name started from the Releases screen is the line's too). Roadmaps without cut lines
run as before. Shipping records the release (version, date, issues, runs, cost, test results,
notes) in `<workspace>/releases/<project>.json` and marks its issues **Released** on the Backlog.
The discovery cards linked to one of those issues (`links.issues`) are marked Released too: their
`links.release` becomes the release's version, and a card keeps the first release that shipped it.

**Release candidates and stable releases** (#489). There are two kinds of release. A **candidate**
(`vX.Y.Z-rc.N`, N counting the merges since the last stable) is recorded for every merge into the
base, with its run and its issues, and the project's Deploy workflow publishes it as a prerelease,
never as the latest. The **stable** release is a candidate promoted without a rebuild: its commit is
tagged `vX.Y.Z` and pushed, and Deploy renames that candidate's release and marks it latest. Code &
Build › Releases lists the candidates since the last stable (newest first): **Promote to stable**
opens a dialog with the suggested version (the #436 suggestion over the issues since the last
stable: major on `breaking`, minor on `enhancement`, else patch), editable before you confirm; a
commit without a candidate is refused with the reason. **Hold** keeps the night's train from
promoting a candidate (click again to release it); the next merge makes a new candidate. The
**release train** runs when the Night watch ends: with merges since the last stable and the base
check green on the last candidate's commit, it promotes it when the night permission **Promote a
release** is on (off by default), else proposes it for the morning; a red base check or a candidate
on Hold holds it and says why. A cut line still starts the full release run above.
