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

  # #308: a turn's tokens include its sub-agents' model calls. Analytics › Run's "Tokens per agent"
  # bar of an agent (new data-testid="an-agent-tokens", like an-agent-cost) shows its total with
  # them, its $/M, and "of which sub-agents: n calls, m tokens" (new data-testid="an-agent-subagents")
  # only when the agent's turns started sub-agents.
  # Assumes the demo workspace (scripts/screenshot.js, demoRoadmapRuns) gets a finished run whose id
  # ends in "-run00308": its developer's turns started 3 sub-agents, recorded with the new fields.
  @issue-308
  Scenario: An agent whose turns started sub-agents shows their calls and tokens
    Given the app is open
    When I open "Home" in the sidebar
    And I open the "Analytics" tab of Home
    And I open the "Run" Analytics tab
    And I pick the run "run00308" in Analytics
    Then the tokens of the agent "developer" in Analytics show its total and its cost per million tokens
    And the tokens of the agent "developer" in Analytics show 3 sub-agent calls and their tokens

  # "-run00009" is tonight's merged demo run, recorded without the new sub-agent fields (a past run)
  @issue-308
  Scenario: A run without sub-agents shows its tokens and no sub-agent line
    Given the app is open
    When I open "Home" in the sidebar
    And I open the "Analytics" tab of Home
    And I open the "Run" Analytics tab
    And I pick the run "run00009" in Analytics
    Then the tokens of the agent "developer" in Analytics show its total and its cost per million tokens
    And the tokens of the agent "developer" in Analytics show no sub-agent line

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

  # A guard for a future light theme: today the main renderer has a single dark theme (only the 3D
  # view has a light one), so this baseline is byte-identical to the dark one. It starts differing
  # the day a light theme reaches Analytics, which is when the light-specific greens get checked.
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
