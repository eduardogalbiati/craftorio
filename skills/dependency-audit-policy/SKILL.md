---
name: dependency-audit-policy
description: Shared rules for building a project and auditing its dependencies - production vs development scope, severity from CVSS when the tool gives none, how to report blockers with a fix, and log redaction. Loaded by every build-audit-<language> skill.
summary: "Severity from CVSS, how to report blockers with a fix, redaction"
used_by: "via `uses`"
---

# Build and dependency audit: shared rules

The language skill gives the commands. These rules decide how to read and report the results.

## Scope

- **Production**: anything that ships or runs in production (runtime/compile dependencies).
- **Development**: test frameworks, linters, build-only tools, test projects.
- When a tool cannot separate them, use the language skill's method (lock export, scopes,
  reachability) and state which method you used.

## Severity

Use the tool's severity when it gives one. Otherwise take the CVSS score from the advisory
(GHSA/CVE/OSV alias):

| CVSS | Severity |
|---|---|
| 9.0 – 10.0 | critical |
| 7.0 – 8.9 | high |
| 4.0 – 6.9 | moderate |
| 0.1 – 3.9 | low |

If the severity cannot be determined, count it as **high** and say so. Being wrong on the safe
side costs a fix; being wrong the other way ships a vulnerability.

## Exit codes are not build failures

Audit tools exit non-zero when they find vulnerabilities. Only a failure to install, compile or
package is `build_status: failed`.

## Reporting

- Build failure: `file:line: message` and the likely cause, not the whole log.
- Each blocking vulnerability: package, installed version, advisory id, severity, scope, the
  direct dependency that pulls it in (for transitive ones), and the fix (version to upgrade to,
  or the override/constraint mechanism of the ecosystem).
- Non-blocking findings: one summary line per severity.
- Replace any secret or token that appears in captured output with `<REDACTED>`.

## Done when

- the build command exited 0, or every failure is listed as `file:line`, message and cause;
- production and development counts are reported separately, with the method used to separate them;
- every blocking vulnerability has a concrete fix.
