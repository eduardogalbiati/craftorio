---
name: unit-test-writer-java
description: Writes, updates and runs unit tests for Java/Kotlin (JUnit 5, AssertJ, Mockito/MockK, Spring test slices) with Maven or Gradle. Use to add tests for a change or run the suite of a JVM project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Java / Kotlin

**Test workers (#367)**: a run gets `CRAFTORIO_TEST_WORKERS` (and `CRAFTORIO_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`CRAFTORIO_TEST_WORKERS=<n>`) and pass the number to the runner you call: Maven `-DforkCount=<n>`, Gradle `--max-workers=<n>`.
Unset: leave the runner's default.

## Build and commands (never switch frameworks)

| Build | Whole suite | One test |
|---|---|---|
| Maven (`pom.xml`; prefer `./mvnw`) | `./mvnw -B test` | `./mvnw -B test -Dtest='ClassTest#method'` |
| Gradle (`build.gradle[.kts]`; prefer `./gradlew`) | `./gradlew test` | `./gradlew test --tests 'pkg.ClassTest.method'` |

Run only the tests you write (the "One test" column); the whole suite is the orchestrator's when
the workflow has a suite step (see testing-principles: time budget). Which tests and how to read
them: the code → tests map when the project has one, and failures-only output (Maven `-q`, Gradle
`--quiet`; read the `[ERROR]` / `FAILED` lines), never the whole log (testing-principles: the code
→ tests map, agent mode).
On Windows use `mvnw.cmd`/`gradlew.bat` if the extensionless scripts do not run.
Dependencies: a fresh checkout (each run has its own worktree) has no build output; the first
`test` run resolves dependencies into the shared Maven/Gradle cache, so give it time and do not
treat a slow first run as a failure.
Libraries: read the test dependencies (JUnit 4 vs 5, AssertJ/Hamcrest, Mockito/MockK, Kotest) and use what is there.

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (e.g. `timeout: 300000` for
  one focused file in this orchestrator, the suite's budget for the whole suite), never the default
  120 s: a command cut there returns no result and the turn is lost (long-commands). Never start a
  test command in the background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (the runner's duration line). A file that takes more than a
  minute is a slow file: from then on run it with a narrower filter (`-Dtest=<Class>#<method>` (Maven), `--tests "<Class>.<method>"` (Gradle), one class),
  at most once per round; a command that may take longer than the tool's maximum goes to the
  orchestrator's suite step or runs with a narrower filter.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; never
  one assertion per edit-and-run cycle. Each turn re-reads your whole context.

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
