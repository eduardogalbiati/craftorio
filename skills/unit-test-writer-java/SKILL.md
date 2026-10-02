---
name: unit-test-writer-java
description: Writes, updates and runs unit tests for Java/Kotlin (JUnit 5, AssertJ, Mockito/MockK, Spring test slices) with Maven or Gradle. Use to add tests for a change or run the suite of a JVM project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Java / Kotlin

## Build and commands (never switch frameworks)

| Build | Whole suite | One test |
|---|---|---|
| Maven (`pom.xml`; prefer `./mvnw`) | `./mvnw -B test` | `./mvnw -B test -Dtest='ClassTest#method'` |
| Gradle (`build.gradle[.kts]`; prefer `./gradlew`) | `./gradlew test` | `./gradlew test --tests 'pkg.ClassTest.method'` |

Run only the tests you write (the "One test" column); the whole suite is the orchestrator's when
the workflow has a suite step (see testing-principles: time budget).
On Windows use `mvnw.cmd`/`gradlew.bat` if the extensionless scripts do not run.
Dependencies: a fresh checkout (each run has its own worktree) has no build output; the first
`test` run resolves dependencies into the shared Maven/Gradle cache, so give it time and do not
treat a slow first run as a failure.
Libraries: read the test dependencies (JUnit 4 vs 5, AssertJ/Hamcrest, Mockito/MockK, Kotest) and use what is there.

## Idioms

- Same package as the code under `src/test/java` (or `src/test/kotlin`), class `NameTest`.
- JUnit 5: `@Test`, a descriptive `@DisplayName`, `@ParameterizedTest` + `@CsvSource`/`@MethodSource` for variations, `assertThrows` for errors.
- Fluent assertions with AssertJ (`assertThat(x).isEqualTo(...)`) when available.
- Kotlin: backtick test names, MockK for final Kotlin classes.
- Plain unit tests first: instantiate the class with its boundary dependencies mocked (`@ExtendWith(MockitoExtension.class)`, `@Mock`, `@InjectMocks`).
- Spring only when the behaviour depends on the framework, with the smallest slice: `@WebMvcTest`, `@DataJpaTest`, `@JsonTest`. Avoid `@SpringBootTest` for unit tests.
- Time: inject a `Clock` (`Clock.fixed(...)`). No `Thread.sleep`; async with Awaitility.
- Real infrastructure (Testcontainers) is integration testing: only if the project already has that suite.

## Coverage (only when asked)

JaCoCo: `./mvnw -B verify` (plugin configured) or `./gradlew test jacocoTestReport`.
