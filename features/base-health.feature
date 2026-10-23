Feature: Main stays green: the base check
  The base check (#405) runs the project's whole suite on the base after a merge. It takes the
  machine-wide suite slot first (#527): while another run's suite holds it, the check waits, and the
  Roadmap says so instead of looking stuck. The demo project's folder is made a git repository on
  "main"; the other run's suite slot is held in a temp folder of the scenario, never the machine's.

  # ---- #527: the base check waits for the machine's suite slot ------------------------------------------

  @issue-527
  Scenario: The Roadmap shows the base check waiting for the suite slot while another run holds it
    Given the app is open while another run holds the machine's suite slot
    And the demo project is a git repository on the base "main"
    When a merge into the base "main" starts the base check
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's base check reads "waiting for the suite slot"
    When the other run frees the suite slot
    Then the roadmap's base check is no longer waiting
