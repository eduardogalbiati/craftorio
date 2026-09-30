---
name: build-audit-java
description: Builds a Java/Kotlin project (Maven or Gradle) and audits its dependencies for vulnerabilities, separating production from test scopes (osv-scanner, OWASP Dependency-Check). Use to check whether a JVM project builds and has vulnerable dependencies.
uses: [dependency-audit-policy, long-commands]
summary: "Build and audit commands, production vs development scope per ecosystem"
used_by: "builder"
---

# Build and audit: Java / Kotlin

## Build

Prefer the project's wrapper (`./mvnw`, `./gradlew`; on Windows `mvnw.cmd`, `gradlew.bat`).
Tests were already run by the test writer, so skip them here:

| Build | Command |
|---|---|
| Maven | `./mvnw -B -DskipTests package` |
| Gradle | `./gradlew build -x test` |

Compilation, dependency-resolution or plugin failure is `build_status: failed`.

## Audit

Scopes: **production** = `compile`/`runtime` (Maven) or `implementation`/`api`/`runtimeOnly` (Gradle).
**Development** = `test`/`provided` (Maven) or `testImplementation`/`compileOnly` (Gradle).

Tools, first one available wins:
1. `osv-scanner --format json -r .` (reads `pom.xml`, `gradle.lockfile`), with severity. Map findings to scopes with
   `./mvnw -B dependency:tree -Dscope=runtime` or `./gradlew dependencies --configuration runtimeClasspath`.
2. OWASP Dependency-Check: `./mvnw -B org.owasp:dependency-check-maven:check -Dformat=JSON -DfailBuildOnCVSS=11`
   (Gradle plugin `org.owasp.dependencycheck`, task `dependencyCheckAnalyze`). Slow on the first run (downloads the NVD data).

Fix: `group:artifact:version`, advisory, scope, the direct dependency that brings it (from the tree), and either upgrading the direct one or pinning the transitive one (`<dependencyManagement>` in Maven, `constraints {}` in Gradle).
