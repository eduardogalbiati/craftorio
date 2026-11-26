## Project run defaults: a run starts from the project's configuration

A run's inputs are resolved in one order everywhere (the run dialog, the Roadmap's stages and
`scripts/run.js`, `resolveRunInputs` in `packages/engine/domains/project/project-run-defaults.js`):
**what you type in the dialog > the roadmap item's inputs > the project's run defaults > the
workflow's defaults**. The dialog marks the fields filled from the project with a "from the
project" hint. On the CLI, `--project <id>` (or the project whose folder is `--repo`) picks the
project.

A roadmap item keeps only the inputs chosen for it (#785): what the owner changed in the Product
Owner's recommendation or in the item's Edit form, or what the plan set on purpose (the Cost step's
tests and screenshots). A value equal to the one shown anyway is not saved, and neither is an empty
one, so the project's configuration reaches the run. The Edit form and the recommendation say where
each value comes from ("from the project", "from the workflow", "on this item"). An item saved
before this keeps its values; its Edit form lists the ones that differ from the project's, with
"Use the project's values".

The project's run defaults come from the wizard's picks (#729: the `local-*` / `remote-*` /
`fork-*` variants), the Ways of working profile (Edit profile saves them on the project, with the
project's kind) and the facts read from the files; a value saved on the project
(`project.runDefaults`) wins over a derived one. No Node toolchain is assumed: a Rust project gets
`cargo test`, and no `npm …` command is offered without a `package.json`.

**The project's kind** (backend / frontend / full-stack) is detected from the files (web
frameworks, UI folders, a server, an E2E suite) and confirmed on the wizard's review or in Ways of
working. A backend project has no UI defaults: `ui_folders` empty, `screenshots: off`,
`e2e_tests: off`, no `steps_folders`; the existing conditions then skip the developer's
screenshots, the test id check and the UI Reviewer, and the run screen shows those steps dimmed
with "Doesn't apply: no UI in this project". It is `screenshots: off` and `e2e_tests: off` that
dim them: an empty `ui_folders` alone (an empty project) dims nothing, and a changed page or
component (by its extension) still counts as a UI change. A run without UI folders says in its
result that the screenshots and the UI review were skipped for that reason.

Where each input of feature, fix and release gets its project value:

| Input | Project value |
| --- | --- |
| `mode` | the wizard's variant (`local-*`, `remote-*`, `fork-*`), else the profile's mode (`fork` when you can't push to the repository, #738) |
| `test_order` | the wizard's variant: `*-code` is `code_first`, `*-e2e` is `e2e_first` (#785) |
| `language` | every language detected from the project's files, comma-separated (#785) |
| `parent_branch` | set by the Roadmap for an item that `dependsOn` an earlier one (#738): its branch on the fork |
| `base_branch` | the repository's default branch |
| `base_behind` | no workflow input: what a roadmap does when its local base is behind origin (#805). `update` fast-forwards it first, `continue` goes on from it; empty asks at Start and goes on when nobody is there. Project settings |
| `test_command` (release: `unit_command`) | the profile's test command, else discovery (`package.json`, `go.mod`, `Cargo.toml` → `cargo test`, …) |
| `check_command` | the profile's check command, else the project's `check` script; `off` (Project settings) runs none |
| `check_commands` | no workflow input: what the rule check runs without a `check_command` (#50), the `check` script or the linter and type checker found; shown in Project settings and Start |
| `e2e_tests` (release: `e2e_suite`) | `off` for a backend, a unit-only profile or no E2E suite found |
| `e2e_command` | the profile's E2E command or the suite found (Playwright / Cypress config); empty otherwise |
| `ui_folders` | the UI folders found (folders with pages or components; `./` for pages at the root, which covers the pages and stylesheets anywhere); empty for a backend or an empty project, never this app's `src/renderer/` |
| `screenshots` | `off` for a backend, else the workflow's default |
| `steps_folders` | the step folders found; empty for a backend or when the project has none |
| CI wait, budgets, review rigour, validation | none: the workflow's defaults |

Platform (#745): the Backlog, Roadmap and Epics use the project's platform (github.com → GitHub,
gitlab.com or a GitLab host → GitLab, else the platform stored on the project at onboarding); the
platform select appears only for a host the URL cannot name, and the choice is saved on the
project.
