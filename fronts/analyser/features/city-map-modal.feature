Feature: "Show on the map" opens the project city in a modal over the current screen
  Every "Show on the map" (an issue of the Backlog, a roadmap stage, a release, a run replay) opens the
  project's City view full screen in a modal over the screen it came from, instead of moving to
  Projects › <project> › Architecture (#430). Close and Esc close the modal and leave the screen as it
  was (same view, same filters, same stage). There is one modal at a time; it offers an "Open in
  Projects" link to the project's City tab (#730). The impact or stage card opens at the top of the
  city's left column, where the notes are, not over the middle of the city; the city has no "Arcs"
  note; with no building changed by two items of a stage the conflicts block is one muted line, not a
  red box (#428). The project is the seeded "billing-service" (src/billing.js in the district Billing,
  tools/export.py in Export) of fronts/analyser/features/steps/architecture.steps.js; the release project "shop" is the
  tagged repository of fronts/analyser/features/steps/release-city.steps.js.

  @issue-430
  Scenario: "Show the stage on the map" opens the city in a modal over the Roadmap, and Close leaves the Roadmap as it was
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "src/billing.js" and "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    And I click "Show the stage on the map" on the roadmap stage "Billing fixes"
    Then the city opens in a modal over the "Roadmap" screen
    And the city modal shows the stage card marking "src/billing.js" as a conflict
    When I close the city modal
    Then no city modal is open
    And the Roadmap still shows the stage "Billing fixes"
    And the project page is not shown

  @issue-430
  Scenario: Esc closes the city modal opened from a Backlog issue, and the Backlog stays in its list view
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city opens in a modal over the "Backlog" screen
    And the city modal shows the impact card of the issue "Change the discount rule"
    When I press Escape on the city
    Then no city modal is open
    And the Backlog list still shows the issue "Change the discount rule"
    And the project page is not shown

  @issue-430
  Scenario: The city modal of a release offers "Open in Projects", which leads to the project's City tab
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    Then the city opens in a modal over the "Releases" screen
    And the city modal offers the link "Open in Projects"
    When I follow the city modal's "Open in Projects" link
    Then no city modal is open
    And the project page of "shop" is open
    And the project tab "City" is selected

  @issue-428
  Scenario: The stage card opens at the top of the city's left column and the city has no "Arcs" note
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "src/billing.js" and "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    And I click "Show the stage on the map" on the roadmap stage "Billing fixes"
    Then the city modal shows the stage card marking "src/billing.js" as a conflict
    And the stage card sits at the top of the city's left column, not over the middle of the city
    And the city shows no "Arcs" note

  @issue-428
  Scenario: With no building changed by two items, the stage card's conflicts are one muted line, not a red box
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    And I click "Show the stage on the map" on the roadmap stage "Billing fixes"
    Then the stage card's conflicts are one muted line listing no building
    And the stage card's conflicts are not drawn in red
