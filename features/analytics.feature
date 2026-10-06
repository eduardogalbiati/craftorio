Feature: Analytics, what the work costs
  Analytics (a tab of Home) keeps its own tabs. The Agents tab (#280) shows what the Oracle, the
  Product Owner and the Supervisor cost, in the screen's date range: one card per agent (cost,
  tokens, turns, sessions), the cost per day stacked by agent, and their sessions with why each one
  started and ended.

  # Assumes the simulated demo workspace has turns of the three agents in the screen's default date
  # range, at least one session of each start reason and one session still open (#280).
  @issue-280 @smoke
  Scenario: The Agents tab shows the Oracle, the Product Owner and the Supervisor with their sessions
    Given the app is open
    When I open the "Analytics" tab of Home
    And I open the "Agents" Analytics tab
    Then the Analytics tab "Agents" is selected
    And the Agents tab shows the cards "Oracle", "Product Owner" and "Supervisor" in this order
    And every agent card shows its cost and its turns
    And the agent sessions table lists sessions newest first
    And the agent sessions show the start reasons "first, compaction, model-change, idle, reset, cleared, one-shot"
    And the start reason "compaction" explains "the context passed"
    And an agent session still open says "open"

  @issue-280
  Scenario: Choosing an agent's card shows only that agent's sessions
    Given the app is open
    When I open the "Analytics" tab of Home
    And I open the "Agents" Analytics tab
    And I choose the "Product Owner" agent card
    Then the agent sessions table shows only "Product Owner" sessions

  @issue-280
  Scenario: The cost per day shows the three agents and remembers the Tokens view
    Given the app is open
    When I open the "Analytics" tab of Home
    And I open the "Agents" Analytics tab
    Then the cost per day legend shows "Oracle", "Product Owner" and "Supervisor"
    When I pick "Tokens" for "Cost per day"
    And I open the "Usage" Analytics tab
    And I open the "Agents" Analytics tab
    Then "Tokens" is selected for "Cost per day"
