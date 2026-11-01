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
    And the Next steps card offers "roadmap", "idea" and "Keep refactoring"
    And the Next steps card shows "release CI" and "screenshots" as coming later
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
    When I open the "Keep refactoring" entry of the Next steps card
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

  # #669: step 1 follows docs/work/first-project-onboarding/images/mock-1.jpg. Since #632 Create new
  # project can be chosen (no longer "soon"); its card shows its icon and its three points.
  @issue-669
  Scenario: The wizard's first step shows the numbered steps, both cards with their icon and points, the other sources and Cancel and Next
    Given the app is open
    When I open the project wizard
    Then the wizard's title reads "Add a project"
    And the wizard says "A project is the code the agents work on. You can change everything later."
    And the wizard's steps read "Start", "Repository", "Analysis & workflows" and "Review", numbered from 1, with "Start" current
    And the wizard's "Import a repository" card has an icon and the points "Cloned into your workspace in the background", "Its history shows how you work today" and "City and refactor backlog ready at the end"
    And the wizard's "Create new project" card has an icon and the points "A git repository in your workspace", "Optionally a private GitHub repository" and "Three questions pick its workflows"
    And the wizard's "Create new project" card can be chosen
    And the wizard offers the other sources "Any git URL" and "A folder on this computer"
    And the wizard's footer has "Cancel" on the left and "Next" on the right

  @issue-669
  Scenario: Any git URL leads to the Repository step's git URL field
    Given the app is open
    When I open the project wizard
    And I choose the other source "Any git URL" in the wizard
    Then the wizard is on its "repository" step
    And the wizard's git URL field is ready to type in

  # Cancel returns to the screen the wizard was opened from (Projects › New project).
  @issue-669
  Scenario: Cancel closes the wizard and returns to the screen it was opened from
    Given the app is open
    When I open "Projects" in the sidebar
    And I choose New project in the Projects screen's header
    Then the project wizard is open on its first step
    When I cancel the project wizard
    Then the project wizard is not shown
    And the Projects screen lists the project "demo-app"

  # #630: step 3 follows docs/work/first-project-onboarding/images/mock-4.jpg: the ways of working
  # profile read from the git history and the suggested feature, fix, release and CI workflows, each
  # with its reason and a selector to change it.
  @issue-630
  Scenario: The Analysis & workflows step shows the ways of working profile and suggests feature, fix, release and CI with their reasons
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "workflows-630"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard shows the ways of working profile
    And the wizard suggests the workflows "feature", "fix", "release" and "ci"
    And each suggested workflow shows why it is suggested
    And I can change the suggested "feature" workflow
    And I can change the suggested "fix" workflow
    And I can change the suggested "release" workflow
    And I can change the suggested "ci" workflow

  # #632: Create new project follows docs/work/first-project-onboarding/images/mock-3.jpg (spec R4, D5 B):
  # a git repository in <workspace>/projects/<name> with a README, a .gitignore and a first commit on main,
  # three questions with their defaults, then the Analysis & workflows step. The simulated E2E app has no
  # GitHub / GitLab CLI signed in, so the private repository option cannot be ticked there.
  @issue-632
  Scenario: Creating a new project makes a git repository with a first commit on main and goes on to the workflows
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    Then the wizard's title reads "Create new project"
    And the new project starts with "README and .gitignore"
    And the wizard asks "Where changes land" with "Local: merge here, push main" chosen
    And the wizard asks "CI" with "On releases: build macOS, Linux, Windows" chosen
    And the wizard asks "How you release" with "Milestones (tags)" chosen
    And the wizard says "Change them any time in Ways of working. Setting up CI is offered as a next step."
    When I name the new project "Field Notes"
    Then the new project will be created in "projects/field-notes" of the workspace
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the workspace's "projects/field-notes" is a git repository with "README.md" and ".gitignore" committed on main
    When I close the project wizard
    And I open "Projects" in the sidebar
    Then the Projects screen lists the project "Field Notes"

  @issue-632
  Scenario: Without a signed-in GitHub or GitLab CLI the private repository cannot be ticked and the project is created locally only
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    Then the private repository option cannot be ticked
    When I name the new project "Local Only"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the workspace's "projects/local-only" is a git repository with "README.md" and ".gitignore" committed on main
    And the workspace's "projects/local-only" has no remote

  @issue-632
  Scenario: An empty project with other answers needs a name first, then is created with git init only
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    Then the next step of the wizard is unavailable
    When I start the new project with "Empty"
    And I answer "Local + remote: pull requests on GitHub" to "Where changes land" in the wizard
    And I answer "None" to "CI" in the wizard
    And I answer "Every merge" to "How you release" in the wizard
    Then the wizard asks "Where changes land" with "Local + remote: pull requests on GitHub" chosen
    And the wizard asks "CI" with "None" chosen
    And the wizard asks "How you release" with "Every merge" chosen
    When I name the new project "Blank Slate"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the workspace's "projects/blank-slate" is a git repository with no commit
