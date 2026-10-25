Feature: The agents' chat
  The Oracle, the Product Owner and the Supervisor talk with the owner through one shared chat
  (packages/ui-kit/agent-chat.js): the text box empties as soon as the owner sends a message, and the
  message shows in the conversation at once, before the answer. The simulated agents answer without
  a model call, so the steps watch the chat from the click and check what it showed in the first frame.

  @issue-274
  Scenario: The Oracle's text box is empty right after Send and the message shows at once
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Oracle
    And I send the message "Which runs failed this week, and why?" to the "Oracle" chat
    Then the "Oracle" chat's text box was empty as soon as I sent it
    And my message "Which runs failed this week, and why?" was in the "Oracle" conversation as soon as I sent it
    And the "Oracle" chat answers
    And the "Oracle" chat's text box is still empty

  @issue-274
  Scenario: The Product Owner's text box is empty right after Ask, in the same chat as the Oracle's
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I send the message "Which issues should go first?" to the "Product Owner" chat
    Then the "Product Owner" chat's text box was empty as soon as I sent it
    And my message "Which issues should go first?" was in the "Product Owner" conversation as soon as I sent it
    And the "Product Owner" chat answers
    And the "Product Owner" chat's text box is still empty

  @issue-274
  Scenario: The Supervisor chat's text box is empty right after Send, in the same chat as the Oracle's
    Given the app is open
    When I open the Supervisor chat
    And I send the message "Why did the last run stop?" to the "Supervisor" chat
    Then the "Supervisor" chat's text box was empty as soon as I sent it
    And my message "Why did the last run stop?" was in the "Supervisor" conversation as soon as I sent it
    And the "Supervisor" chat answers
    And the "Supervisor" chat's text box is still empty
