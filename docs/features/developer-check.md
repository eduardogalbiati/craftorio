---
order: 110
---

<!-- section:workflows -->
**Modes: automatic or validated** (input `mode`, in the Start drawer next to the task, the
Backlog's **Assign to a workflow** dialog and the Workflows screen; remembered per workflow and
shown in the run's Details). `auto` (default) goes from the developer straight to the review, as
above. `validated` stops right after the developer at the `developer_check` gate, before any review
or test token is spent: its message has the developer's summary, the issues (done / not done), the
files changed, the commits on the branch, the diff command, the `test_notes` and `evidence_plan`,
and the worktree path and branch. On a wide window the gate has two columns: on the left a short
list (the summary and one line per issue: done / not done, the full message expandable), the
tools and the choices; on the right the run's **Artifacts** so far, newest first (handoff notes,
`decisions.tsv`, documents, screenshots), the **changed files** (each opens its diff) and the
developer's test notes and evidence plan, each previewed in place. Try it (**Run App**, **Open
the worktree**, **Terminal there**), then:
- **Approve**: on to `code_review`;
- **Ask for changes** (needs a text): the developer gets it as your change request, fixes it on the
  same branch with a new commit, answers each point, and the run comes back to `developer_check`.
  No automatic limit: you decide when to stop;
- **Stop**: ends the run (`cancelled`); its branch keeps the work to resume it.

Only the first implementation and your own change requests stop there; the reviewer's, the tests',
the build's and the verifier's fix rounds go on without it, unless **Validate every round** is on (`validate_every_round: true`, a switch shown under Validated).
It is a human gate: no timeout, no supervisor, no retry ever answers it. The time a run waits for
you at its gates is recorded apart from agent time (`summary.timing.gate_wait_ms`, the Details
panel and the Time tooltip).

<!-- section:workflows order:111 -->
### Rule checks: what is found in a project (#50)

After each developer commit, Feature, Fix and Refactor run the project's rule checks (`rule_check`, no
agent). What runs, in order: the `check_command` given; the `check` script of `package.json`; else, in the
project's folder (its root), every tool below that its files configure **and** that is installed. Nothing is
downloaded and nothing is rewritten.

| Language | Configured by | Installed | What runs |
| --- | --- | --- | --- |
| JavaScript, TypeScript | a `lint` script | | `npm run lint` |
| | no `lint` script, an ESLint configuration (`eslint.config.*`, `.eslintrc*`, `eslintConfig`) | `node_modules/.bin/eslint` | `eslint .` |
| | a `typecheck` script | | `npm run typecheck` |
| | no `typecheck` script, `tsconfig.json` | `node_modules/.bin/tsc` | `tsc --noEmit` |
| Python | `ruff.toml`, `.ruff.toml`, `[tool.ruff]` | `ruff` on the PATH | `ruff check --no-fix` |
| | `mypy.ini`, `.mypy.ini`, `[tool.mypy]`, `[mypy]` in `setup.cfg` | `mypy` on the PATH | `mypy` |
| Go | `go.mod` or `go.work`, and `.golangci.*` | `golangci-lint` on the PATH | `golangci-lint run` (`GOPROXY=off`) |
| Rust | `clippy.toml`, `[lints.clippy]` | `cargo` and `cargo-clippy` on the PATH | `cargo clippy --frozen` (`--offline` without a `Cargo.lock`) |
| Java | `maven-checkstyle-plugin` in `pom.xml` | `mvn` on the PATH | `mvn -o checkstyle:check` |
| C# | the .NET analyzers (a root `*.csproj`, `Directory.Build.props` or `.editorconfig`), with a `*.csproj` or solution in the root | `dotnet` on the PATH | `dotnet build --no-restore` |

- **Rewrites files**: a script with `--fix`, `--write` and the like (its `pre` and `post` scripts and the scripts
  it runs included), or a golangci-lint configuration with `fix: true`, does not run; the run says so.
- **Only what the change added**: when a found command fails, the same command runs in the run's checkout of
  the base. A finding is the same when its file and its text are, whatever its line. Those the base has do not
  send the developer back, and the run says how many there are. A command that cannot be compared (no base
  checkout, not on the base, could not run there, no place in its output, a time limit) is said and reported
  without blocking. A `check_command` or a `check` script is not compared.
- **Cannot run here** (dependencies not installed, a command not found): `check_environment`, as before (#30).
- **Before a run**: the project's settings (Projects › a project) and the Start panel show the commands. In the
  settings, **Check commands** replaces the ones found, and **Run the project's checks** turns them off
  (`check_command: off`).

<!-- section:local-hero order:210 -->
- **Validation**: the input `validation: auto | validated` (the old `mode: auto | validated`, #630). In `auto` nothing waits for you (the run merges locally by itself); in `validated` the run stops at `developer_check` after the developer so you try the change (Run locally, Open the worktree) and approve it or ask for changes before the review and the tests. `human_review` offers Run locally too.
