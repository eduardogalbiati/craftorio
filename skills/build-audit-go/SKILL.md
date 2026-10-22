---
name: build-audit-go
description: Builds a Go project and audits vulnerabilities with govulncheck, treating code-reachable vulnerabilities as production and module-only ones as development. Use to check whether a Go project builds and has vulnerable dependencies.
uses: [dependency-audit-policy, long-commands]
summary: "Build and audit commands, production vs development scope per ecosystem"
used_by: "builder"
---

# Build and audit: Go

**Test workers (#367)**: a run gets `MULTIAGENT_TEST_WORKERS` (and `MULTIAGENT_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`MULTIAGENT_TEST_WORKERS=<n>`) and pass the number to the runner you call: `go build -p <n>`, `go test -p <n>`.
Unset: leave the runner's default.

## Build

No test suite here (`go test ./...`): the test writer already ran it, and CI runs it on every platform.

1. `go mod download` and `go mod verify`.
2. `go build ./...` and `go vet ./...`. Any error is `build_status: failed`.
3. `go mod tidy -diff` (Go ≥ 1.23): a difference is a finding to report, not a blocker on its own.

## Audit

`govulncheck -format json ./...` (install with `go install golang.org/x/vuln/cmd/govulncheck@latest`).

Go has no development dependencies, so use govulncheck's reachability as the scope:
- **production** = vulnerabilities whose vulnerable code is **called** by the project (they come with a call trace);
- **development** = vulnerabilities only present in imported modules/packages, not called.

- A called vulnerability in the standard library (`stdlib`) is production: the fix is a newer Go version (`go`/`toolchain` in `go.mod` and in CI).
- govulncheck gives no severity: classify with the policy's CVSS table using the advisory aliases.
- Fix: ID (`GO-YYYY-NNNN`), module, current version, fixed version (`go get module@vX.Y.Z` + `go mod tidy`), and the vulnerable function called, with file:line from the trace.
