Feature: Backlog Board and Roadmap
  The demo project's backlog (scripts/screenshot.js demo data): its issues on the Board and its
  roadmap with tonight's runs.

  @issue-222 @issue-207 @smoke
  Scenario: The Backlog Board renders as a kanban with the issues and their labels
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    Then the board shows the column "To do"
    And the board shows the column "Done"
    And the board shows the issue "Add a /health endpoint"
    And the board shows the issue "Crash when the workspace folder is renamed"
    And the board shows the label "bug"
    And the board shows the label "enhancement"

  @issue-222 @issue-193 @issue-194 @smoke
  Scenario: The Roadmap renders its stages and items
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows at least 2 stages
    And the roadmap shows the item "Add a /health endpoint"

  @issue-196
  Scenario: A refused roadmap start offers Retry and Skip, and the roadmap bar points to it
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then a refused item offers Retry and Skip, enabled
    And the roadmap bar says why the start was refused and offers "Show the item"
    When I click "Show the item" in the roadmap bar
    Then the refused item is in view

  @issue-236
  Scenario: Hovering a running item's progress ring shows the run summary in the steps popover
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I hover the progress ring of the roadmap item "Keyboard focus is lost after closing a dialog"
    Then the run's steps popover shows the run summary
    And the progress ring has no native tooltip

  @issue-236
  Scenario: The agent card of a running item stays inside a narrow window
    Given the app is open in a 900x800 window
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I hover the progress ring of the roadmap item "Keyboard focus is lost after closing a dialog"
    And I hover an agent in the run's steps popover
    Then the agent card is shown inside the window

  # The demo roadmap is paused (a refused start); its stage 5 is the unnamed stage with one planned item
  @issue-243
  Scenario: Resume on a paused roadmap asks to resume it, not to start it
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows "paused"
    When I press Resume on the roadmap with Simulated off
    Then the confirm dialog is titled "Resume the roadmap" with a "Resume" button
    When I press Cancel in the confirm dialog
    Then the roadmap bar shows "paused"

  @issue-243
  Scenario: Resume on a stage run on its own asks to resume that stage
    Given the app is open
    And the roadmap was paused while stage 5 ran on its own
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows "paused · stage 5 only"
    When I press Resume on the roadmap with Simulated off
    Then the confirm dialog is titled "Resume stage 5" with a "Resume" button
    And the confirm dialog says the roadmap pauses again when the stage is done
    When I press Cancel in the confirm dialog
    Then the roadmap bar shows "paused · stage 5 only"

  @issue-237
  Scenario: A stage run on its own that finished while paused no longer holds the roadmap
    Given the app is open
    And the roadmap was paused while stage 5 ran on its own
    And every item of stage 5 is done
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar does not show "stage 5 only"
    And the roadmap bar shows "Stage 5 done"
    When I resume the roadmap as a simulation
    Then the roadmap bar does not show "Stage 5 done"
    And the Backlog shows no error "Every item of this stage is done or skipped."
