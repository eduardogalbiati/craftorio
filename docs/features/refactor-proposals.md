---
order: 257
---

<!-- section:workflows -->
## Refactor proposals (`workflows/refactor-proposals.yaml`)

Monitor & Improve (#378). The Architecture tab's analysis (#356) and the Refactor tab's proposals
(#357) as a workflow, so a pipeline can suggest refactors after a release. Inputs: `project_path`,
an optional `since` (a tag or a commit), `limit` (the issues to file, default 5) and `mode`
(`auto` or `validated`).

1. **Facts** (no agent): the Architecture facts at the project's default branch and the files changed
   since `since`; the analyst's prompt is #356's, focused on the Danger Zone and those files.
2. **Analysis** (the analyst, read-only, the one real model call): #356's report, with the
   Architecture tab's own schema (`output_schema: architecture_report`).
3. **Proposals** (no agent): the findings become Refactor tab proposals; a finding that matches an
   open or dismissed proposal, or an open `refactor` issue, is dropped and the run names it.
4. **Ranking**: #357's Product Owner ranking, saved as the Refactor tab saves it; the run's new
   proposals in rank order, the top `limit` kept.
5. **Gate** (validated mode only): the ranked proposals; dismiss the ones to drop on the Refactor
   tab, then approve to file the others.
6. **File**: #357's "File as issue" for each kept proposal, with the `refactor` label and the
   Refactor workflow named (a simulation previews, no `gh`).

Outputs: `issues` (the filed issues, for a pipeline's `product_owner` or `queue` target) and `report`
(the analysis). `release.yaml` declares `previous_version` (the tag before the release) and
`commit` (the shipped commit), so the bundled pipeline **`pipelines/release-then-refactors.yaml`**
runs a release, then the refactor proposals since its previous tag (`since` ← `previous_version`),
then the Product Owner places the filed issues in the roadmap. The release's gates and Ship stay
human; the analysis is one real model call (about $0.50, estimated like the Architecture tab's).
