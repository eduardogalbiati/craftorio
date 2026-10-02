---
name: e2e-scenarios
description: Language-agnostic rules for end-to-end acceptance scenarios written as BDD (Given/When/Then), covering how to derive them from the task, where the feature files go, the per-scenario result the step reports (passed, failed, skipped with the reason), screenshots per scenario and the time budget. Loaded by every e2e-test-writer-<language> skill.
summary: "Scenarios from the task and its acceptance criteria, one per verifiable behaviour; per-scenario status with reason; screenshots at key steps; only the run's scenarios locally"
used_by: "via `uses`"
---

# End-to-end scenarios (BDD)

The language skill tells you the framework and commands. These rules decide which scenarios to
write and how to report them. The person who validates the run (a developer or a QA) reads your
scenarios and their screenshots at the gate and approves from them: write them for that reader.

## 1. Derive the scenarios from the task

- Read the task, the issue and its acceptance criteria. Write **one scenario per verifiable
  behaviour**, including every failure and edge case the issue names (an empty list, an invalid
  value, a missing permission, an error message).
- Plain language, from the user's side: `Given` the state the user starts from, `When` what they
  do, `Then` what they see or get. No function names, selectors or file paths in the steps.
- Group the scenarios of one issue in one feature file named after it
  (`<issue-number>-<short-name>.feature`), in the repository's usual feature folder (the language
  skill names it), with a `Feature:` line that says what the change gives the user.
- A purely internal change with no user-visible behaviour (a refactor, a build script) may have
  no scenario: report an empty `scenarios` list and the reason in `e2e_note`. Never invent a
  scenario that only restates a unit test.
- You run unattended: when a criterion is ambiguous, pick the reading the code implements, write
  the scenario for it and record the assumption in the scenario's `reason`.

## 2. Step definitions

- Reuse the project's existing steps before writing new ones; one step definition per phrase,
  parameterised (`the list has {int} items`), never one per scenario.
- Drive the program through its public surface: the UI (a browser or the project's UI check
  script), the CLI, the HTTP API. Never call internal functions from an E2E step: that is a unit
  test.
- Steps never call paid services or real AI models: use the project's mock or simulation switch
  (this orchestrator: `MULTIAGENT_SIMULATION_ONLY=1`, already in your environment, and a scratch
  workspace).
- Feature files and step definitions are tests: only the test writer writes them (they are under
  the workflow's `tests_paths`); commit them with the other tests.

## 3. Screenshots per scenario

- For a UI scenario, take a screenshot at its key steps (after the `When`, at each `Then` that
  checks something visible), at most 3 per scenario.
- Save them in the evidence folder your prompt gives (`evidence_dir`), named
  `<issue>-e2e-<scenario-slug>-<n>.modified.png`, and list their paths (relative to the run
  folder, e.g. `evidence/test/round-1/143-e2e-empty-list-1.modified.png`) in the scenario's
  `screenshots`.
- No browser or display available: run what you can headless and report the screenshots as
  missing in the scenario's `reason`; never fake an image.

## 4. Report each scenario

In the step output's `scenarios`, one entry per scenario:
- `feature`: the feature file (path in the repository); `name`: the scenario's title;
- `steps`: its Given/When/Then lines, in order, each starting with its keyword
  (`Given`, `When`, `Then`, `And`, `But`);
- `status`: `passed`, `failed` or `skipped`;
- `reason`: required for `failed` and `skipped`: what failed (the step and the error, one line) or
  why it did not run;
- `screenshots`: the paths of section 3 (empty for a non-UI scenario).

Then decide the step:
- A scenario that fails **because of production code** is a test failure like a unit test's:
  `tests_status: fail` and the scenario in `failure_report` (scenario, step, error, probable
  cause). Never change the production code, and never weaken the scenario to make it pass.
- A scenario that cannot run because of the **environment** (no browser, the app does not start,
  a port is taken, a dependency cannot be installed) is `skipped` with the reason, and the reason
  also goes to `e2e_note`. It does not fail the step, and it is never left out silently: the
  person at the gate sees it and decides whether to try it by hand.
- A scenario that also fails on the base branch is a pre-existing failure (testing-principles):
  `preexisting_failures`, not this run's failure.

## 5. Time budget

- Follow long-commands: foreground, a timeout sized for the suite, the whole output in the run's
  log folder, the exit code decides.
- Locally, run **only this run's scenarios** (by feature file or tag, e.g. `@issue-143`), once
  when they pass. A slow E2E suite (over about five minutes) is never run whole locally: CI runs
  it. Say so in `e2e_note`.
- Start the program the scenarios need inside the test run (the framework's hooks or the
  project's check script) and stop it at the end, on failures too: a program left running locks
  the worktree.
