Feature: Shape accepted ideas on the Discovery board
  The Discovery board (Plan & Design > Discovery) shows the cards of the private discovery store in
  four columns, Triage, Shape, Define and Ready; a card accepted in the Inbox lands in Triage. A
  card moves by drag and drop or with its "Move to…" menu, and shows its title, type, age and its
  attachment and thread counts. Shape and Define have a WIP limit (5 by default, the header shows
  `n / limit`): a move past it asks to confirm and the column turns amber, it is never blocked
  silently. Bug and hotfix cards run in a fast lane at the top and may skip Shape.

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
