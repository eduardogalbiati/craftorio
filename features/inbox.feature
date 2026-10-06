Feature: Capture and triage ideas in a private Inbox
  The Inbox (Plan & Design > Inbox) keeps ideas in a private discovery store, not in the project's
  backlog. A quick capture box (a title and a text) creates an idea card at the top of the Inbox
  list, with its author and age; opening a card shows its document, attachments and thread, and its
  triage actions: Accept (the card moves to Discovery > Triage), Merge into another card, Discard
  (archived with a reason). Enter captures, Esc closes an open card.

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
