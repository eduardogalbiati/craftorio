Feature: Projects, a screen of the menu with a page per project
  Projects is back in the menu (Code & Build, before Backlog) and is no longer a page of Settings.
  The Projects screen lists the project cards; a card opens the project's page, whose tabs are
  Overview (folder, repository, unpushed commits, runs), Conflict map (the files most runs edit),
  Architecture and Refactor. The Roadmap and Analytics › Performance no longer draw a conflict map of
  their own: a one-line link leads to the project's Conflict map tab.
  The demo project "demo-app" (features/support/app.js) points to github.com/example/demo-app, has 2
  commits not pushed on its local main, and its folder is a plain folder, not a git repository.

  @issue-354
  Scenario: Projects opens from the menu, and a project's page has the Overview, Conflict map, Architecture and Refactor tabs
    Given the app is open
    Then "Backlog" comes right after "Projects" in the sidebar
    When I open "Settings" in the sidebar
    Then Settings has no "Projects" tab
    When I open "Projects" in the sidebar
    Then the Projects screen offers "Open folder" and "New project"
    And the Projects screen lists the project "demo-app"
    When I open the project "demo-app" from the Projects screen
    Then the project page of "demo-app" has the tabs "Overview", "Conflict map", "Architecture" and "Refactor"
    And the project tab "Overview" is selected
    And the Overview shows the repository "https://github.com/example/demo-app" and 2 commits not pushed
    When I open the "Conflict map" project tab
    Then the project tab "Conflict map" is selected
    And the Conflict map tab says the project folder is not a git repository

  @issue-354
  Scenario: The Roadmap and Analytics › Performance link to the project's Conflict map instead of drawing one
    Given the app is open
    When I open the "Analytics" tab of Home
    And I open the "Performance" Analytics tab
    Then the screen shows the link "Conflict map: in Projects › demo-app"
    And the screen does not show "Files most runs edit"
    When I open the Roadmap
    Then the screen shows the link "Conflict map: in Projects › demo-app"
    And the Roadmap draws no Conflict map panel
    When I follow the link "Conflict map: in Projects › demo-app"
    Then the project page of "demo-app" is open
    And the project tab "Conflict map" is selected

  @issue-354 @issue-357
  Scenario: The Refactor tab of a project with no Architecture report leads to the Architecture tab
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the "Refactor" project tab
    Then the Refactor tab says the project has no Architecture report yet
    When I open the Architecture tab from the Refactor tab
    Then the project tab "Architecture" is selected

  # #486: a new project chooses its workflows. Once its folder (or repository) is given, the project
  # dialog shows a Workflows block: a repository's workflows manifest (.multiagent/project.yaml) checks
  # its workflows in their categories and asks nothing; without one, the bundled and workspace
  # workflows by category, none checked, and "Create one for this project". The project's Overview
  # shows the same block, with the project's default workflow (the first solo or team one checked).

  @issue-486
  Scenario: Without a workflows manifest, a new project is offered the workflows by category, none checked
    Given the app is open
    And a local folder "plain-app" without a workflows manifest
    When I open "Projects" in the sidebar
    And I start a new project "plain-app" in the folder "plain-app"
    Then the project dialog shows a Workflows block
    And the Workflows block lists "software-development" under "Build", unchecked
    And no workflow is checked in the Workflows block
    And every category of the Workflows block has a one-line hint
    And the Workflows block offers "Create one for this project"

  @issue-486
  Scenario: A workflow checked when creating a project is checked on the project's Overview
    Given the app is open
    And a local folder "plain-app" without a workflows manifest
    When I open "Projects" in the sidebar
    And I start a new project "plain-app" in the folder "plain-app"
    And I check the workflow "software-development" in the Workflows block
    And I create the project
    And I open the project "plain-app" from the Projects screen
    Then the project's Workflows block shows exactly the card "software-development"
    And the project's Workflows block shows no card "issue-tracker"

  @issue-486
  Scenario: A repository with a workflows manifest gets its workflows pre-checked in their categories
    Given the app is open
    And a local git repository "shop-api" whose workflows manifest lists "software-development" as "solo" and "issue-tracker" as "intake"
    When I open "Projects" in the sidebar
    And I start a new project "shop-api" in the folder "shop-api"
    Then the Workflows block lists "software-development" under "Solo", checked
    And the Workflows block lists "issue-tracker" under "Intake", checked
    And the Workflows block does not offer "Create one for this project"
    When I create the project
    And I open the project "shop-api" from the Projects screen
    Then the project's Workflows block shows exactly the cards "software-development" and "issue-tracker"
    And the workflow card "software-development" has the "Default" badge
