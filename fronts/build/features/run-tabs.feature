@issue-410
Feature: The Run screen's tabs
  Chat, Details and 3D are tabs on the Run screen's first row, above the fail, pause and gate
  banners, and the run chat shows the same row in the same place, so switching between Chat and
  Details never moves it. The run's actions sit on that row on the right; a live run without a chain
  offers "+ When it finishes…" there, and no "Chain" banner is shown. Details' right panel opens on
  its Artifacts tab (Artifacts | Session | Events).

  # Slow simulated turns (#368) keep the run live (status running) while the row is read
  Scenario: A live run opens on Details with the tab row first and the run's actions on it
    Given the app is open with slow simulated turns
    When I start a simulated run with the task "Add a /health endpoint"
    And an agent's turn of the run is under way
    Then the Run screen's first row is the tab row "Chat", "Details" and "3D"
    And the "Details" tab of the run is selected
    And the run's tab row offers "Ask the supervisor", "Watch" and "Open in Analytics" on the right of the tabs
    And the run's tab row offers "+ When it finishes…"
    And the Run screen shows no "Chain" banner
    And the run details' side tabs read "Artifacts", "Session" and "Events", with "Artifacts" open

  Scenario: Switching between Chat and Details keeps the tab row in the same place
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    When I note where the run's tab row is
    And I open the run's "Chat" tab
    Then the "Chat" tab of the run is selected
    And the Run screen's first row is the tab row "Chat", "Details" and "3D"
    And the run's tab row has not moved
    When I open the run's "Details" tab
    Then the "Details" tab of the run is selected
    And the run's tab row has not moved

  # Without WebGL or the 3D bundle the 3D tab is disabled and says why: the step accepts that instead
  Scenario: The 3D tab opens the 3D view, and closing it returns to the tab it came from
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    When I open the run's "Chat" tab
    And I open the run's 3D tab, or it says why it is unavailable
    And I close the run's 3D view if it opened
    Then the "Chat" tab of the run is selected
    And the Run screen's first row is the tab row "Chat", "Details" and "3D"
