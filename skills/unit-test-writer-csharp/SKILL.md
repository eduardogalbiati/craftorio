---
name: unit-test-writer-csharp
description: Writes, updates and runs unit tests for C#/.NET (xUnit, NUnit or MSTest; Moq/NSubstitute; WebApplicationFactory) with dotnet test. Use to add tests for a change or run the suite of a .NET project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: C# / .NET

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

Dependencies: a fresh checkout (each run has its own worktree) has no `obj/` folders; `dotnet test`
restores implicitly, but run `dotnet restore` (with `--locked-mode` when `packages.lock.json`
exists) first if a restore error appears.

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
