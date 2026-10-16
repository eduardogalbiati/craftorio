Feature: Menu by the flow
  The sidebar follows the work's flow: Home on top, then Plan & Design, Code & Build, Workflows and
  AI, each a titled group that collapses (and stays collapsed), then Night watch and Settings. The
  header holds the app-wide project, the Oracle and the notifications bell. The Supervisor has no
  screen nor header button: its conversation is a drawer of the Workflows screen.

  @issue-254 @smoke
  Scenario: The sidebar groups the screens in the order of the flow, and a collapsed group stays collapsed
    Given the app is open
    Then "Home" is the top entry of the sidebar
    And the sidebar reads, top to bottom:
      | entry         | items                                   |
      | Home          |                                         |
      | Plan & Design | Write & Review, AI Arena                |
      | Code & Build  | Backlog, Roadmap, Sessions              |
      | Workflows     | Definitions, Runs, Builder, Pipelines   |
      | AI            | Agents, Skills, Usage                   |
      | Night watch   |                                         |
      | Settings      |                                         |
    And the sidebar does not offer "Dashboard"
    And the sidebar does not offer "Supervisor"
    When I open "Pipelines" in the sidebar
    Then the Workflows screen is on its "Pipelines" tab
    When I collapse the "Workflows" menu group
    And I reload the app
    Then the "Workflows" menu group is collapsed, hiding "Runs"

  # Assumes a second project can be added to the demo workspace (a project with its own synced backlog)
  @issue-254
  Scenario: Choosing a project in the header shows that project's Backlog at once
    Given the app is open
    And the workspace has a second project "billing-service" whose backlog has the open issue "Refund a failed payment"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    Then the header shows the project "demo-app"
    And the list shows the issue "Add a /health endpoint"
    When I choose the project "billing-service" in the header
    Then the list shows the issue "Refund a failed payment"
    And the list does not show the issue "Add a /health endpoint"

  @issue-254
  Scenario: The header holds the Oracle and the notifications bell
    Given the app is open
    Then the header offers "Oracle"
    And the header offers "Notifications"
    And the sidebar does not offer "Notifications"
    When I open the notifications from the header bell
    Then the notification centre is open

  @issue-264
  Scenario: No screen shows a Supervisor button in the header
    Given the app is open
    Then no screen of the menu shows a "Supervisor" button in the header

  @issue-264
  Scenario: The Workflows screen opens the Supervisor chat as a drawer on the right
    Given the app is open
    And the Oracle asked the Supervisor to restart the dispatch because "The roadmap stopped after a refused start"
    When I open "Definitions" in the sidebar
    And I open the Supervisor from the Workflows screen
    Then the Supervisor chat opens as a drawer on the right
    And the Supervisor chat shows a request marked "Request from the Oracle at" with its time
    And the Workflows screen is on its "Definitions" tab

  # #409: a round button in the bottom-right corner on every Workflows tab (like the Backlog's Product
  # Owner) replaces the header's "◆ Supervisor" button
  @issue-409
  Scenario: The Supervisor's round button opens its drawer from the Definitions and Builder tabs
    Given the app is open
    When I open "Definitions" in the sidebar
    Then the Workflows screen shows the Supervisor's round button in its bottom-right corner
    And the Workflows screen has no other Supervisor button
    When I open the Supervisor from its round button
    Then the Supervisor chat opens as a drawer on the right
    When I close the Supervisor chat
    And I open "Builder" in the sidebar
    Then the Workflows screen is on its "Builder" tab
    And the Workflows screen shows the Supervisor's round button in its bottom-right corner
    When I open the Supervisor from its round button
    Then the Supervisor chat opens as a drawer on the right
