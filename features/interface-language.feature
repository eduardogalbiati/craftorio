Feature: Every screen in the interface language
  Settings › General › Language › Interface (#329) chooses the language of the app's screens. With
  #330 every screen and shared piece (Backlog, Runs and its run list, status badges, …) follows it,
  not only the sidebar and Settings, and a change re-renders what is open, without a restart.

  # The steps name a label by its English text and read its expected text in the chosen language
  # from the app's catalogs (src/shared/i18n/en.json and pt-BR.json), so they do not depend on the
  # Portuguese wording. Portuguese sidebar entries already in the catalog: Settings → "Configurações",
  # Runs → "Execuções"; Backlog stays "Backlog". Assumes the demo workspace's failed run "-old00233"
  # (features/workflow-runs.feature).

  @issue-330
  Scenario: With Português (Brasil) as the interface language, the Backlog shows no English label
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    Then the Backlog screen is shown
    And the screen's "Sync, New issue…, List, Kanban, Labels" buttons read in "Português (Brasil)"
    And the screen's "Board, Epics" tabs read in "Português (Brasil)"

  @issue-330
  Scenario: With Português (Brasil) as the interface language, the run list and its status badges are translated
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Execuções" in the sidebar
    Then the screen's "Definitions, Runs, Pipelines" tabs read in "Português (Brasil)"
    And the screen's "All, Running, Success, Failed" buttons read in "Português (Brasil)"
    And the run list row of "old00233" shows the status "Failed" in "Português (Brasil)"

  @issue-330
  Scenario: Switching the interface back to English restores a screen's English labels without a restart
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    Then the screen's "Sync" button reads in "Português (Brasil)"
    When I open "Configurações" in the sidebar
    And I choose "English" as the "Interface" language
    And I open "Backlog" in the sidebar
    Then the screen's "Sync, New issue…" buttons read in "English"
    And the screen's "Board, Epics" tabs read in "English"
