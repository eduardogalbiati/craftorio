---
name: build-audit-rust
description: Builds a Rust crate or workspace with cargo, runs clippy with warnings as errors and cargo fmt --check, enforces the never-crash rules (no unwrap, expect or panic! outside tests) and audits dependencies with cargo audit. Use to check whether a Rust project builds cleanly and has vulnerable dependencies.
uses: [dependency-audit-policy, long-commands]
summary: "Build and audit commands, production vs development scope per ecosystem"
used_by: "builder"
---

# Build and audit: Rust

## Build cache: one target folder per worktree

Each run has its own worktree. Its steps (developer, test writer, builder) share one target
folder, so a dependency is compiled once per run: the worktree's own `target/` (gitignored), or
the `CARGO_TARGET_DIR` already set in your environment when it points to a folder of this
worktree. The target folder is removed with the worktree: never set `CARGO_TARGET_DIR` to a
folder shared by several worktrees (concurrent builds block on its lock and it is never cleaned).

## Build

No test suite here (`cargo test`): the test writer already ran it, and CI runs it.

1. `cargo fetch --locked` (a `Cargo.lock` out of date is `build_status: failed`: the change forgot
   to commit it).
2. `cargo build --workspace --all-targets --locked`. Any error is `build_status: failed`.
3. `cargo clippy --workspace --all-targets --locked -- -D warnings`: every warning is an error;
   a finding is `build_status: failed`, with file:line and the lint name.
4. `cargo fmt --check` (`cargo fmt --all --check` in a workspace): a difference is
   `build_status: failed`; name the files, never reformat them yourself.

Pass the Bash tool's `timeout` on each command (`timeout: 600000` for a first build), in the
foreground (long-commands).

## Never crash: non-test code

A sidecar or a service that panics loses the user's work. In non-test code:
- no `unwrap()`, no `expect(...)`, no `panic!`, `unreachable!`, `todo!` or `unimplemented!`;
  no indexing that can go out of bounds when `get` exists;
- errors are `Result<T, E>` passed up with `?` and context (`thiserror` types in a library,
  `anyhow::Context` in a binary, as the project already does); `main` returns a `Result`.

How the project enforces it (the storytold/photocraft setup): a `clippy.toml` at the workspace root
with `allow-unwrap-in-tests = true` and `allow-expect-in-tests = true`, and at the top of each
crate's `lib.rs`/`main.rs`:
`#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic, clippy::unreachable, clippy::todo, clippy::unimplemented)]`.
When the project has this, clippy (step 3) reports every violation. When it does not, search the
changed non-test files for `unwrap(`, `expect(` and `panic!` and report each one as a finding
(file:line), `build_status: failed` for code the change added; propose the `clippy.toml` and
`#![deny(...)]` lines in the report, never add them yourself.

## Audit

`cargo audit --json` (install with `cargo install cargo-audit --locked` when missing; record it if
it cannot be installed) reads `Cargo.lock` against the RustSec advisory database.

Scope per the dependency-audit-policy:
- **production** = crates in the `[dependencies]` tree of a shipped crate (`cargo tree -e normal
  -i <crate>` shows who pulls it in);
- **development** = crates reached only through `[dev-dependencies]` or `[build-dependencies]`.

- `unmaintained` and `yanked` warnings are findings to report, not blockers on their own.
- Fix: advisory ID (`RUSTSEC-YYYY-NNNN`), crate, current version, patched version
  (`cargo update -p <crate> --precise <version>`), and the crate of the project that pulls it in.
