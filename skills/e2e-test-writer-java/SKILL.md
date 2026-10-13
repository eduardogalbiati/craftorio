---
name: e2e-test-writer-java
description: Writes end-to-end BDD scenarios (Given/When/Then) for Java/Kotlin projects with the framework the project already uses (Cucumber-JVM, JBehave, Serenity BDD); default Cucumber-JVM with JUnit 5 (+ Playwright for Java or Selenium for a web UI). Development runs write them and check that they parse (pending, run at release); the E2E release workflow runs the whole suite and reports each result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands"
used_by: "test writer, E2E runner"
---

# E2E scenarios: Java / Kotlin

**Test workers (#367)**: a run gets `MULTIAGENT_TEST_WORKERS` (and `MULTIAGENT_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
once (`printenv MULTIAGENT_TEST_WORKERS`) and pass the number to the runner you call: Maven `-DforkCount=<n>`, Gradle `--max-workers=<n>`.
Unset: leave the runner's default.

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Release run (one file, or by tag) |
|---|---|---|---|
| `io.cucumber` dependencies | Cucumber-JVM | `src/test/resources/features/` | Maven `mvn -q test -Dcucumber.filter.tags="@issue-<n>"` · Gradle `./gradlew test -Dcucumber.filter.tags="@issue-<n>"` |
| `net.serenity-bdd` dependencies | Serenity BDD (Cucumber) | `src/test/resources/features/` | `mvn -q verify -Dcucumber.filter.tags="@issue-<n>"` |
| `org.jbehave` dependencies | JBehave | `src/test/resources/stories/` | the project's story runner with the issue's meta filter |

- **Development run**: write the scenarios and check that they parse, never run them (no app,
  no browser): Cucumber-JVM `mvn -q test -Dcucumber.execution.dry-run=true -Dcucumber.filter.tags="@issue-<n>"` (Gradle: the same system properties). Each is reported `pending`; the E2E release workflow runs the suite.
- **No E2E framework yet**: default to **Cucumber-JVM** on the JUnit 5 Platform
  (`cucumber-java`, `cucumber-junit-platform-engine`), features in
  `src/test/resources/features/`, steps in `src/test/java/.../e2e/`. A web UI: Playwright for Java
  (or Selenium when the project has it). Record the assumption in `e2e_note`; add the dependencies
  to the build file in the test scope.
- Use the wrapper when present (`./mvnw`, `./gradlew`), batch mode (`-B`) for Maven.
- When no browser can run, the UI scenarios are `skipped` (environment).

## Idioms

- Tag each scenario with its issue (`@issue-143`).
- Step state in a per-scenario object (Cucumber's dependency injection, e.g. PicoContainer), never
  static fields.
- The app or server starts in a `@BeforeAll` hook (or Spring's `@CucumberContextConfiguration`)
  and stops in `@AfterAll`, on failure too.
- Screenshots: `page.screenshot(new Page.ScreenshotOptions().setPath(...))` into `evidence_dir`
  with the e2e-scenarios naming.
