@issue-412
Feature: The header
  The header holds the app-wide project, the 24/7 chip and the usage widget right after it, the
  Oracle, the notifications bell and the account chip, last at the right end. The run's status and
  id, its KPIs, Open logs, Start, Stop and "Pause after current step" are no longer in it: Stop and
  Pause after current step sit on the Run screen's tab row for a live run, and a workflow starts from
  Home, Projects or Workflows › Definitions.

  # The E2E app runs with sign-in off: the account chip shows once a signed-in state is pushed (#315)
  Scenario: The header reads project, 24/7, usage, Oracle, bell, and the account last, without the run's controls
    Given the app is open
    And I am signed in as "Ada Lovelace" with the email "ada@example.com"
    Then the header reads, left to right:
      | item          |
      | Project       |
      | 24/7          |
      | Usage         |
      | Oracle        |
      | Notifications |
      | Account       |
    And the account chip is at the right end of the header
    And the header shows no run status, no run KPIs, and no Start, Stop, Pause after current step or Open logs button

  # Slow simulated turns (#368) keep the run live while its row is read
  Scenario: A live run's Stop and Pause after current step are at the right end of its tab row, not in the header
    Given the app is open with slow simulated turns
    When I start a simulated run with the task "Add a /health endpoint"
    And an agent's turn of the run is under way
    Then the run's tab row ends with "Pause after current step" and "Stop"
    And the header shows no run status, no run KPIs, and no Start, Stop, Pause after current step or Open logs button
