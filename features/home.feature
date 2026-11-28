Feature: Home, one overview of the flow
  Home is the first screen: an Overview tab with the flow from Inbox to Release (each stage's count
  opens its screen, filtered; a stage without a screen is hidden), what needs the owner (waiting
  gates, failed roadmap items, discovery cards) with one click to act, and the last 24 hours' summary; and an
  Analytics tab that keeps its own tabs. Analytics is no longer a menu entry. The Oracle's panel
  stays docked on Home.

  # Assumes the demo workspace's roadmap (a run waiting at a human gate, a run that failed in its
  # tests) shows up in "What needs you" as a gate and a failed roadmap item.
  @issue-255 @smoke
  Scenario: Home opens on the flow overview with the stage counts and what needs me
    Given the app is open
    Then Home is on its "Overview" tab
    And the flow strip shows its stages in the order of the flow, each with a count
    And the flow strip shows the stages "Backlog To do" and "Running"
    And "What needs you" lists a waiting gate with its age
    And "What needs you" lists a failed roadmap item
    And every item of "What needs you" offers one action
    And Home shows the last 24 hours' summary
    When I open the Oracle
    Then Home is on its "Overview" tab

  @issue-255
  Scenario: Analytics is a tab of Home with its own tabs, no longer in the menu
    Given the app is open
    Then the sidebar does not offer "Analytics"
    When I open the "Analytics" tab of Home
    Then Home is on its "Analytics" tab
    And the Analytics tabs offer "Usage", "Performance", "Run" and "24/7"
    When I open the "Run" Analytics tab
    Then the Analytics tab "Run" is selected
    And Home is on its "Analytics" tab

  # Assumes "Running" opens Workflows > Runs and "Backlog To do" opens the Backlog (each filtered on
  # its stage; the filter itself is checked by the unit tests).
  @issue-255
  Scenario: A stage's count opens its screen
    Given the app is open
    When I open the "Running" stage of the flow
    Then the Workflows screen is on its "Runs" tab
    When I open "Home" in the sidebar
    And I open the "Backlog To do" stage of the flow
    Then the Backlog screen is shown
