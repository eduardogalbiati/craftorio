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

  # The simulated analysis (MULTIAGENT_SIMULATION_ONLY=1) maps the sample repository's code and ranks its
  # refactors without a model call; the refactor picked and its title are whatever the simulation proposes.
  @issue-642
  Scenario: The review shows the city and the backlogs with each file's score, and Finish plans the picked refactor and keeps the idea
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "review-642"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "review-642" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review shows the project's city and its backlog
    And every row of the review's refactor backlog shows a file's score from 0 to 100 and its quadrant
    When I pick the first refactor of the review
    And I type the idea "Export the city as an image" in the review
    And I finish the wizard
    Then the project wizard closes right away
    And the project page of "review-642" is open
    And the project page shows the Next steps card
    And the Next steps card offers "roadmap", "idea" and "refactor cadence"
    And the Next steps card offers neither "release CI" nor "screenshots"
    When I open the "roadmap" entry of the Next steps card
    Then the roadmap shows the refactor I picked as a planned item
    When I open "Inbox" in the sidebar
    Then the Inbox lists the idea "Export the city as an image"

  # Another analysis holding the machine's analysis slot keeps this project's project map waiting, so the
  # analysis is still running when Finish is clicked.
  @issue-642
  Scenario: Finish does not wait for an analysis that is still running
    Given the app is open while another analysis holds the machine's analysis slot
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "early-642"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project wizard closes right away
    And the project page of "early-642" is open
    And the project page shows the Next steps card
    And the progress tray shows the project "early-642" as analyzing

  @issue-642
  Scenario: The Next steps card leads to its screens and stays gone once dismissed
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "dismiss-642"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page shows the Next steps card
    When I open the "refactor cadence" entry of the Next steps card
    Then the project tab "Refactor" is selected
    When I open "Projects" in the sidebar
    And I open the project "dismiss-642" from the Projects screen
    Then the project page shows the Next steps card
    When I dismiss the Next steps card
    Then the project page does not show the Next steps card
    When I reload the app
    And I open "Projects" in the sidebar
    And I open the project "dismiss-642" from the Projects screen
    Then the project page of "dismiss-642" is open
    And the project page does not show the Next steps card

  # #644 (onboarding step 7): the whole journey of a first start, simulated (MULTIAGENT_SIMULATION_ONLY=1,
  # the mock provider). A new workspace has no project, so Home shows its empty state; its "Create a
  # project" opens the wizard (until #644 it opened the old New project dialog). The sample repository is
  # a local git repository with some code in the scenario's scratch folder, imported by its file:// URL.
  @issue-644 @smoke
  Scenario: From the empty Home, a sample repository becomes a project with its city, its backlog and the Next steps card
    Given the app is open on a new workspace
    And a local git repository with some code is ready to import
    When I skip the Setup and confirm
    Then Home says there is no project yet and offers to create one
    When I choose to create a project from Home
    Then the project wizard is open on its first step
    When I choose to import a repository in the wizard
    And I enter the local repository and the project name "sample-644"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard shows the analysis cost in total and for the project map and the refactor ranking
    When I start the analysis in the wizard
    Then the progress tray shows the project "sample-644" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review shows the project's city and its backlog
    And every row of the review's refactor backlog shows a file's score from 0 to 100 and its quadrant
    When I finish the wizard
    Then the project wizard closes right away
    And the project page of "sample-644" is open
    And the project page shows the Next steps card

  # The no-access path from the empty Home: the URL below fails the access check offline and online (no
  # such repository). Edit the URL opens the fields again for a new import; the failed one stays in the tray.
  @issue-644
  Scenario: From the empty Home, a repository the app cannot reach shows the access error, and editing the URL imports a reachable one
    Given the app is open on a new workspace
    And a local git repository is ready to import
    When I skip the Setup and confirm
    And I choose to create a project from Home
    And I choose to import a repository in the wizard
    And I enter the repository "https://github.com/multiagent-e2e/does-not-exist-644" and the project name "missing-644"
    And I go to the next step of the wizard
    Then the wizard says the repository could not be reached and offers to retry
    And the wizard offers to edit the repository
    When I edit the repository in the wizard
    And I enter the local repository and the project name "sample-644"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the progress tray shows the project "missing-644" as failed with its reason and a Retry
    And the progress tray shows the project "sample-644" as ready
