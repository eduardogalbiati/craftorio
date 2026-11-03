Feature: Shape accepted ideas on the Discovery board
  The Discovery board (Plan & Design > Discovery) shows the cards of the private discovery store in
  four columns, Triage, Shape, Define and Ready; a card accepted in the Inbox lands in Triage. A
  card moves by drag and drop or with its "Move to…" menu, and shows its title, type, age and its
  attachment and thread counts. Shape and Define have a WIP limit (5 by default, the header shows
  `n / limit`): a move past it asks to confirm and the column turns amber, it is never blocked
  silently. Bug and hotfix cards run in a fast lane at the top and may skip Shape.
  Each card has a clarity score (`clarity 72%`); its panel lists the missing points, when and by whom
  it was scored. A card below the bar (85% by default) cannot go to Ready: it offers "Grill me" and
  "Move anyway", which needs a reason and is recorded on the card. The board forecasts the ready
  work as nights of agent work.

  @issue-257
  Scenario: An idea accepted in the Inbox shows in Triage and moves to Shape with "Move to…"
    Given the app is open
    And I accepted the idea "Export runs as CSV" in the Inbox
    When I open "Discovery" in the sidebar
    Then the Discovery column "Triage" shows the card "Export runs as CSV"
    And the Discovery card "Export runs as CSV" shows its title, the type "idea" and its age
    When I move the Discovery card "Export runs as CSV" to "Shape"
    Then the Discovery column "Shape" shows the card "Export runs as CSV"
    And the Discovery column "Triage" does not show the card "Export runs as CSV"
    And the Discovery column "Shape" counts "1 / 5"

  @issue-257
  Scenario: Moving a card into a full Shape column asks to confirm and turns the column amber
    Given the app is open
    And the Discovery column "Shape" holds 5 cards and "One idea too many" waits in Triage
    When I move the Discovery card "One idea too many" to "Shape"
    Then the move asks to confirm going past the WIP limit of "Shape"
    And the Discovery column "Triage" shows the card "One idea too many"
    When I confirm the move past the WIP limit
    Then the Discovery column "Shape" shows the card "One idea too many"
    And the Discovery column "Shape" counts "6 / 5"
    And the Discovery column "Shape" is marked over its WIP limit

  @issue-257
  Scenario: A bug card runs in the fast lane and moves from Triage straight to Define
    Given the app is open
    And I accepted the idea "Crash when a run is stopped" in the Inbox
    When I open "Discovery" in the sidebar
    And I set the type of the Discovery card "Crash when a run is stopped" to "bug"
    Then the fast lane shows the card "Crash when a run is stopped" in "Triage"
    When I move the Discovery card "Crash when a run is stopped" to "Define"
    Then the fast lane shows the card "Crash when a run is stopped" in "Define"
    And the Discovery column "Define" counts "1 / 5"

  @issue-166
  Scenario: A card shows its clarity score and its panel lists what is missing
    Given the app is open
    And the Discovery card "Export runs as CSV" waits in "Shape", scored 72% clear by "Product Owner" on "2026-10-01T09:00:00.000Z", missing:
      | point                        |
      | Who reads the exported file  |
      | Which columns the file holds |
    When I open "Discovery" in the sidebar
    Then the Discovery card "Export runs as CSV" shows the clarity "clarity 72%"
    When I open the Discovery card "Export runs as CSV"
    Then the card's panel lists the missing points "Who reads the exported file" and "Which columns the file holds"
    And the card's panel says it was scored by "Product Owner" on "2026-10-01T09:00:00.000Z"

  @issue-166
  Scenario: A card below the clarity bar is refused in Ready and can be moved anyway with a reason
    Given the app is open
    And the Discovery card "Share a run report" waits in "Define", 60% clear with about 2 h of work
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Share a run report" to "Ready"
    Then the move is refused because the card is below the clarity bar of 85%
    And the Discovery column "Define" shows the card "Share a run report"
    And the Discovery card "Share a run report" offers "Grill me"
    When I choose to move the Discovery card "Share a run report" anyway
    Then moving it anyway needs a reason
    When I give the reason "The owner explained it in the thread" and confirm
    Then the Discovery column "Ready" shows the card "Share a run report"
    And the Discovery card "Share a run report" shows it was moved anyway because "The owner explained it in the thread"

  @issue-166
  Scenario: The board shows how many nights of agent work are ready, counting only clear cards
    Given the app is open
    And these Discovery cards wait in "Define":
      | title                      | clarity | hours |
      | Per-project budget         | 94      | 2     |
      | Keyboard shortcuts         | 85      | 1     |
      | Compare two runs           | 40      | 30    |
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Per-project budget" to "Ready"
    And I move the Discovery card "Keyboard shortcuts" to "Ready"
    And I move the Discovery card "Compare two runs" to "Ready" anyway because "Needed for the demo"
    Then the Discovery column "Ready" shows the card "Compare two runs"
    And the board shows "1 night ready" with "about 3 h of agent work", labelled as an estimate

  @issue-258
  Scenario: A clear Ready card is committed to the backlog and moves to the Committed list
    Given the app is open
    And the Discovery card "Export runs as CSV" waits in "Define", 90% clear with about 3 h of work
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Export runs as CSV" to "Ready"
    And I open the Discovery card "Export runs as CSV"
    And I choose "Commit to the backlog" in the card's panel
    Then the commit dialog lists the proposed issues
    When I confirm the commit with "File the issues"
    Then the Discovery column "Ready" does not show the card "Export runs as CSV"
    And the Committed list shows the card "Export runs as CSV" with its issues' progress "To do"
    And the committed card "Export runs as CSV" cannot be moved back to the board

  @issue-258
  Scenario: A Ready card below the clarity bar cannot be committed and offers Grill me
    Given the app is open
    And the Discovery card "Share a run report" waits in "Define", scored 70% clear by "Product Owner" on "2026-10-01T09:00:00.000Z", missing:
      | point                          |
      | Who receives the report        |
      | Which format the report uses   |
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Share a run report" to "Ready" anyway because "Needed for the demo"
    And I open the Discovery card "Share a run report"
    Then the card's panel shows "Commit to the backlog" disabled
    And the card's panel lists the missing points "Who receives the report" and "Which format the report uses"
    And the card's panel offers "Grill me"

  @issue-258
  Scenario: A backlog issue filed from a committed card shows its badge, which opens the card read-only
    Given the app is open
    And the Discovery card "Per-project budget" waits in "Define", 92% clear with about 2 h of work
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Per-project budget" to "Ready"
    And I commit the Discovery card "Per-project budget" to the backlog
    And I open "Backlog" in the sidebar
    And I open the Board as a list
    Then an issue of the list shows the badge of the Discovery card "Per-project budget"
    When I open the badge of the Discovery card "Per-project budget"
    Then the Discovery card "Per-project budget" opens read-only

  @issue-259
  Scenario: Moving a card into Shape asks to run its automation and, accepted, the card shows it Running
    Given the app is open
    And I accepted the idea "Export runs as CSV" in the Inbox
    When I open "Discovery" in the sidebar
    And I move the Discovery card "Export runs as CSV" to "Shape"
    Then the move proposes running "Write doc" on the card, with a cost estimate
    When I run the proposed automation
    Then the Discovery column "Shape" shows the card "Export runs as CSV"
    And the Discovery card "Export runs as CSV" shows its automation "Running"

  @issue-259
  Scenario: With the Shape automation turned off, moving a card into Shape proposes nothing
    Given the app is open
    And I accepted the idea "Keyboard shortcuts" in the Inbox
    When I open "Discovery" in the sidebar
    And I set the automation of the Discovery column "Shape" to "Off"
    And I move the Discovery card "Keyboard shortcuts" to "Shape"
    Then the Discovery column "Shape" shows the card "Keyboard shortcuts"
    And no automation is proposed
    And the Discovery card "Keyboard shortcuts" shows no automation

  @issue-259
  Scenario: The column automation settings show the Shape automation and its mode
    Given the app is open
    When I open "Discovery" in the sidebar
    And I open the automation settings of the Discovery column "Shape"
    Then the automation settings show the pipeline "Write doc" in mode "Ask me"
    And the automation mode offers "Ask me", "On" and "Off"

  @issue-649
  Scenario: "Write a document" on a card runs the writer and brings the document back to the card
    Given the app is open
    And the Discovery card "Export runs as CSV" waits in "Shape", 70% clear with about 3 h of work
    When I open "Discovery" in the sidebar
    And I open the Discovery card "Export runs as CSV"
    And I choose "Write a document" in the card's panel
    Then the writer drafts the intent with the section "Problem"
    When I send the document to review
    And I choose "Accept intent" at the approval gate
    And I open "Discovery" in the sidebar
    And I open the Discovery card "Export runs as CSV"
    Then the card's panel shows the writer's document among its attachments
    And the card's version history shows a version from the writer
