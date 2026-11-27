Feature: A local folder import keeps its real remote and its local backlog
  A repository imported from a folder on this computer (the wizard's local repository: its file:// URL) is no
  longer saved with that file:// URL as its remote (#105). A folder whose git has a GitHub remote gives the project
  that remote ("https://github.com/acme/widget.git"), and step 3's manual workflows follow it (Remote PR). A folder
  with git and no remote gives a project with a local backlog, as a new project without a repository has (#35):
  step 3's manual workflows are Local, the Backlog reads no platform (never "not a recognizable git URL"), and a
  finding of the review filed with "Create issue" is a local issue of that backlog.

  # Until #105 the project's repository was the folder's file:// URL: the Backlog's sync failed with "The project's
  # repository is not a recognizable git URL: file:///…", Create issue on a review finding failed, and step 3's
  # manual workflows ignored the folder's GitHub remote. The folder is a real git repository under the scenario's
  # scratch folder; its GitHub remote is never reached (the simulated app has no gh signed in: the import goes on).
  @issue-105
  Scenario: Importing a folder whose git has a GitHub remote gives the project that remote, and step 3 defaults to Remote PR
    Given the app is open
    And a local git repository whose remote is "https://github.com/acme/widget.git" is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "widget-105"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows use the "Remote" way of working
    And the suggested "feature" workflow has "Remote PR · code first" picked
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "widget-105" is open
    When I open "Projects" in the sidebar
    Then the Projects screen shows the repository "https://github.com/acme/widget.git" for the project "widget-105", not the folder's file URL

  @issue-105
  Scenario: Importing a folder with git and no remote defaults step 3 to Local, and its Backlog is a local backlog that reads without error
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "plain-105"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard's suggested workflows use the "Local" way of working
    And the suggested "feature" workflow has "Local merge · code first" picked
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "plain-105" is open
    When I open "Backlog" in the sidebar
    And I choose the project "plain-105" in the header
    Then the page is described as kept in the workspace
    And the open screen does not say "not a recognizable git URL"
    And the Backlog does not offer "Sync"
    And the Backlog offers "New issue…", enabled

  # The simulated Oracle reports the sample repository's top hotspot as a finding (#730)
  @issue-105
  Scenario: On a folder imported with no remote, Create issue on a review finding files a local issue of its backlog
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "findings-105"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I start the analysis in the wizard
    Then the progress tray shows the project "findings-105" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review lists the Oracle's findings, each with "Create issue" and "Create issue and prioritize"
    When I create an issue from the review's first finding
    Then the review's first finding links to its issue
    When I finish the wizard
    Then the project page of "findings-105" is open
    When I open "Backlog" in the sidebar
    And I choose the project "findings-105" in the header
    Then the page is described as kept in the workspace
    And the local backlog counts 1 open issue and 0 closed issues
