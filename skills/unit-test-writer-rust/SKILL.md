---
name: unit-test-writer-rust
description: Writes, updates and runs unit and integration tests for Rust with cargo test (cargo nextest when the project uses it), unit tests in a `#[cfg(test)]` module next to the code and integration tests under `tests/`. Use to add tests for a change or run the suite of a Rust crate or workspace.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Rust

**Test workers (#367)**: a run gets `CRAFTORIO_TEST_WORKERS` (and `CRAFTORIO_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`CRAFTORIO_TEST_WORKERS=<n>`) and pass the number to the runner you call: `cargo test -- --test-threads=<n>`.
Unset: leave the runner's default.

## Commands

| What | Command |
|---|---|
| Whole suite (workspace) | `cargo test --workspace` (or `cargo nextest run --workspace`) |
| One crate | `cargo test -p <crate>` |
| One test (substring of its path) | `cargo test -p <crate> <module>::tests::<name> -- --exact` |
| One integration test file | `cargo test -p <crate> --test <file stem>` |
| Show a passing test's output | `cargo test -p <crate> <name> -- --nocapture` |
| Doc tests only | `cargo test -p <crate> --doc` |

- **nextest when present**: the project uses it when it has `.config/nextest.toml` or its CI runs
  `cargo nextest`; then run `cargo nextest run -p <crate> -E 'test(<name>)'` (one test) and
  `cargo nextest run --workspace`. nextest does not run doc tests: add `cargo test --doc` when the
  change touches documented examples. Never install nextest yourself.
- Run only the tests you write (a crate, a filter); the whole suite is the orchestrator's when the
  workflow has a suite step (see testing-principles: time budget). Read failures only: the
  `---- <name> stdout ----` blocks and the `failures:` list at the end, never the whole log.
- **Build cache**: one target folder per worktree, shared by the run's steps: the worktree's
  `target/` (gitignored), or the `CARGO_TARGET_DIR` already set in your environment when it points
  to a folder of this worktree. It is removed with the worktree; never set `CARGO_TARGET_DIR` to a
  folder shared by several worktrees (concurrent builds block each other on its lock).
- Dependencies: `cargo fetch` when the build reports a missing crate offline; `Cargo.lock` changes
  are committed for a binary or a workspace, as the repository already does.

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (the first build of a crate
  can take minutes: `timeout: 600000` when unknown), never the default 120 s: a command cut there
  returns no result and the turn is lost (long-commands). Never start a test command in the
  background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (`finished in Ns` lines plus the compile time). A crate that takes
  more than a minute is slow: from then on run one test file (`--test <stem>`) or one filter, at
  most once per round.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; each
  build re-links the test binary.

## Idioms

- **Unit tests** next to the code: `#[cfg(test)] mod tests { use super::*; ... }` at the end of the
  file; they may test private functions.
- **Integration tests under `tests/`**: one file per behaviour (`tests/api.rs`), each a separate
  crate that sees only the public API; shared helpers in `tests/common/mod.rs` (not
  `tests/common.rs`, which would run as a test file).
- A test returns `Result<(), Box<dyn std::error::Error>>` and uses `?` instead of `unwrap()` on
  setup steps, so a failure names the error. `unwrap`/`expect` are fine in tests; the never-crash
  rule (build-audit-rust) is for non-test code.
- Assertions: `assert_eq!(got, want)` with `#[derive(Debug, PartialEq)]` on the types;
  `assert!(matches!(err, MyError::NotFound { .. }))` for error variants, never a match on the
  message text. `pretty_assertions` or `insta` snapshots only if the project already uses them.
- `#[should_panic]` only for a function documented to panic; errors are `Result`s, tested as such.
- Files: `tempfile::TempDir` (if already a dev-dependency) or a folder under
  `std::env::temp_dir()` removed at the end; never write into the source tree.
- Async: `#[tokio::test]` (or the project's runtime); never `std::thread::sleep` to synchronise,
  inject a clock or use the runtime's paused time (`tokio::time::pause`) when the project has it.
- Processes and sockets opened in a test are closed on every path (a guard type with `Drop`).
- Parallelism: tests run in parallel threads; a test that changes the environment or the current
  folder takes a shared lock, or is rewritten to pass the value in.
- Fakes: a trait owned by the consumer, a hand-written fake in the test; `mockall` only if used.
