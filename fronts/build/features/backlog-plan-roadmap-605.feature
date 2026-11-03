Feature: Assigned issues go to the roadmap, the Backlog has no queue of its own
  The Backlog's Assign dialog adds its issues to the roadmap as one item in a new stage at the end;
  "Run now" starts that stage only. Nothing waits in a plain queue: the Backlog shows no queue bar,
  no "Queue" alert, and the Roadmap no longer offers "Move into the roadmap".

  # The demo roadmap has 5 stages: the issues assigned here land in a new stage 6. The two issues are
  # added to the demo backlog (open, in no roadmap stage) before the Backlog opens.

  @issue-605 @issue-446
  Scenario: Assigning issues with Run now adds them as a new last roadmap stage and starts that stage only
    Given the app is open
    And the backlog has the open issues "Plan me: a dark theme" and "Plan me: export to PDF"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I select the issue "Plan me: a dark theme"
    And I select the issue "Plan me: export to PDF"
    And I open the Assign dialog for the selected issues
    And I tick "Run now" in the Assign dialog
    And I add the issues to the roadmap from the Assign dialog
    And I scroll the roadmap down to stage 6
    Then stage 6 is the last stage of the roadmap, with one item holding "Plan me: a dark theme" and "Plan me: export to PDF"
    And stage 6 of the roadmap has started
    And nothing in stage 5 of the roadmap has started

  @issue-605 @issue-446
  Scenario: Assigning issues without Run now plans a new last stage and starts nothing
    Given the app is open
    And the backlog has the open issues "Plan me: a dark theme" and "Plan me: export to PDF"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I select the issue "Plan me: a dark theme"
    And I select the issue "Plan me: export to PDF"
    And I open the Assign dialog for the selected issues
    Then the Assign dialog offers "Run now", unticked
    When I add the issues to the roadmap from the Assign dialog
    And I scroll the roadmap down to stage 6
    Then stage 6 is the last stage of the roadmap, with one item holding "Plan me: a dark theme" and "Plan me: export to PDF"
    And nothing in stage 6 of the roadmap has started
    And the roadmap bar does not show "stage 6 only"

  @issue-605 @issue-446
  Scenario: The Backlog shows no queue bar or Queue alert, and the Roadmap no "Move into the roadmap"
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    Then the Backlog shows no queue bar
    And the Backlog shows no Queue alert
    When I open the Roadmap
    Then the screen offers no "Move into the roadmap" button
