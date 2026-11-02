## Project run defaults: a run starts from the project's configuration

A run's inputs are resolved in one order everywhere (the run dialog, the Roadmap's queue and
`scripts/run.js`, `resolveRunInputs` in `packages/engine/domains/project/project-run-defaults.js`):
**what you type in the dialog > the roadmap item's inputs > the project's run defaults > the
workflow's defaults**. The dialog marks the fields filled from the project with a "from the
project" hint. On the CLI, `--project <id>` (or the project whose folder is `--repo`) picks the
project.

The project's run defaults come from the wizard's picks (#729: the `local-*` / `remote-*`
variants), the Ways of working profile (Edit profile saves them on the project, with the
project's kind) and the facts read from the files; a value saved on the project
(`project.runDefaults`) wins over a derived one. No Node toolchain is assumed: a Rust project gets
`cargo test`, and no `npm …` command is offered without a `package.json`.

**The project's kind** (backend / frontend / full-stack) is detected from the files (web
frameworks, UI folders, a server, an E2E suite) and confirmed on the wizard's review or in Ways of
working. A backend project has no UI defaults: `ui_folders` empty, `screenshots: off`,
`e2e_tests: off`, no `steps_folders`; the existing conditions then skip the developer's
screenshots, the test id check and the UI Reviewer, and the run screen shows those steps dimmed
with "Doesn't apply: no UI in this project".

Where each input of feature, fix and release gets its project value:

| Input | Project value |
| --- | --- |
| `mode` | the wizard's variant (`local-*`, `remote-*`, `fork-*`), else the profile's mode (`fork` when you can't push to the repository, #738) |
| `parent_branch` | set by the Roadmap for an item that `dependsOn` an earlier one (#738): its branch on the fork |
| `base_branch` | the repository's default branch |
| `test_command` (release: `unit_command`) | the profile's test command, else discovery (`package.json`, `go.mod`, `Cargo.toml` → `cargo test`, …) |
| `check_command` | the profile's check command, else the project's check discovery |
| `e2e_tests` (release: `e2e_suite`) | `off` for a backend, a unit-only profile or no E2E suite found |
| `e2e_command` | the profile's E2E command or the suite found (Playwright / Cypress config); empty otherwise |
| `ui_folders` | the UI folders found; empty for a backend |
| `screenshots` | `off` for a backend, else the workflow's default |
| `steps_folders` | the step folders found; empty for a backend |
| CI wait, budgets, review rigour, validation | none: the workflow's defaults |

Platform (#745): the Backlog, Roadmap and Epics use the project's platform (github.com → GitHub,
gitlab.com or a GitLab host → GitLab, else the platform stored on the project at onboarding); the
platform select appears only for a host the URL cannot name, and the choice is saved on the
project.
