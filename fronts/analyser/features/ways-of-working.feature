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

  # #733: the drawer opens on the project's last ways of working analysis when it has one (the onboarding's
  # free part runs it after the clone, or an earlier Analyze in the drawer): its profile, evidence, open
  # questions and proposed set, "Analyzed on <date>" and "Analyze again" as a secondary action, with no
  # click. With none it opens on the first screen (intro, cost, Analyze). The simulated analysis (no model
  # call) ends in well under a second, so the loader of a running analysis ("Analyzing the repository…",
  # its elapsed time and activity, again after closing and reopening) cannot be observed reliably here.
  @issue-733
  Scenario: A project analyzed during the onboarding opens Ways of working on its profile, dated, with "Analyze again"
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "wow-733"
    And I go to the next step of the wizard
    And I choose "Analyze the repository" in the wizard's suggested workflows
    Then the wizard shows the ways of working profile
    And the wizard's suggested workflows are not dimmed
    When I go to the next step of the wizard
    And I finish the wizard
    Then the project page of "wow-733" is open
    When I open the Ways of working interview
    Then the interview shows the saved profile with its evidence, its open questions and the proposed workflows
    And the interview says when the repository was analyzed
    And the interview offers "Analyze again" as a secondary action

  @issue-733
  Scenario: A project with no ways of working analysis opens on the first screen: intro, cost and Analyze
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    Then the interview introduces the analysis
    And the interview shows the analysis's cost estimate before anything runs
    And the interview does not say when the repository was analyzed

  @issue-733
  Scenario: An analysis made in the drawer is shown again, dated, when the drawer is reopened after a reload
    Given the app is open
    And the demo project's folder is a git repository where one author commits straight to main
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    And I start the interview's analysis
    And I close the interview
    And I reload the app
    And I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    Then the interview shows the saved profile with its evidence, its open questions and the proposed workflows
    And the interview says when the repository was analyzed
    And the interview offers "Analyze again" as a secondary action
