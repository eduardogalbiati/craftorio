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
