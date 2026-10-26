---
name: bug-diagnosis
description: Disciplined loop for fixing a reported failure (failing test, CI error, broken build, production bug) - build a red feedback loop first, rank falsifiable hypotheses, instrument, add a regression test, fix, clean up. Use whenever you are asked to fix something that is broken rather than build something new.
summary: "Red feedback loop first, ranked hypotheses, regression test, cleanup"
used_by: "developer"
---

# Bug diagnosis

Adapted from the diagnosing-bugs skill in mattpocock/skills (MIT). You run unattended: nobody
can answer questions, so record assumptions instead of asking. Only on a step whose output
schema offers `needs_human`, ask instead for a choice the owner would want to make (irreversible
or costly): a question, its options and your default.

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

**A finding bundle** (an issue that names a `findings/<timestamp>/` folder: `marked.png`,
`marks.json`, `context.json`, `note.md`) is the report's captured input: follow its sightline.
Look at `marked.png`. For each numbered pin in `marks.json`, map its element's `data-testid` and
view to the module that renders it (the project's code map). Rebuild the state from `context.json`
(view, tab, project, run ids, the last UI actions and service calls with their errors, the main
log), with the project's screenshot seeds for that view when it has them. Then write the check that
fails before the fix. The project's renderer docs say how to read one in detail.

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

**When tests are not yours** (your role says another agent writes them, e.g. the developer of a
workflow with a test writer): never create or edit a test, not even a regression test (skip
option 2 of step 1). Make the fix, show the feedback-loop command red before and green after it,
and describe the regression test to write (seam, input, expected value) in your answer, in
`test_notes` when it has one. Skip the full suite: the test writer runs it.

## 6. Clean up

Remove every `[DBG-` line (grep for it), temporary scripts and fixtures you do not keep.
Replace secrets in anything you quote with `<REDACTED>`.

## Report

- root cause in one sentence, with file and function;
- the feedback-loop command and its before/after result;
- the regression test added (or, when tests are not yours, the one to write);
- assumptions made.

## Done when

The regression test failed before the fix and passes after it, the full suite passes, and no
debug instrumentation is left. When tests are not yours: the feedback-loop command failed before
the fix and passes after it, and the regression test to write is described.
