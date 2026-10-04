Feature: Runs and gates
  A simulated run of the demo project, started from the Start panel, stops at its human gates.

  @issue-222 @smoke
  Scenario: A simulated run starts and reaches a gate
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    And a gate card waits for my approval

  @issue-222 @smoke
  Scenario: The gate card shows its summary and its buttons
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the gate card shows its summary and its buttons

  @issue-203
  Scenario: The Start panel offers the test options as pills
    Given the app is open
    When I open the Start panel
    Then "Unit tests" offers "Write and run", "Run existing" and "Off"
    And "E2E tests" offers "Off", "Write" and "Write and run"
    When I pick "Run existing" for "Unit tests"
    Then "Run existing" is selected for "Unit tests"

  @issue-203 @issue-216
  Scenario: The run shows its test options as pills
    Given the app is open
    When I open the Start panel
    And I pick "Run existing" for "Unit tests"
    And I pick "Off" for "E2E tests"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run shows the pill "Unit tests: Run existing"
    And the run shows the pill "E2E tests: Off"

  # Assumes the demo workspace (scripts/screenshot.js, demoRoadmapRuns) gets a finished run whose id
  # ends in "-run00233": its develop attempt 1/2 timed out, its cost estimated from the stream's model calls
  @issue-233
  Scenario: A run with a timed-out attempt marks its estimated cost
    Given the app is open
    When I open "Analytics" in the sidebar
    And I open the "Run" Analytics tab
    And I pick the run "run00233" in Analytics
    Then the run's total cost in Analytics is marked as estimated
    And the cost of the agent "developer" in Analytics is marked as estimated
    When I open the run from Analytics
    Then the run's total cost is marked as estimated

  # Assumes the demo workspace gets an old run (recorded before #233) whose id ends in "-old00233":
  # its develop attempt was stopped and no cost was recorded for it
  @issue-233
  Scenario: An old run's stopped attempt shows its cost as not recorded
    Given the app is open
    When I open "Analytics" in the sidebar
    And I open the "Run" Analytics tab
    And I pick the run "old00233" in Analytics
    And I open the run from Analytics
    Then the run's "developer" session shows "cost not recorded"
