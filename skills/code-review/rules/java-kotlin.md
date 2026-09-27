# Java / Kotlin (JVM, Spring)

Apply together with the core checklist in SKILL.md.

## Correctness
- `==` to compare `String`/wrappers in Java → `equals`. The `Integer` cache hides this in small tests.
- `equals` overridden without `hashCode` (and vice versa); JPA entity `equals` based on a generated id.
- `Optional.get()` without a check; `Optional` as a field/parameter.
- Kotlin: `!!` hiding null; platform types from Java treated as non-null.
- `BigDecimal` built with `new BigDecimal(double)`, or compared with `equals` (uses scale) → `compareTo`. Money never in `double`.
- `SimpleDateFormat` shared across threads; use `java.time`.

## Resources and exceptions
- Stream/connection without try-with-resources (Java) or `use {}` (Kotlin).
- Generic `catch (Exception e)`, `e.printStackTrace()`, or rethrowing and losing the cause.
- Checked exception wrapped without context.

## Concurrency
- Non-thread-safe collections (`HashMap`, `ArrayList`) shared in singletons/beans.
- `synchronized` on a public object; double-checked locking without `volatile`.
- Kotlin coroutines: `GlobalScope`, `runBlocking` in production code, wrong dispatcher for I/O.
- `@Async`/`CompletableFuture` without a dedicated executor or error handling.

## Spring / JPA
- `@Transactional` on a private method or called from inside the same class (the proxy does not apply).
- Lazy loading outside the transaction; N+1 on relationships (`@OneToMany` without fetch join/EntityGraph).
- JPA entity exposed directly in the API (leaks fields, couples to the schema) → DTO.
- Missing validation (`@Valid`) on input payloads.

## Security
- Concatenated SQL/JPQL; `@Query` with a built string.
- Deserialization of arbitrary types (Jackson default typing, `ObjectInputStream`).
- Endpoints without `@PreAuthorize`/a security rule when their neighbors have one.
- Logs with PII, tokens or the full request body.

## Tests
- `@SpringBootTest` where a unit/slice test (`@WebMvcTest`, `@DataJpaTest`) would do.
- `Thread.sleep` to synchronize; use Awaitility.
