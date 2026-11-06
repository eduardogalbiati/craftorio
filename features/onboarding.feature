Feature: Bring a project in with a guided wizard
  A new-project wizard (Start, Repository, Analysis & workflows, Review) imports a GitHub or GitLab
  repository: it checks the access before it clones, says what went wrong and what to do next when
  something fails, shows what the analysis costs before anything is spent, and lets the owner skip
  it. While the wizard is open the import's progress shows inside it and the progress tray is hidden
  (#724); once the wizard closes the tray follows the imports still running or failed.

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
    # #724: the tray never covers the wizard; the failure shows in the wizard
    And the progress tray is not shown

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
    And the wizard shows the import of "sample-641" as done
    And the wizard shows the analysis cost in total and for the project map
    And the wizard offers to start the analysis
    When I skip the analysis for later
    Then the wizard is on its "review" step
    And the progress tray is not shown

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
    # #724: once the wizard closes the tray keeps only the imports running or failed; this one is cloned
    And the progress tray does not list the project "tray-641"

  # The simulated analysis (MULTIAGENT_SIMULATION_ONLY=1) maps the sample repository's code without a model
  # call. #730: the review no longer ranks refactors to pick (its findings are filed one by one, see below).
  @issue-642 @issue-730
  Scenario: The review shows the city and the backlogs, and Finish keeps the idea
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
    And the review lists the Oracle's findings, each with "Create issue" and "Create issue and prioritize"
    When I type the idea "Export the city as an image" in the review
    And I finish the wizard
    Then the project wizard closes right away
    And the project page of "review-642" is open
    And the project page shows the Next steps card
    And the Next steps card offers "issue with the PO", "idea" and "Keep refactoring"
    And the Next steps card shows "release CI" and "screenshots" as coming later
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
    Then the project tab "Health" is selected
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
    And the wizard shows the analysis cost in total and for the project map
    When I start the analysis in the wizard
    Then the progress tray shows the project "sample-644" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review shows the project's city and its backlog
    And the review lists the Oracle's findings, each with "Create issue" and "Create issue and prioritize"
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
    And the wizard shows the import of "sample-644" as done
    And the progress tray is not shown

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
    # #725: the rows show only after a choice in the workflows column
    When I choose "Analyze the repository" in the wizard's suggested workflows
    Then the wizard shows the ways of working profile
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

  # #725: step 3's right column "Suggested workflows" starts with two choices, Analyze the repository or
  # Define manually; no workflow row before one is chosen. The footer's Continue to the review works at
  # any point of the step (the left column's "Analyze and continue" is gone). The simulated ways of working
  # analysis is kept running (an E2E hook of the simulated onboarding, see onboarding.steps.js) so the
  # analyzing look stays on screen for its baseline (@visual: the screenshot lane). #781: the notice with its
  # spinner became the analysis phases, one activity line each.
  @issue-725 @visual
  Scenario: Analyzing the repository dims the suggested workflows under the analysis phases, and Continue stays available
    Given the app is open while the "ways of working" analysis keeps running
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "analyzing-725"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's suggested workflows offer "Analyze the repository" and "Define manually" and no workflow yet
    And the wizard lets me continue to the review
    When I choose "Analyze the repository" in the wizard's suggested workflows
    Then the wizard's suggested workflows are dimmed under the analysis phases, with no spinner
    And the wizard lets me continue to the review
    And the wizard's suggested workflows look like the baseline "onboarding-analysis-analyzing.png"

  @issue-725
  Scenario: Defining the workflows manually shows them ready to change at once, and Continue stays available
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "manual-725"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows are not dimmed
    And I can change the suggested "feature" workflow
    And I can change the suggested "fix" workflow
    And I can change the suggested "release" workflow
    And I can change the suggested "ci" workflow
    And the wizard lets me continue to the review

  # Analyze the repository starts the analysis (the paid project map included; #730: no refactor ranking);
  # the simulated project map is made to fail (an E2E hook, see onboarding.steps.js). Its row says why and
  # retries that job only; nothing offers to analyze everything again.
  @issue-725 @issue-730
  Scenario: A paid analysis that failed says why and offers to retry it, and Continue stays available
    Given the app is open where the "project map" analysis fails
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "failed-725"
    And I go to the next step of the wizard
    And I choose "Analyze the repository" in the wizard's suggested workflows
    Then the wizard's "project map" analysis says why it failed and offers to retry it
    And the wizard's "project map" analysis shows no amount
    And the wizard lets me continue to the review
    And the wizard does not offer to analyze everything again

  # #726: every text of step 3's suggested workflows column follows the interface language (the reasons,
  # the selectors' options, the left column's profile line), and the "Why" of each reason is an element of
  # its own, bold in the accent colour. The sample repository has no pull request, no CI file and unit tests
  # only, so its rows read the local merge reasons. A language switch with the wizard open (what Settings
  # saves, pushed to every window) re-renders the column and keeps the owner's picks.
  @issue-726
  Scenario: With the interface in Português (Brasil), the suggested workflows read in Portuguese with a highlighted "Por quê:"
    Given the app is open
    And a local git repository with some code is ready to import
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "idioma-726"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Analyze the repository" in the wizard's suggested workflows
    Then the wizard suggests the workflows "feature", "fix", "release" and "ci"
    And every suggested workflow shows a highlighted "Por quê:" label
    And the wizard's "suggested workflows" shows none of these English texts:
      | Why:                                         |
      | Remote PRs                                   |
      | Local merge                                  |
      | Milestone · tag + notes                      |
      | On pull requests and releases                |
      | the changes are merged on your machine       |
      | Hotfix mode                                  |
      | no CI file was found                         |
    And the wizard's "ways of working profile" shows none of these English texts:
      | Local: merge, then push main |
      | No CI: the local suite only  |
      | Unit tests                   |

  @issue-726
  Scenario: Switching the interface language with the wizard open re-renders the suggested workflows and keeps the pick
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "switch-726"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Analyze the repository" in the wizard's suggested workflows
    Then every suggested workflow shows a highlighted "Why:" label
    When I pick "Local merge · E2E first" for the suggested "feature" workflow
    And the interface language is switched to "Português (Brasil)" while the wizard stays open
    Then every suggested workflow shows a highlighted "Por quê:" label
    And the suggested "feature" workflow still has "Local merge · E2E first" picked, read in "Português (Brasil)"
    And the wizard's "suggested workflows" shows none of these English texts:
      | Why:                                   |
      | Remote PRs                             |
      | Local merge                            |
      | Milestone · tag + notes                |
      | On pull requests and releases          |
      | the changes are merged on your machine |

  # #731: the analysis's "City and architecture" job (the project map) draws the city plan, then runs the
  # Oracle. Once it is done the project's City is grouped by the plan's districts, never "No city plan yet",
  # and "Analyze again" (#782: "Analyze this project" only for a stale or moved plan) only refreshes the plan.
  # The review's "Open the city" finishes the wizard and lands on that City. The simulated plan is drawn
  # without a model call (MULTIAGENT_SIMULATION_ONLY=1).
  @issue-731
  Scenario: Open the city after the analysis lands on the project's City drawn from its plan, and Analyze only refreshes it
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "city-731"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "city-731" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review shows the project's city and its backlog
    When I open the city from the review
    Then the project wizard closes right away
    And the project page of "city-731" is open
    And the project tab "City" is selected
    And the City tab shows the project city
    And the city is drawn from its plan, with its districts
    And the City tab does not say there is no city plan yet
    And the City tab offers "Analyze again" only as a refresh of the city plan

  @issue-731 @issue-730
  Scenario: After the onboarding's analysis, the project's City tab already has its city plan
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "plan-731"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "plan-731" as analyzed
    When I go to the next step of the wizard
    And I finish the wizard
    Then the project page of "plan-731" is open
    When I open the "City" project tab
    Then the City tab offers "Analyze again" only as a refresh of the city plan
    And the City tab does not say there is no city plan yet
    And the city is drawn from its plan, with its districts

  # The simulated city plan is made to fail (an E2E hook, see onboarding.steps.js): the project map's row
  # says why and retries that job only (#725).
  @issue-731
  Scenario: A city plan that could not be drawn says why on the project map's row and offers to retry it
    Given the app is open where drawing the city plan fails
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "noplan-731"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the wizard's "project map" analysis says why it failed and offers to retry it
    And the wizard's "project map" analysis gives a reason that mentions "city plan"
    And the wizard's "project map" analysis shows no amount
    And the wizard lets me continue to the review

  # #730: the analysis no longer ranks the refactors (no Product Owner job, no "refactor ranking" row); the
  # findings of the Oracle's report are not sent anywhere on their own. The review lists them, each with
  # "Create issue" and "Create issue and prioritize". The simulated Oracle reports the sample repository's top
  # hotspot as a finding (packages/engine/domains/oracle/oracle-architecture.js mockReport).
  @issue-730
  Scenario: The analysis has no refactor ranking row, and the review lists the Oracle's findings with their Create issue buttons
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "health-730"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's analysis has no refactor ranking row
    When I start the analysis in the wizard
    Then the progress tray shows the project "health-730" as analyzed
    And the wizard's analysis has no refactor ranking row
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review lists the Oracle's findings, each with "Create issue" and "Create issue and prioritize"
    And no finding of the review has an issue yet

  # #724: the progress tray never covers the wizard. The simulated clone is held (an E2E hook, see
  # onboarding.steps.js) so the import is still running while it is checked.
  @issue-724
  Scenario: While an import runs the wizard shows its progress and the tray stays hidden, never covering the wizard's action
    Given the app is open while the clone of an import keeps running
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "running-724"
    And I go to the next step of the wizard
    Then the wizard shows the import of "running-724" running with a spinner
    And the progress tray is not shown
    And the wizard's action button is visible and nothing covers it

  @issue-724
  Scenario: Closing the wizard while an import runs shows the import in the progress tray
    Given the app is open while the clone of an import keeps running
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "closed-724"
    And I go to the next step of the wizard
    And I close the project wizard
    Then the project wizard is not shown
    And the progress tray shows the project "closed-724" as cloning with a spinner

  # The simulated clone is slowed (an E2E hook, see onboarding.steps.js) so it ends after the wizard closed.
  @issue-724
  Scenario: An import that ends after the wizard closed leaves the tray and says so with a way to open the project
    Given the app is open where the clone of an import takes 8 seconds
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "toast-724"
    And I go to the next step of the wizard
    And I close the project wizard
    Then the progress tray shows the project "toast-724" as cloning with a spinner
    And the app says "toast-724 imported" and offers to open the project
    And the progress tray does not list the project "toast-724"
    When I open the project from the "toast-724 imported" notice
    Then the project page of "toast-724" is open

  # #739: the Repository step names the project after the repository until the owner names it.
  @issue-739
  Scenario: Pasting a repository URL names the project after the repository
    Given the app is open
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I paste the repository "https://gitlab.com/eduardogalbiati/pharmaged" in the wizard
    Then the wizard's project name reads "Pharmaged"

  @issue-739
  Scenario: A project name the owner typed is kept when the repository URL changes
    Given the app is open
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I type the repository "https://gitlab.com/eduardogalbiati/pharmaged" in the wizard
    Then the wizard's project name reads "Pharmaged"
    When I type the project name "My Pharmacy" in the wizard
    And I type the repository "https://github.com/eduardogalbiati/field-notes" in the wizard
    Then the wizard's project name reads "My Pharmacy"

  # #743: Next on the Repository step clones in place: its button turns into "Cloning <name>…" with a
  # spinner (no status card, the fields read-only), then the wizard goes on to "Analysis & workflows";
  # the dialog keeps one size on every step. The simulated clone is slowed (an E2E hook) to see it.
  @issue-743
  Scenario: Next clones in place and goes on to the analysis step, the wizard keeping its size
    Given the app is open where the clone of an import takes 8 seconds
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "cloning-743"
    And I note the wizard's size
    And I go to the next step of the wizard
    Then the wizard's action button shows a spinner and "Cloning cloning-743…"
    And the wizard is on its "repository" step
    And the wizard shows no import status card and its repository fields are read-only
    And the wizard has the size I noted
    And the wizard is on its "analysis" step
    And the wizard has the size I noted

  # #744: the Next steps card starts with "Create an issue with the PO"; its "Open the PO" opens the Product
  # Owner's chat on Register an issue, for the project, its message box focused. A project whose analysis was
  # skipped has no refactor proposals, so the card shows no refactors step (never "File and add 0"). A step
  # that cannot be used yet (release CI, screenshots) says why, in its button's tooltip and in a visible line.
  @issue-744
  Scenario: The Next steps card starts with "Create an issue with the PO", whose "Open the PO" opens the Product Owner on an issue for the project
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "po-744"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page shows the Next steps card
    And the first step of the Next steps card is "Create an issue with the PO" with the button "Open the PO"
    When I click "Open the PO" in the Next steps card
    Then the Product Owner's chat is open on "Register an issue" for the project "po-744"
    And the Product Owner's message box is focused

  @issue-744
  Scenario: With no refactor proposals the Next steps card has no refactors step
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "norefactor-744"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page shows the Next steps card
    And the Next steps card has no refactors step and no button that adds 0

  @issue-744
  Scenario: A step of the Next steps card that cannot be used yet says why, in its tooltip and in a visible line
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "later-744"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page shows the Next steps card
    And the Next steps card shows "release CI" and "screenshots" as coming later
    And every disabled step of the Next steps card says why, in its tooltip and in a visible line

  # #738: a repository the owner can't push to (gh answers permissions.push=false) gets the fork suggestion:
  # Create a fork (origin = the fork, upstream = the original) picks the Fork + PR way of working, Work locally
  # the Local one (no pull request). gh's answer and the fork are simulated (an E2E hook, see onboarding.steps.js).
  @issue-738
  Scenario: Importing a repository I can't push to suggests a fork, and Create a fork picks the Fork + PR way of working
    Given the app is open where I can't push to the repositories I import
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "fork-738"
    And I go to the next step of the wizard
    Then the wizard suggests creating a fork to contribute, or working locally
    When I choose "Create a fork" in the fork suggestion
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows use the "Fork + PR" way of working

  @issue-738
  Scenario: Choosing to work locally on a repository I can't push to picks the Local way of working, with no pull request
    Given the app is open where I can't push to the repositories I import
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "local-738"
    And I go to the next step of the wizard
    Then the wizard suggests creating a fork to contribute, or working locally
    When I choose "Work locally" in the fork suggestion
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows use the "Local" way of working
    And the wizard's suggested workflows say "no pull request"

  @issue-738
  Scenario: Importing a repository I can push to does not suggest a fork
    Given the app is open where I can push to the repositories I import
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "push-738"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard does not suggest a fork

  # #633 (onboarding phase 5): step 3 follows docs/work/first-project-onboarding/images/mock-5.jpg. How work on
  # the project is documented: Light, Standard (picked by default) or Full, and where the files live in the
  # repository. The pick is the project's workModel (light | standard | full), saved with the wizard while it is
  # open. @visual: the section's baseline is taken in the screenshot lane.
  @issue-633 @visual
  Scenario: The Analysis & workflows step shows how work on the project is documented, Standard picked, and where the files live
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "Shop"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard shows how work on "Shop" is documented
    And the wizard offers the work models:
      | Light    | An issue, then feature or fix. Nothing else is written.          |
      | Standard | intent.md → spec.md → plan.md → code. Recommended for features. |
      | Full     | Standard + REVIEW.md + evals of the project's skills and workflows. |
    And the wizard has the "Standard" work model picked
    And the wizard's work model files live "In the repository" in "docs/work/<item>/" as "intent.md", "spec.md" and "plan.md"
    And the wizard's work model files show the chips "fix: issue only", "feature: Standard" and "release: notes"
    And the wizard's work model looks like the baseline "onboarding-work-model.png"

  # The pick is saved with the wizard while it is open: an onboarding closed on step 3 and resumed from the
  # project's card on the Projects screen (#741) shows it again.
  @issue-633
  Scenario: The work model picked in the wizard is kept when the onboarding is resumed from the Projects screen
    Given the app is open
    And a local git repository with some code is ready to import
    When I open "Projects" in the sidebar
    And I choose New project in the Projects screen's header
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "light-633"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I pick the "Light" work model in the wizard
    Then the wizard has the "Light" work model picked
    When I close the project wizard
    Then the project "light-633" on the Projects screen says its onboarding is not finished and offers Continue
    When I continue the onboarding of the project "light-633" from the Projects screen
    Then the wizard is on its "analysis" step
    And the wizard has the "Light" work model picked

  # #781: the analysis says what it is doing and what it found, one activity line per phase. The sample
  # repository has 4 commits and JavaScript files. The simulated analysis makes no model call
  # (MULTIAGENT_SIMULATION_ONLY=1), so the Oracle's phase reads "not needed". The line of a phase while it runs
  # (the Oracle's reading and elapsed time) needs a held turn: the unit tests cover it.
  @issue-781
  Scenario: Step 3 shows the analysis phases ending done with what they found, and Continue stays available
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "phases-781"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I start the analysis in the wizard
    Then the wizard's "git history" analysis phase ends done saying "4 commits"
    And the wizard's "files" analysis phase ends done saying "JavaScript"
    And the wizard's "Oracle" analysis phase ends skipped saying "not needed"
    And the wizard lets me continue to the review

  # #781: the review's project card shows the languages as the Health tab does, and the Project type opens on
  # the kind the analysis detected (the sample repository has no UI: backend). A local repository has no
  # issues to read, so the Backlog card ends on its empty line; its "Reading issues" state cannot be held here
  # (the backlog is not an onboarding job): the unit tests cover it.
  @issue-781
  Scenario: Step 4 shows the language bar, the detected project type and the Backlog card's last activity line
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "review-781"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "review-781" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's project card shows the language bar led by "JavaScript", its legend ordered by share
    And the review's Project type opens on "backend", marked as detected
    And the review's Backlog card ends with "No open issues."
