---
name: e2e-test-writer-go
description: Writes and runs end-to-end BDD scenarios (Given/When/Then) for Go projects with the framework the project already uses (Godog, Ginkgo); default Godog (+ chromedp or playwright-go for a web UI). Use to add acceptance scenarios for a change and report each one's result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, commands to run only the run's scenarios"
used_by: "test writer"
---

# E2E scenarios: Go

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Only this run's scenarios |
|---|---|---|---|
| `github.com/cucumber/godog` in `go.mod` | Godog | `features/` | `go test ./... -run TestFeatures -godog.tags=@issue-<n>` (or the suite's `Options.Tags`) |
| `github.com/onsi/ginkgo` in `go.mod` | Ginkgo (Describe/When/It as Given/When/Then) | `e2e/` | `ginkgo --label-filter=issue-<n> ./e2e` |

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
