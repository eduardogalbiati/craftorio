Feature: The conflict map shows the owner which files and lines most runs edit, next to the roadmap
  The Product Owner's conflict map is read from the workspace (backlog/<projectId>.conflict-map.json):
  a saved map is shown as saved; without one it is built from the runs' commits, and simulated runs
  never count, so the demo workspace has no map of its own. The scenarios save a map into the demo
  workspace before the Roadmap opens.

  @issue-150
  Scenario: The hottest file comes first with its run count, and a click shows the runs behind it
    Given the app is open
    And the project has a saved conflict map of 20 runs where "src/renderer/app.js" was changed by 14 runs and "src/engine/runner.js" by 3
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the Conflict map lists "src/renderer/app.js" first, changed by 14 runs
    And the Conflict map lists "src/engine/runner.js", changed by 3 runs
    When I click "src/renderer/app.js" in the Conflict map
    Then the Conflict map shows the 14 runs that changed "src/renderer/app.js"

  @issue-150
  Scenario: A line many runs edit is listed with its file, line number and run count
    Given the app is open
    And the project has a saved conflict map of 20 runs where "src/renderer/app.js" was changed by 14 runs and "src/engine/runner.js" by 3
    And the saved conflict map has line 12 of "src/service/index.js" changed by 5 runs
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the Conflict map lists the line "src/service/index.js:12", changed by 5 runs

  @issue-150
  Scenario: A project without a conflict map yet shows the empty state
    Given the app is open
    And the project has no saved conflict map
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the Conflict map shows its empty state, with no hot file or line
