Feature: Agent inboxes
  The owner sees, in the Product Owner's drawer and in the Supervisor chat, every request another
  agent (the Oracle) sent to them, marked with its origin, with its result and its cost: US$ 0 for
  the mechanical requests (no model call). The #240 scenarios send the request straight to the
  owner's inbox through the app's service; the #241 ones send it through the Oracle's own tool
  (request_agent), which routes it to the owner.

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

  # #241: the Oracle no longer changes anything itself: its tool request_agent({ to, kind, params,
  # reason }) routes each change to the agent that owns the area. A step calls it the way the Oracle's
  # tool does, through the app's service: window.api.oracleRequestAgent (channel oracle:requestAgent,
  # new), in simulation. A mechanical kind runs at once in the owner's conversation; a kind that needs
  # the owner's click (a run retry costs money) is a card with Do it / Dismiss in the owner's chat,
  # never in the Oracle's. A human gate is never answered.
  @issue-241
  Scenario: The Oracle routes adding an issue to the roadmap to the Product Owner, which does it
    Given the app is open
    And the backlog has the open issues "Export the run log as CSV" and "Show the run's branch in the header"
    When the Oracle sends the Product Owner a request to add the issue "Export the run log as CSV" to the roadmap because "The owner wants it in tonight's runs"
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows the item "Export the run log as CSV"
    When I open the Product Owner
    Then the Product Owner's drawer shows a request marked "Request from the Oracle at" with its time
    And the request in the Product Owner's drawer shows "The owner wants it in tonight's runs"
    And the request in the Product Owner's drawer shows its result naming the issue "Export the run log as CSV"
    And the request in the Product Owner's drawer shows the cost "US$ 0"
    When I open the Oracle
    Then the Oracle's chat shows its request "roadmap.add" sent to the "Product Owner"
    And the Oracle's chat offers no "Do it" button

  @issue-241
  Scenario: A run retry the Oracle routes to the Supervisor waits for the owner's click in the Supervisor chat, not in the Oracle's
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When the Oracle sends the Supervisor a request to retry the demo run "res00225" because "It stopped on a flaky test"
    And I open the Supervisor chat
    Then the Supervisor chat shows a request marked "Request from the Oracle at" with its time
    And the request in the Supervisor chat shows "It stopped on a flaky test"
    And the request in the Supervisor chat offers "Do it" and "Dismiss"
    When I open the Oracle
    Then the Oracle's chat shows its request "run.retry" sent to the "Supervisor"
    And the Oracle's chat offers no "Do it" button

  @issue-241 @quarantine
  Scenario: The Oracle cannot get a human gate answered through the Supervisor
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    And a gate card waits for my approval
    And the Oracle sends the Supervisor a request to approve the gate of the run in view because "The plan looks fine"
    Then the Oracle's request was refused, naming the human gate
    And a gate card waits for my approval
