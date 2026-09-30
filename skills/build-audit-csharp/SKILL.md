---
name: build-audit-csharp
description: Builds a .NET solution and audits NuGet packages for vulnerabilities, separating production projects from test projects (dotnet build, dotnet list package --vulnerable). Use to check whether a C#/.NET project builds and has vulnerable dependencies.
uses: [dependency-audit-policy, long-commands]
summary: "Build and audit commands, production vs development scope per ecosystem"
used_by: "builder"
---

# Build and audit: C# / .NET

## Build

No test suite here (`dotnet test`): the test writer already ran it, and CI runs it on every platform.

1. `dotnet restore` (with `--locked-mode` when `packages.lock.json` exists).
2. `dotnet build -c Release --no-restore`. Compilation errors are `build_status: failed`;
   warnings only block when the project sets `TreatWarningsAsErrors`.
3. Report errors as `file(line,col): error CSxxxx: message`.

## Audit

`dotnet list package --vulnerable --include-transitive --format json` (.NET 8+; older SDKs have no
`--format json`, read the text output).

- Severity comes in the output (`Critical`, `High`, `Moderate`, `Low`).
- **Production** = non-test projects. **Development** = test projects (`<IsTestProject>true</IsTestProject>`,
  a `Microsoft.NET.Test.Sdk` reference, or a `*.Tests` name) and packages with `PrivateAssets=all`.
- The restore's NuGet Audit warnings (`NU1901`–`NU1904`) are the same data: do not count them twice.
- Fix: upgrade the direct package, or add an explicit reference / Central Package Management entry
  (`Directory.Packages.props`) with the fixed version for a transitive one.
