Feature: Settings
  Settings save as soon as a choice is made, and the choice survives a reload.

  @issue-222 @issue-195 @smoke
  Scenario: Settings saves the default development workflow
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "software-development.yaml" as the default development workflow
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the default development workflow is "software-development.yaml"
