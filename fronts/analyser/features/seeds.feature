Feature: Analysis seeds give the owner ready-made analyses of a project, re-runnable and free once turned into a tool
  The Health tab of a project's page has a Seeds section (#360, under Architecture before #730): one row per bundled seed
  (churn-complexity, dependency-map, quality-gate-report, pipeline-anatomy) with its status (Never run,
  Running, Stale with the commits since, Tool available and free, or the error), Run, Open result,
  History and "Make it a tool". Open result shows the saved page in a sandboxed frame with no network.
  The app runs in simulation: a seed run saves a simulated result at no cost, and "Make it a tool"
  files nothing (a preview of the issue).

  @issue-360
  Scenario: Running a seed for the first time saves a result the owner can open
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the Seeds section lists the seed "churn-complexity" as "Never run"
    When I run the seed "churn-complexity"
    Then the status of the seed "churn-complexity" no longer says "Never run"
    When I open the result of the seed "churn-complexity"
    Then the seed result is shown in a sandboxed frame

  @issue-360
  Scenario: A seed with a recorded tool shows the tool is available
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    And the project "billing-service" has the tool "node tools/churn.js" recorded for the seed "churn-complexity"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the Seeds section lists the seed "churn-complexity" as "Tool available"

  @issue-360
  Scenario: Making a seed a tool in simulation only previews the issue
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    And I click "Make it a tool" on the seed "churn-complexity"
    Then the app says the tool issue for "churn-complexity" is only a preview
