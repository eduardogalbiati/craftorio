---
name: project-map
description: Draft (proof of concept). Write a city plan for any repository - zones, districts, landmarks and ports as path rules - that a deterministic renderer applies to every file to draw the project as a 3D city.
---

# Project map: the city plan

You are the cartographer. You read a repository and write its **city plan**: a small JSON file that
says what the code is for, as rules over paths. You do not measure anything and you do not place
files one by one: a deterministic step lists the files, measures them (lines, churn from git,
complexity and imports with the language's own tools) and applies your rules to each file, every
time the city is drawn. A new file lands in the right district without asking you again.

The plan is the only thing an AI writes. Keep it short, true and stable.

## What you read (evidence, not guesses)

1. The file tree (`git ls-files`), counted by folder and by file-name pattern (suffixes such as
   `_tests`, `_ui`, `_cmds`, `.test.js`, `Controller`).
2. The manifests: `package.json` (scripts, bin, main), `Cargo.toml` (workspace members, each crate's
   `description` and internal dependencies), `go.mod`, `pyproject.toml`, `pom.xml`, `*.csproj`.
3. The project's own words: `README`, `AGENTS.md` / `CLAUDE.md`, `docs/` architecture pages,
   header comments of the entry points.
4. The deterministic step's import graph when it is given to you (who depends on whom between
   folders): it tells which areas are foundations and which sit on top.

Every zone, district and landmark you write must be traceable to one of these. If the code does not
say what an area is for, name it after what it contains, not after what you imagine.

## The vocabulary

**Zones** (5 to 9) are the big areas, separated by avenues. Each has one `kind`, which sets the
ground and the building material:

| kind | what goes there | looks like |
| --- | --- | --- |
| `civic` | entry points and wiring: app main, server, CLI, routing, dependency injection | downtown, plazas |
| `commercial` | what the user sees: screens, views, panels, widgets, styles | glass facades |
| `industrial` | the core logic: engines, pipelines, algorithms, domain rules | factories |
| `infrastructure` | shared foundations: types, models, utilities, adapters used everywhere | concrete, pipes |
| `logistics` | data in and out: I/O, formats, codecs, persistence, network clients | warehouses near the port |
| `power` | native, GPU, shaders, sidecars, performance kernels | a power plant |
| `workshop` | tooling: build, scripts, generators, `xtask`, CI | sheds |
| `library` | bundled content that is not code: prompts, skills, templates, workflow definitions | a library |
| `campus` | tests, fixtures, examples, benchmarks | a campus with lawns |

Use the kinds as given; two zones may share a kind (e.g. two `industrial` zones).

**Districts** (3 to 30 in total, each with 3 or more files; merge smaller ones) are the
responsibilities inside a zone, named in the project's own words ("Run machine", "Codecs",
"Roadmap and backlog"), not just copied from a folder name. A folder is a strong hint, not the rule:
a flat folder of 300 files may hold four districts told apart by file-name patterns, and tests that
live next to the code (`*_tests.rs`, `*.test.ts`) belong to the campus.

**Landmarks** (up to 10) are single files a newcomer should find first: the entry points, the
central registry or router, the main model. Each with a short `label`.

**Ports** (up to 8) are the external systems the code talks to (a cloud API, another CLI, a
database, a browser runtime), each with the files that talk to it (`via`). Only systems the code
really calls.

## Rules over paths

- `include` / `exclude` are globs relative to the repository root, with the app's glob rules
  (`src/shared/globs.js`): `**` crosses folders, `*` and `?` do not; a pattern without a slash
  matches the file name at any depth (as in .gitignore); a leading `/` anchors it to the root
  (`/*` = the files at the root). **The first district whose rules match wins**, in the order you list them: put specific
  districts before general ones (`crates/ui-egui/src/*_tests.rs` before `crates/ui-egui/**`).
- `ignore` lists what is not drawn at all (binary assets, lock files, generated output, vendored
  code). Markdown docs are drawn only if you give them a district.
- Coverage: at least 95% of the files that are not ignored must match a district. The validator
  lists the ones that do not; fix the rules, do not add a catch-all district named "misc".

## The plan file

```json
{
  "version": 1,
  "project": "<name>",
  "summary": "<two sentences: what the project is and how it is built>",
  "ignore": ["assets/**", "**/*.png"],
  "zones": [
    { "id": "core", "name": "Image core", "kind": "industrial", "purpose": "<one sentence>" }
  ],
  "districts": [
    { "id": "engine", "name": "Engine", "zone": "core", "purpose": "<one sentence>",
      "include": ["crates/engine/src/**"], "exclude": ["**/*_tests.rs"] }
  ],
  "landmarks": [ { "path": "apps/photocraft/src/main.rs", "label": "Desktop app entry" } ],
  "ports": [ { "id": "github", "name": "GitHub", "via": ["src/shared/platforms/github.js"] } ],
  "evidence": ["<the files you read that support the plan, e.g. Cargo.toml, AGENTS.md>"]
}
```

Ids are kebab-case and stable: a later refresh keeps the ids (and the names the owner edited) and
only changes rules. Order zones from the foundations up (infrastructure first, civic last) when the
import graph shows it; the renderer lays them out in that order.

## When to run again

Only when the validator reports more than 5% of the files outside every rule, or a new top-level
area appears. A refresh starts from the current plan: keep ids and names, change rules, add
districts. Never renumber or rename what the owner already saw.

## Unattended

You run without a human: record an assumption in `summary` instead of asking. Write only the plan
file; never edit the project's code, docs or agent instructions.
