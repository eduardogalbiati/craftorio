Feature: The Refactor tab, the project's refactor proposals prioritized and added to the roadmap
  A project's Refactor tab lists its refactor proposals (the Architecture findings sent to Refactor,
  or written by the owner). "Ask the Product Owner to prioritize" gives each one a rank, a one-line
  reason and a complexity from 1 to 5. A proposal can be filed as an issue, added to the roadmap now,
  or dismissed with a reason (kept under the "Dismissed" filter). The cadence switch "Add a refactor
  to the roadmap every X runs" (off by default, X from 3 to 50) counts the real runs until the next
  one, and says "Nothing ready to add: prioritize or file a proposal" when no proposal is ready.
  In simulation the Product Owner's answer is the simulated one.

  @issue-357
  Scenario: The Product Owner ranks the proposals sent from the Architecture tab
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I send all the findings to Refactor
    And I open the "Refactor" project tab
    Then the project tab "Refactor" is selected
    And the Refactor tab lists 4 proposals
    When I ask the Product Owner to prioritize the refactor proposals
    Then the Refactor tab lists 4 proposals ranked 1 to 4, each with a reason and a complexity from 1 to 5

  @issue-357
  Scenario: A dismissed proposal leaves the list and keeps its reason under the Dismissed filter
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I send all the findings to Refactor
    And I open the "Refactor" project tab
    And I dismiss the refactor proposal "Export constants shout" with the reason "Generated code, never edited by hand"
    Then the Refactor tab lists 3 proposals
    And the Refactor tab does not list the proposal "Export constants shout"
    When I show the dismissed refactor proposals
    Then the dismissed proposal "Export constants shout" shows the reason "Generated code, never edited by hand"

  @issue-357
  Scenario: The cadence counts the runs until the next refactor and says when nothing is ready
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I send all the findings to Refactor
    And I open the "Refactor" project tab
    Then the refactor cadence is off
    When I turn on the refactor cadence every 10 runs
    Then the refactor cadence says "next in 10 runs"
    And the Refactor tab says nothing is ready to add
