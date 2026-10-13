---
order: 720
---

<!-- section:workflows -->
## Project map (`workflows/project-map.yaml`)

Plan & Design, started from a project's Architecture tab ("Map this project", or "Refresh the
map" once a plan is saved, each with its estimate first). The `facts` step counts the tracked
files by folder and by file-name pattern, lists the manifests and reads #371's folder city with
its edges (no model). The cartographer (skill `project-map`, read-only on the project: it never
edits code, docs or agent instructions) answers a city plan: zones, districts, landmarks and ports
as path rules. `validate` runs the city model's validator (schema, duplicate ids, unknown zones,
at least 95% of the drawn files in a district); a failing plan goes back to the cartographer with
the report at most twice, then the run fails and nothing is saved. The gate shows the plan and its
validation (on a refresh: the districts added and removed, the coverage before and after); approved,
`save` writes `<workspace>/architecture/<project id>/city-plan.json` (the plan it replaces goes to
`city-plan-history/`). A refresh starts from the saved plan and keeps its zone and district ids and
the names the owner saw. The tab advises a refresh, without starting one, when more than 5% of the
drawn files match no district or a new top-level folder appears.
