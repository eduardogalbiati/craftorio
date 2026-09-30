---
name: claim-verification
description: Proves or disproves a concrete claim about a change ("the endpoint now returns 404 for unknown ids", "the build is 30% faster") by running the same command before and after and comparing raw evidence, ending in exactly one verdict - verified, not_verified or inconclusive. Strictly read-only - never changes the working tree. Use after a change is built to confirm it does what the task asked.
uses: [long-commands]
---

# Claim verification

Adapted from verify-this (cursor-team-kit) and the prove-it-works principle (pstack), both MIT.
You run unattended: you derive the claim yourself and never ask for one.

## 0. Read-only rules

You usually run with shell tools only (git and the language toolchains) and no file-writing
permission. Work inside that, do not fight it:
- **The working tree must not change.** No new files (no `.verify/`, no scratch scripts, no
  saved outputs), no `git stash`, no `git worktree add`, no `git checkout`/`git switch` of another
  branch or commit, no `git reset`. Command output stays in your answer, not on disk.
- **No output redirection** (`>`, `>>`, `tee`) and **no heredocs** (`node - <<'EOF'`): they are
  rejected in headless mode.
- **Ad-hoc code is one command**: `node -e "..."` (Python: `python -c "..."`; other languages:
  their existing test runner with a filter). Keep it short; split into several calls instead of one
  long script. Use double quotes around the code and single quotes inside it; avoid `$`,
  backticks and `!` in the code (the shell would expand them).
- **One command per call**: no `&&`/`;` chains that mix in commands you are not allowed to run
  (`cd`, `mkdir`, `rm`, `cat`...). Use `git -C <dir>` or paths relative to the current folder.
- If a check cannot be done this way (it needs a running service, credentials, a build of the
  base commit, files on disk), stop and answer `inconclusive` with the reason. Do not spend
  turns working around permission denials.

## 1. State the claim

Derive it from the task and the change summary, and write it so it can be false:
- **subject**: what is observed (a function's result, an HTTP response, a CLI's output, a metric);
- **expected**: the exact observable outcome (value, status code, text, threshold);
- **baseline**: what happens without the change.

"The feature works" is not a claim. "`GET /users/999` returns 404 with `{error: 'not_found'}`
instead of 500" is. If the task has several behaviours, pick the one or two most important
and say so.

If no observable claim can be derived (pure refactor, docs), the verdict is `inconclusive`
with that reason; that is an honest answer, not a failure.

## 2. Pick the evidence command

The cheapest command that observes the claim directly, run by you, deterministic:
a focused existing test (`npx vitest run <path> -t "<name>"`, `python -m pytest <file>::<test>`),
a one-liner calling the public function, the CLI with an input passed as an argument, a
benchmark one-liner with a fixed seed and several repetitions.
Existing tests passing is supporting evidence, not proof of the claim.

## 3. Baseline vs treatment

**Treatment** is the change's branch, which is what is checked out in the current folder
(confirm with `git rev-parse --abbrev-ref HEAD` and `git status --short`). Run the command here.
If the branch is not the one checked out, do not switch: read its files with
`git show <branch>:<path>` and load them as for the baseline below.

**Baseline** is the base, read straight from git without touching the working tree:
- what changed: `git diff <base>...<branch> --stat` and `git diff <base>...<branch> -- <path>`;
- base version of a file: `git show <base>:<path>`;
- run base code by loading its source from git into a one-liner, e.g. for a CommonJS module:
  `node -e "const src=require('child_process').execSync('git show <base>:src/x.js').toString(); const m={exports:{}}; new Function('module','exports','require',src)(m,m.exports,require); console.log(m.exports.fn(999))"`
  and the same call against `require('./src/x.js')` for the treatment. Python:
  `python -c "import subprocess; src=subprocess.check_output(['git','show','<base>:pkg/x.py'],text=True); ns={}; exec(src, ns); print(ns['fn'](999))"`.
  This works for self-contained modules; when the base code depends on other files that also
  changed, or needs a build step, you cannot run the base faithfully.
- if the claim is a new capability, the baseline is that it did not exist: show it from the base
  source (`git show <base>:<path>`, `git grep -n "<name>" <base>`) instead of running it.

Keep the command and inputs identical on both sides. For numbers (performance), run each side
at least 3 times and report the median and the spread. When the baseline cannot be run or read
reliably, say so; the verdict is `inconclusive` unless the treatment alone already contradicts
the claim (`not_verified`).

## 4. Verdict

| Verdict | When |
|---|---|
| `verified` | treatment shows the expected outcome and the baseline does not (or the claim is a new capability that did not exist) |
| `not_verified` | treatment does not show the expected outcome, or the baseline already did (the change did nothing) |
| `inconclusive` | no observable claim, the command cannot run here (missing service, credentials, read-only limits), or results are noisy beyond the claimed effect |

Report: the claim, the command, the decisive lines of baseline and treatment output (secrets
replaced by `<REDACTED>`), and the verdict with one sentence of reasoning. For `not_verified`,
say what was observed instead, so the developer can act on it.

## Done when

Both sides were run with the identical command (or the reason they could not be is stated),
exactly one verdict is given, and `git status --short` shows the same state as before you started.
