---
name: unit-test-writer-go
description: Writes, updates and runs unit tests for Go with the standard testing package (table-driven tests, httptest; testify only if the project already uses it). Use to add tests for a change or run the suite of a Go project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Go

**Test workers (#367)**: a run gets `CRAFTORIO_TEST_WORKERS` (and `CRAFTORIO_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`CRAFTORIO_TEST_WORKERS=<n>`) and pass the number to the runner you call: `go test -p <n>`.
Unset: leave the runner's default.

## Commands

| What | Command |
|---|---|
| Whole suite | `go test ./...` |
| With the race detector (concurrent code) | `go test -race ./...` |
| One test | `go test ./pkg -run '^TestName$' -count=1 -v` |
| One sub-case | `go test ./pkg -run 'TestName/case' -v` |
| Coverage (only when asked) | `go test -cover ./...` |

Run only the tests you write (`-run`); the whole suite is the orchestrator's when the workflow has
a suite step (see testing-principles: time budget). Which tests and how to read them: the code →
tests map when the project has one, and failures-only output (`go test` without `-v`, read the
`--- FAIL` lines), never the whole log (testing-principles: the code → tests map, agent mode).
Also run `go vet ./...`: vet findings count as failures.
Dependencies: a fresh checkout (each run has its own worktree) may lack modules; `go mod download`
first if `go test` reports missing modules (the module cache is shared, so this is usually instant).

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (e.g. `timeout: 300000` for
  one focused file in this orchestrator, the suite's budget for the whole suite), never the default
  120 s: a command cut there returns no result and the turn is lost (long-commands). Never start a
  test command in the background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (the runner's duration line). A file that takes more than a
  minute is a slow file: from then on run it with a narrower filter (`go test ./<pkg> -run "^TestName$"`, one package),
  at most once per round; a command that may take longer than the tool's maximum goes to the
  orchestrator's suite step or runs with a narrower filter.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; never
  one assertion per edit-and-run cycle. Each turn re-reads your whole context.

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
