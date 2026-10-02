---
name: e2e-scenarios
description: Language-agnostic rules for end-to-end acceptance scenarios written as BDD (Given/When/Then), covering when to write them (user-visible behaviour only, at most 3 per issue), how to derive them from the task, where the feature files go, the per-scenario result the step reports (passed, failed, skipped with the reason), screenshots per scenario and the time budget (only the issue's tag). Loaded by every e2e-test-writer-<language> skill.
summary: "User-visible changes only, at most 3 scenarios per issue reusing existing steps; run only the @issue-<n> tag; per-scenario status with reason; screenshots at key steps"
used_by: "via `uses`"
---

# End-to-end scenarios (BDD)

The language skill tells you the framework and commands. These rules decide which scenarios to
write and how to report them. The person who validates the run (a developer or a QA) reads your
scenarios and their screenshots at the gate and approves from them: write them for that reader.

## 1. Keep E2E cheap (every run)

E2E scenarios are slow and costly to write and run. The rules of this section come first:
- **Only for user-visible behaviour**: write scenarios only when the issue changes what a person
  sees or does (a screen, a dialog, a CLI output a person reads). An engine, refactor, build or
  docs issue gets **none**: report an empty `scenarios` list and say why in `e2e_note`.
- **At most 3 scenarios per issue**: the main path and the failure cases the issue names, no
  more. Pick the ones a person validating the run most needs to see.
- **Reuse before writing**: use the project's existing step definitions first; write a new step
  only for a phrase no existing step covers.
- **Run only this run's scenarios, by their issue tag** (`@issue-<n>`): never the whole E2E
  suite, not even at the end. The full E2E suite runs in the release workflow.

## 2. Derive the scenarios from the task

- Read the task, the issue and its acceptance criteria. Write one scenario per verifiable
  behaviour, within the limit of section 1: the main path first, then the failure and edge cases
  the issue names (an empty list, an invalid value, a missing permission, an error message).
- Plain language, from the user's side: `Given` the state the user starts from, `When` what they
  do, `Then` what they see or get. No function names, selectors or file paths in the steps.
- Group the scenarios of one issue in one feature file named after it
  (`<issue-number>-<short-name>.feature`), in the repository's usual feature folder (the language
  skill names it), with a `Feature:` line that says what the change gives the user, and tag each
  scenario with its issue (`@issue-<n>`).
- Never invent a scenario that only restates a unit test.
- You run unattended: when a criterion is ambiguous, pick the reading the code implements, write
  the scenario for it and record the assumption in the scenario's `reason`.
- You run unattended: when a criterion is ambiguous, pick the reading the code implements, write
  the scenario for it and record the assumption in the scenario's `reason`.

## 3. Step definitions

- Reuse the project's existing steps before writing new ones (section 1); one step definition per phrase,
  parameterised (`the list has {int} items`), never one per scenario.
- Drive the program through its public surface: the UI (a browser or the project's UI check
  script), the CLI, the HTTP API. Never call internal functions from an E2E step: that is a unit
  test.
- Steps never call paid services or real AI models: use the project's mock or simulation switch
  (this orchestrator: `MULTIAGENT_SIMULATION_ONLY=1`, already in your environment, and a scratch
  workspace).
- Feature files and step definitions are tests: only the test writer writes them (they are under
  the workflow's `tests_paths`); commit them with the other tests.

## 4. Screenshots per scenario

- For a UI scenario, take a screenshot at its key steps (after the `When`, at each `Then` that
  checks something visible), at most 3 per scenario.
- Save them in the evidence folder your prompt gives (`evidence_dir`), named
  `<issue>-e2e-<scenario-slug>-<n>.modified.png`, and list their paths (relative to the run
  folder, e.g. `evidence/test/round-1/143-e2e-empty-list-1.modified.png`) in the scenario's
  `screenshots`.
- No browser or display available: run what you can headless and report the screenshots as
  missing in the scenario's `reason`; never fake an image.

## 5. Report each scenario

In the step output's `scenarios`, one entry per scenario:
- `feature`: the feature file (path in the repository); `name`: the scenario's title;
- `steps`: its Given/When/Then lines, in order, each starting with its keyword
  (`Given`, `When`, `Then`, `And`, `But`);
- `status`: `passed`, `failed` or `skipped`;
- `reason`: required for `failed` and `skipped`: what failed (the step and the error, one line) or
  why it did not run;
- `screenshots`: the paths of section 4 (empty for a non-UI scenario).

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

## 6. Time budget

- Follow long-commands: foreground, a timeout sized for the run, the whole output in the run's
  log folder, the exit code decides.
- Run **only this run's scenarios by their issue tag** (`--tags "@issue-<n>"` or the language
  skill's equivalent), once when they pass. Never the whole E2E suite: the release workflow runs
  it. Say which tag you ran in `e2e_note`.
- Start the program the scenarios need inside the test run (the framework's hooks or the
  project's check script) and stop it at the end, on failures too: a program left running locks
  the worktree.
