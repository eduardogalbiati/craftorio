Feature: A project's ways of working, from an interview
  In Projects, a project's "Ways of working" interview runs an analysis of the repository (its cost
  shown first), shows the profile it inferred with its evidence ("one author, merges straight to main,
  a tag every two weeks: Solo: local merge + Release: milestone"), asks only the questions the
  history cannot answer, each with a default from the profile, and proposes a set of workflows
  (intake, development, release). The owner opens the composed workflow in the Builder, or writes the
  set to the repository (uncommitted); nothing is written before that click.
  In simulation mode the analysis returns a simulated profile.

  @issue-487 @quarantine
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

  @issue-487 @quarantine
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
    And I choose "Analyze with AI" in the wizard's suggested workflows
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

  # #844: the profile says what the history shows, no more. The imported repository (a local git repository built
  # commit by commit, see features/steps/onboarding.steps.js) has no test command and no test file, tags after each
  # round, the owner pushing straight to main under 3 git identities and 2 outside contributors whose pull requests
  # the owner merges: 3 people, 5 identities. The wizard picks the "Milestone" release style for it, and the project
  # is saved with that pick.
  @issue-844
  Scenario: A repository with no tests says no tests were found, and Ways of working shows the release style picked in the wizard
    Given the app is open
    And a local git repository is ready to import where 3 people commit under 5 git identities, the owner pushes straight to main, outside contributors' pull requests are merged, releases are tagged and nothing is tested
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "notests-844"
    And I go to the next step of the wizard
    And I choose "Analyze with AI" in the wizard's suggested workflows
    Then the wizard shows the ways of working profile
    And the wizard's suggested workflows are not dimmed
    And the wizard's ways of working profile says no tests were found or leaves the tests open
    And the suggested "release" workflow has "Milestone · tag + notes" picked
    When I go to the next step of the wizard
    And I finish the wizard
    Then the project page of "notests-844" is open
    When I open the Ways of working interview
    Then the interview shows the saved profile with its evidence, its open questions and the proposed workflows
    And the interview says no tests were found or asks about them, never "unit tests"
    And the interview's release style is "milestone", as picked in the wizard, never "train"

  @issue-844
  Scenario: Pushes straight to main next to outside contributors' pull requests are not read as "Remote: pull requests", and the authors are counted as people
    Given the app is open
    And a local git repository is ready to import where 3 people commit under 5 git identities, the owner pushes straight to main, outside contributors' pull requests are merged, releases are tagged and nothing is tested
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "mixed-844"
    And I go to the next step of the wizard
    And I choose "Analyze with AI" in the wizard's suggested workflows
    Then the wizard shows the ways of working profile
    And the wizard's suggested workflows are not dimmed
    And the wizard's "ways of working profile" shows none of these English texts:
      | Remote: pull requests |
    When I go to the next step of the wizard
    And I finish the wizard
    Then the project page of "mixed-844" is open
    When I open the Ways of working interview
    Then the interview shows the saved profile with its evidence, its open questions and the proposed workflows
    And the interview reads the mode as the local flow, or asks about it naming the pushes to main and the outside pull requests
    And the interview counts 3 people among the authors

  # The counterpart, so the fix does not swing the other way: a repository where every change lands through a pull
  # request (one author) and the tests run with "npm test" still reads pull requests and unit tests.
  @issue-844
  Scenario: A repository where every change lands through a pull request and the tests run still reads pull requests and unit tests
    Given the app is open
    And a local git repository is ready to import where every change lands through a merged pull request and the tests run with "npm test"
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "pulls-844"
    And I go to the next step of the wizard
    And I choose "Analyze with AI" in the wizard's suggested workflows
    Then the wizard shows the ways of working profile
    And the wizard's suggested workflows are not dimmed
    When I go to the next step of the wizard
    And I finish the wizard
    Then the project page of "pulls-844" is open
    When I open the Ways of working interview
    Then the interview shows the saved profile with its evidence, its open questions and the proposed workflows
    And the interview's profile reads "Mode: pull requests"
    And the interview's profile reads "Tests: unit tests"

  # #847: with the interface in Português (Brasil) every text of the drawer reads in Portuguese: the open questions'
  # labels, their hints (the question asked) and their options, and the run defaults. The texts below are the
  # English ones the owner found left in the drawer.
  @issue-847
  Scenario: With the interface in Português (Brasil), the open questions of Ways of working and their options read in Portuguese
    Given the app is open
    And the demo project's folder is a git repository where one author commits straight to main
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the Ways of working interview
    And I start the interview's analysis
    Then the interview shows none of these English texts:
      | Validate every round                                                  |
      | Approve every change before it lands, or trust the automatic checks? |
      | The most one issue may spend on models, in US$.                       |
      | Capture the screens a change touches as its evidence?                 |
      | Trust auto                                                            |
      | On                                                                    |
