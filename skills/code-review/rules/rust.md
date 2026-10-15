# Rust

Apply together with the core checklist in SKILL.md.

## Errors (never crash)
- `unwrap()`, `expect(...)`, `panic!`, `unreachable!`, `todo!` in non-test code: `major` on a path
  that external input, I/O or a process reaches (a sidecar that panics loses the user's work).
  Errors are `Result<T, E>` passed up with `?`.
- Error passed up without context (`map_err(|_| ...)` that drops the cause, `Box<dyn Error>` in a
  library's public API): prefer a `thiserror` enum in a library, `anyhow::Context` in a binary,
  as the project already does.
- `let _ = fallible();` or `.ok()` that silently drops an error that matters.
- Indexing (`v[i]`, `&s[a..b]`) that can be out of bounds or split a UTF-8 character: `get`, `chars`.
- Integer `as` casts that truncate or wrap; arithmetic on sizes without `checked_`/`saturating_`.

## Ownership and lifetimes kept simple
- Explicit lifetime parameters or `'static` bounds where owned data (`String`, `Vec`, `Arc`) would
  do; a struct holding references that forces lifetimes through the whole API.
- `.clone()` to silence the borrow checker on a hot path or a large value; `Rc<RefCell<_>>` /
  `Arc<Mutex<_>>` where a plain owner and a `&mut` would do.
- Taking `String`/`Vec<T>` by value or `&String`/`&Vec<T>` where `&str`/`&[T]` is enough.

## unsafe
- `unsafe` is forbidden unless isolated in a small function or module, with a `// SAFETY:`
  comment that states the invariant, and no safe alternative: `blocker` when the invariant does
  not hold or is not stated. A crate without unsafe code keeps `#![forbid(unsafe_code)]`.
- `transmute`, raw pointers, `static mut`, `set_var` in threaded code: each one justified.

## Async
- Blocking calls in async code: `std::fs`, `std::thread::sleep`, `std::process::Command::output`,
  a blocking HTTP client or a heavy CPU loop inside an `async fn` stall the runtime; use the
  runtime's async APIs or `spawn_blocking`.
- A `std::sync::Mutex` guard (or a `RefCell` borrow) held across `.await`; a lock taken in two
  orders.
- Spawned tasks never awaited or aborted (a leak); `select!` branches that drop work that is not
  cancellation-safe.

## Resources: processes and files
- Child processes: every `Child` is waited on (`wait`/`kill` on every path, also on error), its
  pipes read or closed, so it never outlives the caller; `kill_on_drop(true)` with tokio.
- Files, sockets and temp folders closed or removed on every path: a guard type with `Drop`
  rather than cleanup at the end of a function that `?` can leave early.
- `BufWriter` dropped without `flush()`, whose errors are then lost.

## Security
- `Command::new("sh").arg("-c").arg(input)` / `cmd /C` with external input: pass arguments one by one.
- Paths joined from external input without checking they stay under the root (`..`, absolute paths).
- SQL built with `format!`: use the driver's bind parameters.
- `rand::thread_rng` for tokens is fine; a hand-rolled RNG or hash for secrets is not.

## Idioms and tests
- `clippy` lints silenced with `#[allow(...)]` without a reason comment.
- Public items of a library crate without doc comments; a `pub` that should be `pub(crate)`.
- New behaviour without a test: unit tests in `#[cfg(test)] mod tests`, the public API in `tests/`.
- Tests that sleep, depend on order, or change the process environment without a lock.
