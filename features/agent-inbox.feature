Feature: Agent inboxes
  The owner sees, in the Product Owner's drawer and in the Supervisor chat, every request another
  agent (the Oracle) sent to them, marked with its origin, with its result and its cost: US$ 0 for
  the mechanical requests (no model call). The Oracle's tool that sends them is not built yet, so a
  Given sends the request through the app's service, as the Oracle will.

  @issue-240
  Scenario: The Product Owner's drawer shows the Oracle's request to add an issue to the roadmap, and its result
    Given the app is open
    And the backlog has the open issues "Export the run log as CSV" and "Show the run's branch in the header"
    And the Oracle asked the Product Owner to add the issue "Export the run log as CSV" to the roadmap because "The owner wants it in tonight's runs"
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    Then the Product Owner's drawer shows a request marked "Request from the Oracle at" with its time
    And the request in the Product Owner's drawer shows "The owner wants it in tonight's runs"
    And the request in the Product Owner's drawer shows its result naming the issue "Export the run log as CSV"
    And the request in the Product Owner's drawer shows the cost "US$ 0"

  @issue-240
  Scenario: The Supervisor chat shows the Oracle's request to restart the dispatch, and its result
    Given the app is open
    And the Oracle asked the Supervisor to restart the dispatch because "The roadmap stopped after a refused start"
    When I open the Supervisor chat
    Then the Supervisor chat shows a request marked "Request from the Oracle at" with its time
    And the request in the Supervisor chat shows "The roadmap stopped after a refused start"
    And the request in the Supervisor chat shows the cost "US$ 0"

  @issue-240
  Scenario: A failed request to the Supervisor shows its error in the Supervisor chat
    Given the app is open
    And the Oracle asked the Supervisor to stop the run "20260101-000000-nosuchrun" because "It looks stuck"
    And the request failed
    When I open the Supervisor chat
    Then the Supervisor chat shows a request marked "Request from the Oracle at" with its time
    And the request in the Supervisor chat shows "It looks stuck"
    And the request in the Supervisor chat shows that it failed, naming the run "20260101-000000-nosuchrun"
