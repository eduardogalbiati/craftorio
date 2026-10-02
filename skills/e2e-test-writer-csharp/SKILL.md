---
name: e2e-test-writer-csharp
description: Writes and runs end-to-end BDD scenarios (Given/When/Then) for C#/.NET projects with the framework the project already uses (Reqnroll, SpecFlow, LightBDD); default Reqnroll with xUnit (+ Microsoft.Playwright for a web UI). Use to add acceptance scenarios for a change and report each one's result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, commands to run only the run's scenarios"
used_by: "test writer"
---

# E2E scenarios: C# / .NET

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Only this run's scenarios |
|---|---|---|---|
| `Reqnroll` package reference | Reqnroll | `Features/` of the test project | `dotnet test <project> --filter "Category=issue-<n>"` |
| `SpecFlow` package reference | SpecFlow (keep it, do not migrate) | `Features/` | `dotnet test <project> --filter "Category=issue-<n>"` |
| `LightBDD` package reference | LightBDD | the test project's feature classes | `dotnet test <project> --filter "<FeatureClass>"` |

- **No E2E framework yet**: default to **Reqnroll** with the test framework the solution already
  uses (xUnit when none), in a separate `<Solution>.E2E` test project with `Features/` and
  `StepDefinitions/`; a web UI with `Microsoft.Playwright`. Record the assumption in `e2e_note` and
  commit the project and its reference in the solution.
- Browsers: `pwsh bin/<config>/<tfm>/playwright.ps1 install chromium` only when the project uses
  Playwright; when it fails, the UI scenarios are `skipped` (environment).
- `dotnet test` with `--nologo` and a logger the output can be read from (`--logger "console;verbosity=normal"`).

## Idioms

- Tag each scenario with its issue (`@issue-143`, a Category for `--filter`).
- Step state through context injection (a class in the step constructor), never static fields.
- The app or server starts in a `[BeforeTestRun]` hook (or `WebApplicationFactory`) and stops in
  `[AfterTestRun]`, on failure too.
- Screenshots: `await page.ScreenshotAsync(new() { Path = ... })` into `evidence_dir` with the
  e2e-scenarios naming.
