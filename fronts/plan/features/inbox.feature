Feature: Capture and triage ideas in a private Inbox
  The Inbox (Plan & Design > Inbox) keeps ideas in a private discovery store, not in the project's
  backlog. A quick capture box (a title and a text) creates an idea card at the top of the Inbox
  list, with its author and age; opening a card shows its document, attachments and thread, and its
  triage actions: Accept (the card moves to Discovery > Triage), Merge into another card, Discard
  (archived with a reason). Enter captures, Esc closes an open card. Import takes a .md/.txt document
  (picked, dropped or pasted), splits it into items and previews them; nothing is written until the
  owner confirms, then each item becomes an idea card, in the document's order.

  @issue-256
  Scenario: Capturing an idea from the empty Inbox puts its card at the top of the list
    Given the app is open
    When I open "Inbox" in the sidebar
    Then the Inbox shows its empty state
    When I capture the idea "Export runs as CSV" with the text "The owner wants a spreadsheet of the night's runs"
    Then the Inbox does not show its empty state
    And the Inbox shows the card "Export runs as CSV" with its author and age

  @issue-256
  Scenario: Accepting an opened card moves it out of the Inbox; Esc closes a card without a change
    Given the app is open
    And I captured the idea "Dark mode for the run log" in the Inbox
    When I open the Inbox card "Dark mode for the run log"
    Then the opened card shows its document "Dark mode for the run log"
    When I press Escape
    Then no Inbox card is open
    And the Inbox shows the card "Dark mode for the run log" with its author and age
    When I open the Inbox card "Dark mode for the run log"
    And I accept the opened card
    Then the Inbox does not show the card "Dark mode for the run log"

  @issue-256
  Scenario: Discarding a card with a reason archives it and leaves the Inbox empty
    Given the app is open
    And I captured the idea "Rewrite the engine in Rust" in the Inbox
    When I open the Inbox card "Rewrite the engine in Rust"
    And I discard the opened card with the reason "Out of scope for this year"
    Then the Inbox does not show the card "Rewrite the engine in Rust"
    And the Inbox shows its empty state

  @issue-322
  Scenario: Importing a backlog document previews its items, then creates one card per item in the document's order
    Given the app is open
    When I open "Inbox" in the sidebar
    And I import into the Inbox the file "BACKLOG.md" with the content:
      """
      # Export runs as CSV
      The owner wants a spreadsheet of the night's runs.
      - [ ] The CSV has one row per run
      - [ ] The CSV opens in a spreadsheet app

      # Dark mode for the run log
      The run log is hard to read at night.

      # Retry a failed step from its card
      One click retries the step with the same inputs.
      """
    Then the import preview lists 3 items
    And the import preview item "Export runs as CSV" shows 2 criteria
    And the Inbox shows its empty state
    When I confirm the import
    Then the import preview is closed
    And the Inbox shows these cards in this order:
      | Export runs as CSV                 |
      | Dark mode for the run log          |
      | Retry a failed step from its card  |

  @issue-322
  Scenario: Cancelling the import preview leaves the Inbox unchanged
    Given the app is open
    When I open "Inbox" in the sidebar
    And I import into the Inbox the file "BACKLOG.md" with the content:
      """
      # Export runs as CSV
      # Dark mode for the run log
      """
    Then the import preview lists 2 items
    When I cancel the import
    Then the import preview is closed
    And the Inbox shows its empty state

  @issue-322
  Scenario: Importing an empty file says the document is empty and offers nothing to create
    Given the app is open
    When I open "Inbox" in the sidebar
    And I import into the Inbox the empty file "BACKLOG.md"
    Then the import says the document is empty
    And the import offers no item to create
    And the Inbox shows its empty state
