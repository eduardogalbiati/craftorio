Feature: Production errors become intents
  The Monitor group's Errors screen lists the selected project's production errors, grouped, with the
  sources they are read from and the automation that handles them. A new group gets a diagnosis and
  becomes an intent in the Inbox; a fix run starts only when the owner says so, and it stops at the
  gate (docs/work/first-project-onboarding/images/mock-8.jpg).

  # The production errors are simulated: a step writes a log file of JSON lines (one line per error:
  # id, time, status, method, path, message, file, line) in the scenario's scratch folder, then saves it
  # as the demo project's log-file source and polls it through the app's page API (window.api's
  # monitorSaveSource and monitorPoll, the channels monitor:save-source and monitor:poll), as the
  # "Sources…" dialog and the source's timer would. The three lines of the same 500 make one group.
  @issue-634 @smoke
  Scenario: The Monitor group holds Errors and Night watch, and Errors lists a simulated 500 grouped, with its sources and automation
    Given the app is open
    And the demo project's production log records a 500 on "POST /api/checkout" 3 times, from "checkout.js:412"
    And the app watches that log as an error source
    Then the sidebar reads, top to bottom:
      | entry    | items                 |
      | AI       | Agents, Skills, Usage |
      | Monitor  | Errors, Night watch   |
      | Settings |                       |
    When I open "Errors" in the sidebar
    Then the Errors screen describes the production errors of "demo-app"
    And the Errors screen lists 1 error group
    And the error "POST /api/checkout" shows the status "500" and "TypeError: cannot read 'total' of undefined" at "checkout.js:412"
    And the error "POST /api/checkout" counts 3 occurrences
    And the state of the error "POST /api/checkout" reads "new"
    And the error "POST /api/checkout" offers "Diagnose"
    And the Errors screen shows its sources and offers "Sources…"
    And the automation line says "diagnose new groups", "fix runs" and "at most 5 diagnoses a day"

  @issue-634
  Scenario: A simulated 500, diagnosed, becomes an Inbox card with its diagnosis
    Given the app is open
    And the demo project's production log records a 500 on "POST /api/checkout" 3 times, from "checkout.js:412"
    And the app watches that log as an error source
    When I open "Errors" in the sidebar
    And I click "Diagnose" on the error "POST /api/checkout"
    Then the state of the error "POST /api/checkout" reads "intent in Inbox"
    And the error "POST /api/checkout" offers "Propose fix"
    When I open "Inbox" in the sidebar
    And I open the Inbox card "POST /api/checkout"
    Then the opened card's document mentions "checkout.js:412"
    And the opened card's document mentions "TypeError: cannot read 'total' of undefined"

  # Assumes the state badge of an error with a fix run opens that run (its Run screen, where the gate
  # card shows)
  @issue-634
  Scenario: "Propose fix" starts a fix run that stops at the gate
    Given the app is open
    And the demo project's production log records a 500 on "POST /api/checkout" 3 times, from "checkout.js:412"
    And the app watches that log as an error source
    When I open "Errors" in the sidebar
    And I click "Diagnose" on the error "POST /api/checkout"
    Then the state of the error "POST /api/checkout" reads "intent in Inbox"
    When I click "Propose fix" on the error "POST /api/checkout"
    Then the state of the error "POST /api/checkout" reads "fix run · waiting for you"
    When I open the fix run of the error "POST /api/checkout"
    Then a gate card waits for my approval

  # #650 (docs/work/write-doc/spec.md R16, Maintain): an error tied to an item comes in to the item's
  # maintain.md (## Incidents) and its diagnosis opens a new intent, titled after the error group as its
  # Inbox card is, that links back to that maintain.md
  @issue-650
  Scenario: An error tied to an item shows in the item's Maintain stage and opens a new intent that links back
    Given the app is open
    And the demo project's repository has the item "checkout" with an accepted intent
    And the demo project's production log records a 500 on "POST /api/checkout" 3 times, from "checkout.js:412"
    And the app watches that log as an error source
    When I open "Errors" in the sidebar
    And I tie the error "POST /api/checkout" to the item "checkout"
    And I click "Diagnose" on the error "POST /api/checkout"
    Then the state of the error "POST /api/checkout" reads "intent in Inbox"
    When I open "Documents" in the sidebar
    And I open the "Maintain" stage of the item "checkout"
    Then the document's incidents list the error "POST /api/checkout" with a link to its new intent
    When I open "Documents" in the sidebar
    And I open the "Intents" tab of the Documents screen
    Then the intents list shows the intent "POST /api/checkout" as "draft"
    When I open the intent "POST /api/checkout"
    Then the document links back to the maintain of the item "checkout"
