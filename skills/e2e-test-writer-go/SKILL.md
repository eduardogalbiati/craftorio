---
name: e2e-test-writer-go
description: Writes end-to-end BDD scenarios (Given/When/Then) for Go projects with the framework the project already uses (Godog, Ginkgo); default Godog (+ chromedp or playwright-go for a web UI). Development runs write them and check that they parse (pending, run at release); the E2E release workflow runs the whole suite and reports each result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands"
used_by: "test writer, E2E runner"
---

# E2E scenarios: Go

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Release run (one file, or by tag) |
|---|---|---|---|
| `github.com/cucumber/godog` in `go.mod` | Godog | `features/` | `go test ./... -run TestFeatures -godog.tags=@issue-<n>` (or the suite's `Options.Tags`) |
| `github.com/onsi/ginkgo` in `go.mod` | Ginkgo (Describe/When/It as Given/When/Then) | `e2e/` | `ginkgo --label-filter=issue-<n> ./e2e` |

- **Development run**: write the scenarios and check that they parse, never run them (no app,
  no browser): `go vet ./...` with the project's E2E build tag (e.g. `-tags e2e`): the steps compile; check that every step phrase of the new scenarios has a definition. Each is reported `pending`; the E2E release workflow runs the suite.
- **No E2E framework yet**: default to **Godog** run from `go test` (a `TestFeatures` with
  `godog.TestSuite`), feature files in `features/`, steps in an `e2e` test package. Record the
  assumption in `e2e_note`; `go get` the module and commit `go.mod`/`go.sum`.
- A web UI: `chromedp` if the project has it, else `playwright-go`; when no browser can run, the UI
  scenarios are `skipped` (environment).
- Build tags: keep E2E tests behind the project's tag (e.g. `//go:build e2e`) when it has one, and
  run them with `-tags e2e`.

## Idioms

- Tag each scenario with its issue (`@issue-143`).
- Step state in a per-scenario struct registered in `ScenarioInitializer`, never package globals.
- Servers start in `BeforeSuite`/`httptest.NewServer` and stop in `AfterSuite`, on failure too.
- Screenshots: `chromedp.FullScreenshot` / `page.Screenshot` into `evidence_dir` with the
  e2e-scenarios naming.
