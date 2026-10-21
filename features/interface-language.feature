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

  # #423: the agent chats' live turn (src/renderer/live-turn.js) follows the interface language. Slow
  # simulated turns (#368) keep the simulated Product Owner's turn live (thinking, then three steps of
  # about 2.5 s) while its activity line, step count and Stop button are read; the expected texts are
  # the catalogs' live_turn.* entries (features/steps/interface-language.steps.js). The Product Owner's
  # button and drawer keep the name "Product Owner" in Portuguese.
  @issue-423
  Scenario: With Português (Brasil) as the interface language, the Product Owner's live turn is in Portuguese
    Given the app is open with slow simulated turns
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Product Owner
    And I ask the Product Owner "Quais issues devem ir primeiro?"
    Then the Product Owner's live turn shows its activity line in "Português (Brasil)"
    And the Product Owner's live turn shows its step count in "Português (Brasil)"
    And the Product Owner's live turn offers its Stop button in "Português (Brasil)"

  @issue-423
  Scenario: In English the Product Owner's live turn still reads in English
    Given the app is open with slow simulated turns
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I ask the Product Owner "Which issues should go first?"
    Then the Product Owner's live turn shows its activity line in "English"
    And the Product Owner's live turn shows its step count in "English"
    And the Product Owner's live turn offers its Stop button in "English"
