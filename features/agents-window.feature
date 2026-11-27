Feature: The Agents window
  The Oracle, the Product Owner and the Supervisor talk with the owner in one shared chat, in each
  one's drawer or in the Agents window: a second window with a rail of the three agents (an unread
  badge, busy while one answers) and the selected agent's conversation. The window opens from a
  drawer's "Open in a window" button or with Ctrl+Shift+A; a conversation is the same in both places.

  @issue-263
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

  # #77: the header shows the model the Oracle's service runs on once it answers, nothing before, never
  # another one (no fallback). The simulated Oracle runs on its default model, claude-opus-5-5 (its status
  # badge reads "Opus 5.5"). Assumes data-testid="agents-window-model" (new) on the header's model.
  @issue-77
  Scenario: The Agents window's header shows the Oracle's model
    Given the app is open
    When I open the Agents window with Ctrl+Shift+A
    And I pick "Oracle" in the Agents window
    Then the Agents window's header shows the model "claude-opus-5-5"
    And the Agents window's header shows the model the Oracle's status shows

  @issue-77
  Scenario: The Agents window's header never shows a model the Oracle does not use
    Given the app is open
    When I open the Oracle
    And I open the Agents window from the "Oracle" drawer
    Then the Agents window's header shows no model but the Oracle's
    When I send the message "Which runs failed this week, and why?" in the Agents window
    Then the Agents window's conversation answers
    And the Agents window's header shows no model but the Oracle's

  # #76: the listeners of run:event are the app's own, made once at its start: a window or a screen that opens adds
  # none (features/support/electron-main.js counts them).
  @issue-76
  Scenario: Opening and closing the Agents window, then a project's page, leaves no run listener behind
    Given the app is open
    When I open "Projects" in the sidebar
    And I note how many listeners follow the runs
    And I open the Agents window with Ctrl+Shift+A
    Then the Agents window opens
    When I close the Agents window
    And I open the project "demo-app" from the Projects screen
    Then the project page of "demo-app" is open
    And as many listeners follow the runs as I noted

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
