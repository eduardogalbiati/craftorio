Feature: Roadmap item inputs in Edit and on the card
  The demo project's roadmap (scripts/screenshot.js demoRoadmap) with a new stage of planned items:
  an item's Edit form draws its workflow's inputs, and its card shows the ones that are set.

  # ---- #286: the developer's effort in a roadmap item's Edit and on its card -------------------------
  # A planned item of a new stage is switched to the ai-development-local-hero workflow; Save writes
  # every field of the form, so an untouched effort is saved as 'default' and left off the card.

  @issue-286
  Scenario: A roadmap item's developer effort set to High in Edit shows on its card
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    Then the field "Developer effort" comes right after "Developer model"
    And "Default" is selected for "Developer effort"
    When I pick "High" for "Developer effort"
    And I save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap item "Planned item 1001" shows the input "Developer effort: High"

  @issue-286
  Scenario: A roadmap item left at the default developer effort shows no effort on its card
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    And I save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap item "Planned item 1001" shows no "Developer effort" input
