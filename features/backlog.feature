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
