Feature: Runs filtered by workflow
  Workflows › Runs offers a workflow filter beside its status chips: it lists the workflows that have
  runs, each with its run count, and picking one shows only that workflow's runs. It combines with
  the status chips, "Show simulated" and the search, the chips count what it keeps, "All workflows"
  clears it, and the choice stays while moving between the screen's tabs.

  # Assumes the demo workspace (scripts/screenshot/views/roadmap.js): the AI Development (local hero)
  # runs "-run00233" and "-run00308" (succeeded), "-old00233" (failed) and "-cch00320" (stopped at a
  # gate, read as interrupted), and the Software Development (local hero) runs of the roadmap, among
  # them "-run00013" (failed) and "-run00009" (succeeded). None of them is simulated.

  @issue-310
  Scenario: Picking a workflow lists only its runs, with its run count
    Given the app is open
    When I open "Runs" in the sidebar
    And I filter the runs by the workflow "AI development local hero"
    Then every run row shows the workflow "AI development local hero"
    And the run list shows the run "run00233"
    And the run list does not show the run "run00013"
    And the workflow filter counts as many runs for "AI development local hero" as the list shows
    And the "All" status chip counts the runs listed

  @issue-310
  Scenario: The workflow filter combines with the Failed chip, whose count follows it
    Given the app is open
    When I open "Runs" in the sidebar
    And I filter the runs by the workflow "AI development local hero"
    And I click the "Failed" status chip of the runs
    Then the run list shows the run "old00233"
    And the run list does not show the run "run00013"
    And the run list does not show the run "run00233"
    And every run row shows the workflow "AI development local hero"
    And the "Failed" status chip counts the runs listed

  @issue-310
  Scenario: The workflow filter stays while moving between tabs, and "All workflows" clears it
    Given the app is open
    When I open "Runs" in the sidebar
    And I filter the runs by the workflow "AI development local hero"
    And I open "Definitions" in the sidebar
    And I open "Runs" in the sidebar
    Then the Workflows screen is on its "Runs" tab
    And the runs are still filtered by the workflow "AI development local hero"
    And the run list does not show the run "run00009"
    When I show the runs of all workflows
    Then the run list shows the run "run00009"
    And the run list shows the run "run00233"
