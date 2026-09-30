---
name: ci-failure-triage
description: Shared method to read a failed CI job log and turn it into a short root-cause report, telling code failures apart from infrastructure or flaky ones. Loaded by the ci-pipeline-<platform> and deploy-<platform> skills.
summary: "Classify a failure (code, environment, infrastructure, needs-human) and write a root-cause report"
used_by: "via `uses`"
---

# CI failure triage

The platform skill tells you how to find the failed job and fetch its log. This skill tells you
what to do with it.

## Read the log

1. Start at the end of the failed step and scroll up to the **first** error, not the last one:
   later errors are usually consequences.
2. Identify the job, the step, and the command that failed.
3. Classify the failure:

| Class | Signals | Action |
|---|---|---|
| **Code** | compiler/type errors, failing assertions, lint errors, a test that also fails locally | report as `failed` so the developer fixes it |
| **Environment drift** | works locally but CI uses another runtime version, missing env var, lockfile out of sync | report as `failed` and name the mismatch |
| **Infrastructure / flaky** | runner lost, timeouts fetching dependencies, registry 5xx, rate limit, job cancelled with no code error | retry once (platform skill); if it fails again, report `failed` and say it looks like infrastructure |
| **Needs a human** | missing secret or permission, protected environment approval, quota | report `failed` and say a human must act; a code fix will not help |

## Write the report

One block, in this order, under 150 words:

```
job / step: <job> → <step>
error: <the decisive 1–5 log lines, quoted>
cause: <probable root cause, with file:line when there is one>
class: code | environment | infrastructure | needs-human
```

- Quote the lines that prove the cause; do not paste the whole log.
- Replace any secret or token in quoted lines with `<REDACTED>`.
- Describe the failing behaviour, not only the line: the code may have moved by the time someone reads it.

## Done when

Every failed required job has a report block, or was retried once as infrastructure.
