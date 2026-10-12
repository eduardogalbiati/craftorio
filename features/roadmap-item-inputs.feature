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

  # ---- #287: saving an Edit form after the roadmap changed elsewhere ----------------------------------
  # The roadmap file (backlog/<project>.roadmap.json) is edited outside the app while the Edit form is
  # open, as the Oracle, the Product Owner, another window or a script would. Save merges the form's
  # inputs into the item as it is now; an edit that cannot apply (its stage is gone) saves nothing.

  @issue-287
  Scenario: Saving an item's Edit form keeps an issue appended to that item elsewhere
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    And I pick "High" for "Developer effort"
    And the issue "Appended from elsewhere" is added to the roadmap item "Planned item 1001" outside the app
    And I save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap item "Planned item 1001" shows the input "Developer effort: High"
    And the roadmap item "Planned item 1001" shows "Appended from elsewhere"
    And the issues footer of the roadmap item "Planned item 1001" counts "2 issues"
    And the roadmap file still lists the issue "Appended from elsewhere" on the item "Planned item 1001"

  @issue-287
  Scenario: An open Edit form says when the roadmap changed elsewhere, its values kept
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    And I pick "High" for "Developer effort"
    And the issue "Appended from elsewhere" is added to the roadmap item "Planned item 1001" outside the app
    Then the Edit form of the roadmap item "Planned item 1001" says "the roadmap changed: 1 item updated elsewhere"
    And "High" is selected for "Developer effort"

  @issue-287
  Scenario: An edit whose stage was removed elsewhere is not saved, the screen says why and reloads
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    And I pick "High" for "Developer effort"
    And the stage of the roadmap item "Planned item 1001" is removed outside the app
    And I try to save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap says the edit was not saved because its stage was removed
    And the roadmap no longer shows the item "Planned item 1001"
    And the roadmap file has no item "Planned item 1001"
    And "High" is selected for "Developer effort"
