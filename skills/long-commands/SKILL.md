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
- **Every test or build command gets an explicit timeout**: pass the tool's `timeout` parameter
  on each call (Claude Code's Bash tool), never rely on its default. The default is 120 s: a
  command cut there returns **no result**, the turn is lost and the same command is often run
  again (8 focused test commands cut at exactly 120 s in one night). The orchestrator logs each
  cut command as a `tool_timeout` warning.
- Size the timeout above the expected duration. Size it from what you know: a previous run of the
  same command, the CI job's duration, the size of the project (this orchestrator: `timeout: 300000`
  for one focused test file, the suite's budget for the whole suite). When unknown, use the tool's
  maximum (Claude Code's Bash tool: `timeout: 600000`).
- Longer than the tool's maximum: split it (test files, packages or modules in groups) and run
  each group in the foreground, or narrow the filter. The whole suite is the orchestrator's suite
  step when the workflow has one: never run it yourself to fit it into a timeout.
- **Never** start a suite or a build in the background and then poll for a string or a file
  (`until grep -q "passed" out.log; do sleep 5; done`, `while ! grep ...`, repeated `tail` calls,
  `node -e "function check() { … fs.existsSync … }"`): each such loop ends at the tool's 10-minute
  cap (three of them, 8 to 10 minutes each, in one 95-minute test step).

## 2. If a background job is unavoidable

(a server the tests need, a job longer than any timeout you can set)

- Use the tool's own background option (Claude Code's Bash tool: `run_in_background`), not a
  shell `&` or subshell: the tool tells you when the process exits and gives its exit code.
- Wait for the **process to exit**, not for text, and give every wait a **deadline and a failure
  branch**: it stops when the process is gone, whatever the output says, and gives up after a
  fixed time, reporting what the log shows so far.
- Stop what you started before you answer (servers, watchers): a process left running in the
  worktree locks its files for the next step.

## 3. Keep the whole output, read the exit code

- Simplest: run the suite as a single command (`npm test`) and read the exit code the tool
  already reports with the output.
- Don't pipe the suite through `tail`, `head` or `grep` when you need its result: failures above
  the cut disappear, and the pipeline's exit code is `tail`'s, so a failing suite looks green.
- For a long output, redirect it into the run's log folder (given in your prompt, e.g.
  `<run_dir>/logs/`), one command per call: `npm test > "<run_dir>/logs/test.log" 2>&1`, then read
  the exit code the tool reports and only what you need from the file (the summary, the failures
  with some context). A gitignored folder of the worktree (e.g. `.scratch/`) works too. Never
  `/tmp`, `$TEMP`, `mktemp` or AppData: writes outside the allowed folders are refused.
- Summary lines to look for: node:test `ℹ pass N` / `ℹ fail N` · Jest/Vitest `Tests:` ·
  pytest the last `N passed, M failed` line · `go test` `ok` / `FAIL` per package · Maven
  `Tests run:` · Gradle `BUILD SUCCESSFUL` / `BUILD FAILED` · `dotnet test` `Passed!` / `Failed!`.
  The exit code decides; the summary line explains.
- If you must pipe, make the suite's failure count: `set -o pipefail` (bash), `$LASTEXITCODE`
  right after the command (PowerShell).

## Unattended runs: commands nobody can approve

- A command the CLI would ask about is **refused**, not approved later: nobody is there to answer.
  Each refusal costs a whole model call over your context.
- Your current folder already is the worktree: run commands directly, never `cd <worktree> && …`.
  For another folder use the tool's own path option (`git -C <dir>`, `npm --prefix <dir>`).
- The environment variables the project needs for checks (e.g. `MULTIAGENT_SIMULATION_ONLY=1`)
  are already set: never prefix a command with `VAR=value`.
- Avoid shell expansions the CLI cannot check statically (`$VAR`, `$(...)`, `echo "exit=$?"`):
  they are refused too. Write paths out; the tool already reports the exit code.
- **One operation per Bash call**: pipes into read utilities (`tail`, `head`, `grep`, `wc`,
  `awk`) are fine; `;`/`&&` chains are accepted only when every part is allowed, so when unsure,
  run one command per call.
- **No scripts inline**: never `sed -i`, never a heredoc (`cat > file <<'EOF'`, `node - <<'EOF'`),
  never an inline `node -e "…{…}…"` or `awk '{…}'` program, never a `#` after a newline or a `$`
  expansion inside a quoted argument: the CLI's parser refuses them. A script goes to a file under `<run_dir>/scratch`,
  written with the `Write` tool, then `node <file>`.
- **File tools for files**: `Read` instead of `cat`/`sed -n`, `Grep` instead of `grep -n`, `Glob`
  instead of `ls`/`find`, `Edit` instead of `sed -i`, `Write` instead of `cat > file`. Bash stays
  for git, npm, node and test runs.
- After a refusal, rephrase it **once** into an allowed form (split it, drop the prefix or the
  `cd`, move the script into a file, move the log into the log folder); never retry variants of
  the refused call.

## Read-only agents

When your rules forbid files and redirection (`>`, `tee`), the foreground rule still holds: run
the command in the foreground with a sized timeout and let the tool return its output and exit
code; shorten the output with the runner's own options (a quiet reporter, a filter on the tests
you need), not with `tail`.
