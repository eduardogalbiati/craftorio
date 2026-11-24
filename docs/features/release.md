---
order: 252
---

<!-- section:workflows -->
## Release (`workflows/release.yaml`)

Code & Build (#630: the old `e2e-release.yaml` name still runs it; the whole E2E suite is part of
every release). Decides "this set is good, ship it" (#260): the work of many runs merges into the
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
run as before. A release is an item of the roadmap of its own (#555), not a field of the stage
before it: `{ kind: 'release', id, name, status?, runId?, shippedAt? }` between two stages of
`roadmap.stages`. Disabling, emptying, moving or removing a stage leaves it in place, and a
disabled stage before it is skipped without holding it. The owner adds it ("Release here"), moves
it (↑ ↓ on its dashed line, one stage at a time, onto a stage with no release), renames and removes
it, each edit in the roadmap's history (Undo); a running or shipped release cannot be moved nor
renamed. Right after its dashed line the Roadmap draws its card in every state, a planned one
included: Planned, the stages it closes and the release run's estimate. The screen draws and edits
the roadmap folded (`RoadmapModel.foldReleases`: each entry as the `release` of the stage before it,
the ones with no stage before them in `leadReleases` with their place) and saves it unfolded
(`unfoldReleases`); the service gives a new release its id. An older roadmap's
`release` on a stage is read as a release entry right after that stage, with its status, run and
shipped date. Shipping records the release (version, date, issues, runs, cost, test results,
notes) in `<workspace>/releases/<project>.json` and marks its issues **Released** on the Backlog.
The discovery cards linked to one of those issues (`links.issues`) are marked Released too: their
`links.release` becomes the release's version, and a card keeps the first release that shipped it.

**Products** (#46). A repository that releases more than one thing declares them in
`.craftorio/project.yaml`:

```yaml
products:
  - id: app                      # what the run's Product input names
    folder: apps/desktop         # where its package.json (or pyproject.toml) is
    tag_prefix: v                # its tag: the prefix and the version, v1.2.0
    version_command: npm run bump-app  # writes the version and the changelog, commits nothing
    paths: [packages/ui]         # optional: its other folders
  - id: engine
    folder: packages/engine
    tag_prefix: engine-v
    version_command: npm run bump-engine
```

A release run then releases one product: its **Product** input (not needed with only one) and its
**Version** (`1.2.0`, `v1.2.0` or the product's own tag). Before the suites the run calls the product's
own command, checks that it wrote the version asked and commits every file it changed on the run's
branch; Ship tags `<tag_prefix><version>` and pushes only that tag. The run stops before the suites,
with nothing committed or tagged, when no product or an unknown one is chosen (it names the declared
ones), the products of the manifest have an error, the version is not a semver, is lower than the
product's or its tag names another commit, the command fails or commits by itself, or it wrote another
version (both are said). A product already at the version is released as it is, without a command, a
changeset or a version commit: that is how a first release goes out. The last release is the product's
own last tag (the review and the fix read the commits since it, or the repository's history without
one); another product's tag never counts. In a repository with a `.changeset` folder, the merged issues
that touched the product's folders since then and have no changeset of its packages
(`.changeset/<slug>-<issue>.md`, or `#<issue>` in its text) are in the run log and in the Ship gate: you
can ship anyway. The Releases screen and a cut line release the main product, the one tagged `vX.Y.Z`
(else the first declared); release another one from the Start panel (workflow **Release**, Product and
Version under Advanced parameters). Its shipped release is recorded under its tag and never counts as
the main product's last release. A simulation reads the same things and writes, tags and pushes nothing.
A repository without `products` is released as described above.

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
