---
name: unit-test-writer-csharp
description: Writes, updates and runs unit tests for C#/.NET (xUnit, NUnit or MSTest; Moq/NSubstitute; WebApplicationFactory) with dotnet test. Use to add tests for a change or run the suite of a .NET project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: C# / .NET

**Test workers (#367)**: a run gets `MULTIAGENT_TEST_WORKERS` (and `MULTIAGENT_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`MULTIAGENT_TEST_WORKERS=<n>`) and pass the number to the runner you call: `dotnet test -- RunConfiguration.MaxCpuCount=<n>`.
Unset: leave the runner's default.

## Framework and commands (never switch frameworks)

Read the `PackageReference`s of the test project (`*.Tests.csproj`):
`xunit` → xUnit · `NUnit` → NUnit · `MSTest.TestFramework` → MSTest. Mocks: `Moq` or `NSubstitute`.
Assertions: `FluentAssertions`/`Shouldly` if present.

| What | Command |
|---|---|
| Whole suite | `dotnet test` (at the solution root) |
| One test | `dotnet test --filter "FullyQualifiedName~Namespace.ClassTests.Method"` |
| By category/trait | `dotnet test --filter "Category=Unit"` |
| Coverage (only when asked) | `dotnet test --collect:"XPlat Code Coverage"` |

Run only the tests you write (`--filter`); the whole suite is the orchestrator's when the workflow
has a suite step (see testing-principles: time budget). Which tests and how to read them: the code
→ tests map when the project has one, and failures-only output (`dotnet test --logger
"console;verbosity=minimal"`, read the `Failed` lines), never the whole log (testing-principles:
the code → tests map, agent mode).
Dependencies: a fresh checkout (each run has its own worktree) has no `obj/` folders; `dotnet test`
restores implicitly, but run `dotnet restore` (with `--locked-mode` when `packages.lock.json`
exists) first if a restore error appears.

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (e.g. `timeout: 300000` for
  one focused file in this orchestrator, the suite's budget for the whole suite), never the default
  120 s: a command cut there returns no result and the turn is lost (long-commands). Never start a
  test command in the background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (the runner's duration line). A file that takes more than a
  minute is a slow file: from then on run it with a narrower filter (`dotnet test --filter "FullyQualifiedName~<Name>"`, one project),
  at most once per round; a command that may take longer than the tool's maximum goes to the
  orchestrator's suite step or runs with a narrower filter.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; never
  one assertion per edit-and-run cycle. Each turn re-reads your whole context.

## Idioms

- Test project mirroring the production one; class `XxxTests`, method `Method_Scenario_ExpectedResult`.
- xUnit: `[Fact]`, `[Theory]` + `[InlineData]`/`[MemberData]`. NUnit: `[Test]`, `[TestCase]`.
- Errors: `Assert.Throws<T>` / `await Assert.ThrowsAsync<T>`.
- Async tests return `Task` and `await` (never `async void`, never `.Result`).
- Boundary dependencies behind interfaces, mocked with the project's framework.
- Time: `TimeProvider` (`FakeTimeProvider` from `Microsoft.Extensions.TimeProvider.Testing`) or an injected clock.
- APIs: `WebApplicationFactory<Program>` to exercise endpoints in memory.
- EF Core: SQLite in-memory instead of the `InMemory` provider when relational behaviour matters.
- No shared static state between tests; no dependence on test order.
