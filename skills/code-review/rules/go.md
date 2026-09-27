# Go

Apply together with the core checklist in SKILL.md.

## Errors
- Ignored `err` (`_ =`, or an unchecked return). `major` for I/O, database and network.
- Error passed up without context: prefer `fmt.Errorf("doing X: %w", err)`; compare with `errors.Is/As`, not by string.
- `panic` in library/handler code for an expected error.

## Concurrency
- Goroutine with no way to end (no `ctx.Done()`, channel never closed): leak.
- Shared map/slice accessed without a mutex (think through `-race`).
- Loop variable captured in a goroutine (Go < 1.22).
- `sync.WaitGroup.Add` inside the goroutine; `Mutex` copied by value.
- Unbuffered channel that can block forever; `select` without a cancellation case.

## Context
- A function doing I/O does not take `ctx context.Context` as its first parameter.
- `context.Background()` in the middle of a request (loses cancellation/timeout).
- `http.Client` without `Timeout`; default `http.Get` in production.

## Resources
- Missing `defer resp.Body.Close()`, or placed before the error check; `defer` inside a long loop.
- Forgotten `rows.Close()`/`rows.Err()` with `database/sql`.

## Security
- SQL with `fmt.Sprintf`; use placeholders.
- `exec.Command("sh", "-c", input)`.
- `filepath.Join` with external input without validating the prefix.
- `math/rand` for tokens/secrets → `crypto/rand`.

## Idioms
- Interface defined by the producer instead of the consumer; interface too large.
- Pointer vs value receivers mixed on the same type.
- Write to a nil map; nil pointer in an optional struct field.
- Exported names without doc comments in a public package.

## Tests
- Table-driven tests when there are several cases; `t.Parallel()` with a captured loop variable.
- `t.Fatal` inside a goroutine (does not work).
