---
order: 720
---

<!-- section:workflows -->
## Analyze project (`workflows/analyze-project.yaml`)

Monitor & Improve (#372, #378, #631: the old `project-map.yaml` and `refactor-proposals.yaml` names
still run it). The project's city, its architecture analysis and its refactor proposals in one
workflow, started from a project's Architecture tab ("Analyze this project", its estimate next to it:
one click, no confirmation), by hand from Workflows or by a pipeline. Inputs: `repo_path`,
`project_id`, `mode` (`auto` or `validated`), `analyze` (on by default), `since` and `limit` (the
issues to file, default 5).

**The map** (without `since`). The `facts` step counts the tracked files by folder and by file-name
pattern, lists the manifests and reads #371's folder city with its edges (no model). The cartographer
(skill `project-map`, read-only on the project) answers a city plan: zones, districts, landmarks and
ports as path rules. `validate` runs the city model's validator (schema, duplicate ids, unknown zones,
at least 95% of the drawn files in a district); a failing plan goes back to the cartographer with the
report at most twice, then the run fails and nothing is saved. A valid plan is saved at once
(`<workspace>/architecture/<project id>/city-plan.json`; the plan it replaces goes to
`city-plan-history/`). In validated mode the gate shows the plan's zones and districts and its
validation first, and only an approval saves. Then `analyze` runs the Oracle's architecture analysis
of the project (one Oracle turn in its daily budget, saved as the Architecture tab's reports are). A
refresh starts from the saved plan and keeps its ids and names. The tab advises a refresh when more
than 5% of the drawn files match no district or a new top-level folder appears.

**The refactor proposals** (with `since`, a tag or a commit: the "since the last tag" mode, what
`refactor-proposals.yaml` did). The map is skipped:
1. **Facts** (no agent): the Architecture facts at the project's default branch and the files changed
   since `since`.
2. **Analysis** (the analyst, read-only, the one real model call): #356's report, with the
   Architecture tab's own schema.
3. **Proposals** (no agent): the findings become Refactor tab proposals; one that matches an open or
   dismissed proposal, or an open `refactor` issue, is dropped and the run names it.
4. **Ranking**: #357's Product Owner ranking; the top `limit` kept.
5. **Gate** (validated mode only): dismiss the ones to drop on the Refactor tab, then approve.
6. **File**: "File as issue" for each kept proposal, with the `refactor` label (a simulation previews,
   no `gh`).

Outputs: `issues` (the filed issues, for a pipeline's `product_owner` or `queue` target) and `report`.
The bundled pipeline **`pipelines/release-then-refactors.yaml`** runs a release, then this workflow
since the release's previous tag (`since` ← `previous_version`), then the Product Owner places the
filed issues in the roadmap. The release's gates and Ship stay human; the analysis is one real model
call (about $0.50, estimated like the Architecture tab's).
