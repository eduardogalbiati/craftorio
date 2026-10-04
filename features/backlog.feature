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
