---
name: e2e-test-writer-rust
description: Writes end-to-end BDD scenarios (Given/When/Then) for Rust projects with the framework the project already uses (cucumber-rs); default cucumber-rs run by cargo test (+ fantoccini or thirtyfour for a web UI). Development runs write them and check that they compile (pending, run at release); the E2E release workflow runs the whole suite and reports each result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands"
used_by: "test writer, E2E runner"
---

# E2E scenarios: Rust

**Test workers (#367)**: a run gets `CRAFTORIO_TEST_WORKERS` (and `CRAFTORIO_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`CRAFTORIO_TEST_WORKERS=<n>`) and pass the number to the runner you call: `cargo test -- --test-threads=<n>`.
Unset: leave the runner's default.

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Release run (one file, or by tag) |
|---|---|---|---|
| `cucumber` in a crate's `[dev-dependencies]`, a `[[test]]` with `harness = false` | cucumber-rs | `tests/features/` | `cargo test -p <crate> --test <runner> -- --tags @issue-<n>` |
| Plain integration tests that drive the binary (`assert_cmd`, a spawned server) | cargo integration tests | `tests/` | `cargo test -p <crate> --test <file stem>` |

- **Development run**: write the scenarios and check that they compile, never run them (no app,
  no browser): `cargo test -p <crate> --test <runner> --no-run` builds the runner and its step
  definitions; check that every step phrase of the new scenarios has a matching `#[given]`,
  `#[when]` or `#[then]`. Each is reported `pending`; the E2E release workflow runs the suite.
- **No E2E framework yet**: default to **cucumber-rs**: a `[[test]] name = "e2e", harness = false`
  in the crate's `Cargo.toml`, `tests/e2e.rs` with the `World` and the steps, feature files in
  `tests/features/`. Record the assumption in `e2e_note`; add the dev-dependency with
  `cargo add --dev cucumber` and commit `Cargo.toml`/`Cargo.lock`.
- A web UI: `fantoccini` or `thirtyfour` if the project has one (a WebDriver must be running);
  when no browser can run, the UI scenarios are `skipped` (environment).
- Builds use the worktree's one target folder (`target/` or `CARGO_TARGET_DIR`, see
  build-audit-rust); pass the Bash
  tool's `timeout` on every cargo command (long-commands).

## Idioms

- Tag each scenario with its issue (`@issue-143`).
- Step state in the `World` struct (one per scenario), never statics or globals.
- The app under test starts in a `before` hook (a spawned binary or server on a free port) and is
  stopped in an `after` hook and on `Drop`, on failure too: no process outlives the scenario.
- Steps return `Result` or assert with `assert_eq!`; a failing step names what it expected.
- Screenshots: `client.screenshot()` into `evidence_dir` with the e2e-scenarios naming.
