---
name: unit-test-writer-go
description: Writes, updates and runs unit tests for Go with the standard testing package (table-driven tests, httptest; testify only if the project already uses it). Use to add tests for a change or run the suite of a Go project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Go

## Commands

| What | Command |
|---|---|
| Whole suite | `go test ./...` |
| With the race detector (concurrent code) | `go test -race ./...` |
| One test | `go test ./pkg -run '^TestName$' -count=1 -v` |
| One sub-case | `go test ./pkg -run 'TestName/case' -v` |
| Coverage (only when asked) | `go test -cover ./...` |

Also run `go vet ./...`: vet findings count as failures.
Dependencies: a fresh checkout (each run has its own worktree) may lack modules; `go mod download`
first if `go test` reports missing modules (the module cache is shared, so this is usually instant).

## Idioms

- `x_test.go` in the same package (white-box) or `pkg_test` (black-box): follow what the repository does.
- **Table-driven** tests with `t.Run(tc.name, ...)`; readable case names.
- `t.Helper()` in helpers, `t.Cleanup` for teardown, `t.TempDir()` for files.
- Assertions with the plain `testing` package (`t.Errorf("X() = %v, want %v", got, want)`). Use `testify` **only** if it is already in `go.mod`; compare structs with `go-cmp` if already used, else `reflect.DeepEqual`.
- Errors: check with `errors.Is/As`, never by string.
- Fakes: small interfaces defined by the consumer, hand-written fakes in the test.
- HTTP: `httptest.NewServer` / `httptest.NewRecorder`.
- Time: inject a clock or `func() time.Time`; never `time.Sleep` to synchronise.
- `t.Parallel()` only without shared state; on Go < 1.22 copy the loop variable (`tc := tc`).
- Never call `t.Fatal` from another goroutine.
- Golden files in `testdata/` for large outputs, with an `-update` flag if the project already has one.
