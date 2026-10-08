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

  # #275: the 24/7 tab's "Hours of the day" heatmap says more is more (a busier hour is a stronger
  # green: darker on the light theme, brighter on the dark theme, five levels), its caption reads
  # "(more active hours are stronger)" and a small legend shows the scale from "idle" to "fully
  # active" plus the "no data" style. Assumes the developer wraps the whole "Hours of the day"
  # section (heading with its caption, heatmap, legend) in a new data-testid="an-occ-hours" and
  # creates the two baselines (analytics-hours-heatmap-light, analytics-hours-heatmap-dark) with
  # the change: npm run test:e2e:update -- --grep @issue-275. The demo workspace feeds the meter
  # tonight's roadmap runs only (features/support/app.js does not seed writeDemoOccupancy), so the
  # heatmap renders but is mostly idle; seed writeDemoOccupancy for a busier 30-day picture.
  @issue-275
  Scenario: The hours heatmap says more is more and carries a legend
    Given the app is open
    When I open the "Analytics" tab of Home
    And I open the "24/7" Analytics tab
    Then the hours heatmap says "more active hours are stronger"
    And the heatmap legend reads "idle", "fully active" and "no data"

  @issue-275 @visual
  Scenario: The hours heatmap and its legend in the light theme
    Given the app is open in the light theme
    When I open the "Analytics" tab of Home
    And I open the "24/7" Analytics tab
    Then the hours heatmap looks like the baseline "analytics-hours-heatmap-light.png"

  @issue-275 @visual
  Scenario: The hours heatmap and its legend in the dark theme
    Given the app is open in the dark theme
    When I open the "Analytics" tab of Home
    And I open the "24/7" Analytics tab
    Then the hours heatmap looks like the baseline "analytics-hours-heatmap-dark.png"
