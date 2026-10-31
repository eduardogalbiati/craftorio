Feature: Bring a project in with a guided wizard
  A new-project wizard (Start, Repository, Analysis & workflows, Review) imports a GitHub or GitLab
  repository: it checks the access before it clones, says what went wrong and what to do next when
  something fails, shows what the analysis costs before anything is spent, and lets the owner skip
  it. A progress tray follows the clone and the analyses live, and keeps them after the wizard closes.

  # Temporary until onboarding step 6: the wizard is opened through window.ProjectWizard.open()
  # (Projects › New project still opens the old dialog). The URL below fails the access check both
  # offline (no network) and online (no such repository): both read "could not be reached".
  @issue-641
  Scenario: Importing a repository I cannot reach says so and offers to retry
    Given the app is open
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the repository "https://github.com/multiagent-e2e/does-not-exist-641" and the project name "missing-641"
    And I go to the next step of the wizard
    Then the wizard says the repository could not be reached and offers to retry
    And the progress tray shows the project "missing-641" as failed with its reason and a Retry

  # A local git repository (a file:// URL in the scratch folder) stands for a reachable one: the
  # access check (git ls-remote) and the clone work on it without network or credentials.
  @issue-641
  Scenario: The analysis step shows its cost before anything starts, and skipping it reaches the review
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "sample-641"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the progress tray shows the project "sample-641" as ready
    And the wizard shows the analysis cost in total and for the project map and the refactor ranking
    And the wizard offers to start the analysis
    When I skip the analysis for later
    Then the wizard is on its "review" step
    And the progress tray shows the project "sample-641" as ready

  @issue-641
  Scenario: The progress tray keeps following the import after the wizard is closed
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "tray-641"
    And I go to the next step of the wizard
    And I close the project wizard
    Then the project wizard is not shown
    And the progress tray shows the project "tray-641" as ready
