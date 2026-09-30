---
name: long-commands
description: How to run test suites, builds, installs and audits that take minutes - in the foreground with a timeout sized for the project, never backgrounded and polled for a text marker, with the full output kept and the exit code read. Loaded by the developer agent (software-development) and by the unit-test-writer, build-audit and claim-verification skills.
summary: "Suites and builds in the foreground with a sized timeout, never backgrounded and polled for text; full output kept, exit code read"
used_by: "developer; via `uses` (test writer, builder, verifier)"
---

# Long-running commands (suites, builds, installs, audits)

A wait that only matches the happy-path text never ends when that text does not show up (another
output format, a crash, a hang, the output cut by `tail`). Real case: a suite started in the
background with `npm test 2>&1 | tail -40`, then `until grep -q "duration_ms" <output>; do sleep 5; done`.
The last 40 lines never contained `duration_ms`, so the agent sat idle for 10 minutes until the
tool's own timeout, although the suite had passed in 3.

## 1. Foreground, with a timeout sized for the project

- Run the suite, the build, `npm ci`/`pip install`/`mvn`/`dotnet` **in the foreground**: one call
  that returns when the process exits.
- Set the tool's timeout above the expected duration, not at its default. Size it from what you
  know: a previous run of the same command, the CI job's duration, the size of the project. When
  unknown, use the tool's maximum (Claude Code's Bash tool: `timeout: 600000`).
- Longer than the tool's maximum: split it (test files, packages or modules in groups) and run
  each group in the foreground.
- **Never** start a suite or a build in the background and then poll for a string
  (`until grep -q "passed" out.log; do sleep 5; done`, `while ! grep ...`, repeated `tail` calls).

## 2. If a background job is unavoidable

(a server the tests need, a job longer than any timeout you can set)

- Wait for the **process to exit**, not for text. Record the exit code when it ends and wait for
  that: `(npm test > "$LOG" 2>&1; echo $? > "$LOG.exit") &`, then poll for `$LOG.exit` to exist.
  PowerShell: `Start-Process -PassThru` + `Wait-Process -Timeout`, then `.ExitCode`.
- Every wait has a **deadline and a failure branch**: it stops when the process is gone, whatever
  the output says, and gives up after a fixed time, reporting what the log shows so far:
  `deadline=$((SECONDS+900)); until [ -f "$LOG.exit" ] || [ $SECONDS -ge $deadline ]; do sleep 10; done`.
- Stop what you started before you answer (servers, watchers): a process left running in the
  worktree locks its files for the next step.

## 3. Keep the whole output, read the exit code

- Don't pipe the suite through `tail`, `head` or `grep` when you need its result: failures above
  the cut disappear, and the pipeline's exit code is `tail`'s, so a failing suite looks green.
- Write the full output to a scratch file **outside the repository** (a temp folder:
  `LOG=$(mktemp)`, `$env:TEMP`), then read the exit code and the summary line the framework
  always prints: `npm test > "$LOG" 2>&1; echo "exit=$?"`. Then read only what you need from the
  file (the summary, the failures with some context).
- Summary lines to look for: node:test `ℹ pass N` / `ℹ fail N` · Jest/Vitest `Tests:` ·
  pytest the last `N passed, M failed` line · `go test` `ok` / `FAIL` per package · Maven
  `Tests run:` · Gradle `BUILD SUCCESSFUL` / `BUILD FAILED` · `dotnet test` `Passed!` / `Failed!`.
  The exit code decides; the summary line explains.
- If you must pipe, make the suite's failure count: `set -o pipefail` (bash), `$LASTEXITCODE`
  right after the command (PowerShell).

## Read-only agents

When your rules forbid files and redirection (`>`, `tee`), the foreground rule still holds: run
the command in the foreground with a sized timeout and let the tool return its output and exit
code; shorten the output with the runner's own options (a quiet reporter, a filter on the tests
you need), not with `tail`.
