Feature: The Agents window
  The Oracle, the Product Owner and the Supervisor talk with the owner in one shared chat, in each
  one's drawer or in the Agents window: a second window with a rail of the three agents (an unread
  badge, busy while one answers) and the selected agent's conversation. The window opens from a
  drawer's "Open in a window" button or with Ctrl+Shift+A; a conversation is the same in both places.

  @issue-263 @smoke
  Scenario: "Open in a window" opens the Agents window on the Oracle
    Given the app is open
    When I open the Oracle
    And I open the Agents window from the "Oracle" drawer
    Then the Agents window opens
    And the Agents window's rail lists "Oracle", "Product Owner" and "Supervisor" in that order
    And the Agents window shows the "Oracle" conversation

  @issue-263
  Scenario: A message sent from the Agents window is the drawer's conversation too
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I open the Agents window with Ctrl+Shift+A
    And I pick "Product Owner" in the Agents window
    And I send the message "Which issues should go first?" in the Agents window
    Then the main window's "Product Owner" conversation shows "Which issues should go first?"
    And the "Product Owner" chat answers
    And the Agents window's conversation answers

  # The Agents window on the Oracle, in both themes (features/__screenshots__, created on purpose with
  # npm run test:e2e:update -- --grep @visual); the window has the suite's fixed size
  @issue-263 @visual
  Scenario Outline: The Agents window on the Oracle looks like its baseline in the <theme> theme
    Given the app is open in the <theme> theme
    When I open the Oracle
    And I open the Agents window from the "Oracle" drawer
    Then the Agents window shows the "Oracle" conversation
    And the Agents window looks like the baseline "agents-window-oracle-<theme>.png"

    Examples:
      | theme |
      | light |
      | dark  |
