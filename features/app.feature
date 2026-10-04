@issue-222
Feature: The app opens
  The packaged app's first screen, on a fresh demo workspace in simulation.

  @smoke
  Scenario: The app opens with its sidebar and nothing running
    Given the app is open
    Then the sidebar offers "Home"
    And the sidebar offers "Backlog"
    And the sidebar offers "Runs"
    And the sidebar offers "Settings"
    And the run status shows "idle"
    And the Start a workflow button is enabled
