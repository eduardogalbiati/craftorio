Feature: A project's ways of working, from an interview
  In Projects, a project's "Ways of working" interview runs an analysis of the repository (its cost
  shown first), shows the profile it inferred with its evidence ("one author, merges straight to main,
  a tag every two weeks: Solo: local merge + Release: milestone"), asks only the questions the
  history cannot answer, each with a default from the profile, and proposes a set of workflows
  (intake, development, release). The owner opens the composed workflow in the Builder, or writes the
  set to the repository (uncommitted); nothing is written before that click.
  In simulation mode the analysis returns a simulated profile.

  @issue-487
  Scenario: The interview shows the inferred profile, asks the open questions and opens the composed workflow in the Builder
    Given the app is open
    And the demo project's folder is a git repository where one author commits straight to main
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    Then the interview shows the analysis's cost estimate before anything runs
    When I start the interview's analysis
    Then the interview shows the inferred profile as "Solo" or "Team" with its evidence
    And the interview asks "Validation", "Budget per issue", "Screenshots", "Review rigour" and "Release style", each with a default answer I can change
    And the interview proposes an "intake", a "development" and a "release" workflow
    When I click "Open in Builder" in the interview
    Then the Workflows screen is on its "Builder" tab
    And the Builder shows the proposed "development" workflow

  @issue-487
  Scenario: Writing to the repository adds the proposed workflows, uncommitted, and nothing before the click
    Given the app is open
    And the demo project's folder is a git repository where one author commits straight to main
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    And I start the interview's analysis
    Then the interview proposes an "intake", a "development" and a "release" workflow
    And the project's repository has no workflows from the interview
    When I click "Write to the repository" in the interview
    Then the project's repository holds the proposed workflows and their manifest, not committed
    When I close the interview
    Then the project page lists the proposed workflows as repository workflows

  @issue-487
  Scenario: Cancelling once the price is shown runs nothing and writes nothing
    Given the app is open
    And the demo project's folder is a git repository where one author commits straight to main
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    Then the interview shows the analysis's cost estimate before anything runs
    When I cancel the interview
    Then the interview is closed
    And no ways-of-working analysis has run
    And the project's repository has no workflows from the interview
