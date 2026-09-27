# C# / .NET

Apply together with the core checklist in SKILL.md.

## Async
- `async void` outside event handlers; `.Result`/`.Wait()` in async code (deadlock, thread-pool starvation).
- `Task` never awaited (fire-and-forget without error handling).
- `CancellationToken` received but not passed on to I/O calls.
- Library code without `ConfigureAwait(false)` when the project follows that convention.

## Resources
- `IDisposable` without `using`/`await using`. `HttpClient` created per request → `IHttpClientFactory`.
- `DbContext` with the wrong lifetime (singleton) or shared across threads.

## Nullability and types
- With nullable reference types enabled: `!` (null-forgiving) hiding a real null; suppressed warnings.
- `decimal` for money, never `double`/`float`.
- `DateTime.Now` instead of `DateTimeOffset`/`UtcNow` for persisted data.
- `string` compared without an explicit `StringComparison` in culture/security logic.

## EF Core / data
- N+1 (navigation accessed in a loop without `Include`); `ToList()` before the filter (filters in memory).
- `FromSqlRaw` with interpolation → `FromSqlInterpolated`/parameters.
- Migration that loses data or cannot be reverted.

## ASP.NET
- Endpoint without `[Authorize]` when its neighbors have it; missing resource-ownership check (IDOR).
- Model binding without validation; over-posting (entity as an input parameter).
- Exception returning a stack trace to the client in production.

## Exceptions and logs
- Generic `catch (Exception)` without rethrowing; `throw ex;` (loses the stack) → `throw;`.
- Logging with string interpolation instead of a structured template (`_log.LogInformation("Order {Id}", id)`).

## Tests
- Tests depending on `DateTime.Now`/the real clock; use `TimeProvider`.
