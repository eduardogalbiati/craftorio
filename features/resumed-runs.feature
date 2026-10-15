Feature: A failed run that was resumed
  When a failed run is resumed from a step, its card in the run list (Workflows › Runs) no longer
  reads "Failed": it shows a neutral "Resumed" status and "Resumed → <the resumed run's status>",
  a link that opens the resumed run. A roadmap item whose failed run was resumed shows the resumed
  run as its run (the one that holds its status), with the earlier failed run in its history.

  # The seeded runs (features/steps/resumed-runs.steps.js) are software-development-local-hero runs
  # of the demo project: a failed run (summary.json status "failed"), then the run that resumes it
  # (its workflow.started event carries resumed_from: { run_id: <the failed run>, step: "test" }),
  # either finished (summary.json status "success") or still running (no summary, a fresh owner.json
  # heartbeat from another machine). The roadmap scenario resumes the demo roadmap's failed run
  # "-run00013" (#13 "Run reports", stage "Tonight") and records it as src/roadmap.js adoptResumed
  # does: the item's runId is the resumed run, its runs list both.

  @issue-384
  Scenario: A failed run whose resume succeeded shows "Resumed" with a link that opens the resumed run
    Given the app is open
    And the failed run "fal00384" was resumed as the run "rsm00384", which succeeded
    When I open "Runs" in the sidebar
    And I search the runs for "fal00384"
    Then the run list row of "fal00384" shows the status "Resumed" with the id "resumed"
    And the run list row of "fal00384" does not show the status "Failed"
    And the run list row of "fal00384" says "Resumed → succeeded" with a link to the run "rsm00384"
    When I follow the resumed link of the run "fal00384"
    Then the run screen shows the run "rsm00384"

  @issue-384
  Scenario: A failed run whose resume is still running says so, with the link to the resumed run
    Given the app is open
    And the failed run "fal10384" was resumed as the run "rsm10384", which is still running
    When I open "Runs" in the sidebar
    And I search the runs for "fal10384"
    Then the run list row of "fal10384" shows the status "Resumed" with the id "resumed"
    And the run list row of "fal10384" does not show the status "Failed"
    And the run list row of "fal10384" says "Resumed → running" with a link to the run "rsm10384"

  @issue-384
  Scenario: A roadmap item whose failed run was resumed shows the resumed run, the failed one in its history
    Given the app is open
    And the failed run "run00013" of the roadmap item "Run reports" was resumed as the run "rsm00013", which is still running
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Run reports" shows a run chip reading "Running"
    And the run history of the roadmap item "Run reports" lists the run "run00013" as "Failed"
    When I click the run chip of the roadmap item "Run reports"
    Then the run screen shows the run "rsm00013"
