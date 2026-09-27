---
name: bug-diagnosis
description: Disciplined loop for fixing a reported failure (failing test, CI error, broken build, production bug) - build a red feedback loop first, rank falsifiable hypotheses, instrument, add a regression test, fix, clean up. Use whenever you are asked to fix something that is broken rather than build something new.
---

# Bug diagnosis

Adapted from the diagnosing-bugs skill in mattpocock/skills (MIT). You run unattended: nobody
can answer questions, so record assumptions instead of asking.

## 1. Build a feedback loop (do not skip)

Before touching code, get **one command** that shows the failure and is:
- **red-capable**: it fails now, for the reported reason;
- **deterministic**: same result every run;
- **fast**: seconds, not minutes;
- **runnable by you**: no manual steps.

Try, in order, until one works:
1. the failing test itself (run only that test);
2. a new minimal failing test at the nearest public seam;
3. a direct call: CLI invocation, `curl` against a local server, a small script;
4. replay of the captured input from the report (log line, payload, fixture);
5. `git bisect run <command>` when the failure is a regression with a known good commit.

If you truly cannot reproduce it, say so, list what you tried, and stop: a fix without a
reproduction is a guess.

## 2. Minimise

Shrink the input and the path until removing anything more makes the failure disappear.

## 3. Hypotheses

Write 3–5 ranked hypotheses, each **falsifiable**: "if X is the cause, then changing Y makes
the command pass". Test the cheapest one that discriminates the most first.

## 4. Instrument

Add temporary logs with a unique prefix (`[DBG-<short-id>]`) so they are easy to find and
remove. Read values, do not guess them.

## 5. Regression test, then fix

1. Turn the feedback loop into a regression test at the right seam (see testing-principles if loaded).
2. Confirm it fails for the right reason.
3. Make the smallest fix that addresses the root cause, not the symptom.
4. Run the regression test, then the full suite.

## 6. Clean up

Remove every `[DBG-` line (grep for it), temporary scripts and fixtures you do not keep.
Replace secrets in anything you quote with `<REDACTED>`.

## Report

- root cause in one sentence, with file and function;
- the feedback-loop command and its before/after result;
- the regression test added;
- assumptions made.

## Done when

The regression test failed before the fix and passes after it, the full suite passes, and no
debug instrumentation is left.
