---
order: 115
---

<!-- section:workflows -->
**Tests: on or off, per workflow and per run** (#203; inputs `unit_tests` and `e2e_tests`, shown
like `mode` in the Start drawer, the roadmap item's Edit form and the Backlog's Assign dialog, with
the workflow's default). The test step is the largest cost of a run (about half of it), so:
- `unit_tests`: **Write and run** (default) = the test writer writes the change's tests and runs the
  focused ones, then the orchestrator runs the whole suite; **Run existing** = no test writer for
  unit tests, the suite runs once without an agent and its failures go to the developer; **Off** =
  no suite at all.
- `e2e_tests`: **Write** (default) = the issue's BDD scenarios are written and checked to parse (run
  at release by `e2e-release`); **Write and run** = also run here (slow: it starts the app);
  **Off** = none.
- Both off: the run goes from the code review straight to the build (no test step); the build,
  the evidence, the verification and the merge always run. Nothing off is reported as tested: the
  run's Details show a badge per input ("Unit tests: Off", the source on hover: workflow default or
  chosen for this run), and the gates and the verifier get the same sentence. To test later, all
  together: the `test-batch` workflow.
- Your own defaults: change `default:` of these inputs in the workspace copy of the workflow. A
  copy changed only in its inputs' defaults still gets the app's new versions (your values kept).

**The orchestrator runs the suite, not an agent** (#177): after the test writer's turn, the `suite`
step (no agent) runs the project's whole test suite once (`test_command`, else found from the
project's files: `npm test`, `go test ./...`, `mvn test`, `dotnet test`, `pytest`…), saves the output
in the run's `logs/suite-<round>.log` and gives the test writer only the failing tests (name, file,
first lines of the error) and the log's path: at most 2 rounds, then the `test_failed` gate. Tests
that also fail on the base (the test writer's pre-existing failures) are reported, never chased.
The test writer runs only focused tests; a whole-suite command it starts anyway is noted in the
run as a warning. The summary counts the suite runs (`suite_runs: { engine, agents }`).

<!-- section:local-hero -->
- **Tests on or off** (#203): the same `unit_tests` / `e2e_tests` inputs and the same `suite` step (the orchestrator runs the whole suite once per round, #177) as `software-development`. With unit tests off nothing is reported as tested: `verify_failed` and the verifier say so, and the run's Details show it.
