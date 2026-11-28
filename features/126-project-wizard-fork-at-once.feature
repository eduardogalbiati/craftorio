Feature: Creating a fork in the project wizard does not wait for the clone
  On a repository I can't push to, "Create a fork" makes the fork (or reuses mine) at once while the clone runs;
  the notice shows the fork and says the remotes are set once the clone ends, then the wizard moves on to the
  analysis. A fork that fails says why at once, with both choices again.
  gh's answer, the fork and the clone are simulated (E2E hooks, see steps/project-wizard-fork-126.steps.js).

  @issue-126
  Scenario: Creating a fork while the clone runs shows the fork at once, then the analysis once the clone ends
    Given the app is open where I can't push to the repositories I import and the clone of an import takes 15 seconds
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the path of the local repository and the project name "fork-126"
    And I go to the next step of the wizard
    Then the wizard suggests creating a fork to contribute, or working locally
    When I choose "Create a fork" in the fork suggestion while the clone runs
    Then the fork notice shows the fork's address and says the remotes are set once the clone ends
    And the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows use the "Fork + PR" way of working

  @issue-126
  Scenario: A fork that fails says why at once, with both choices again, while the clone runs
    Given the app is open where I can't push to the repositories I import, forking fails and the clone of an import keeps running
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the path of the local repository and the project name "fork-fail-126"
    And I go to the next step of the wizard
    Then the wizard suggests creating a fork to contribute, or working locally
    When I choose "Create a fork" in the fork suggestion while the clone runs
    Then the fork notice says why the fork failed and offers to create a fork or work locally again
