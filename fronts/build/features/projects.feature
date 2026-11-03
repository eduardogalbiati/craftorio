Feature: Projects, a screen of the menu with a page per project
  Projects is back in the menu (Code & Build, before Backlog) and is no longer a page of Settings.
  The Projects screen lists the project cards; a card opens the project's page, whose tabs are
  Overview (folder, repository, unpushed commits, runs), City, Health and Conflict map (the files most
  runs edit), since #730. The Roadmap and Analytics › Performance no longer draw a conflict map of
  their own: a one-line link leads to the project's Conflict map tab.
  The demo project "demo-app" (features/support/app.js) points to github.com/example/demo-app, has 2
  commits not pushed on its local main, and its folder is a plain folder, not a git repository.

  @issue-354
  Scenario: Projects opens from the menu, and a project's page has the Overview, City, Health and Conflict map tabs
    Given the app is open
    Then "Backlog" comes right after "Projects" in the sidebar
    When I open "Settings" in the sidebar
    Then Settings has no "Projects" tab
    When I open "Projects" in the sidebar
    Then the Projects screen offers "Open folder" and "New project"
    And the Projects screen lists the project "demo-app"
    When I open the project "demo-app" from the Projects screen
    Then the project page of "demo-app" has the tabs "Overview", "City", "Health" and "Conflict map"
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

  # #730: a project's page has the tabs Visão geral · Cidade · Saúde · Mapa de conflitos (Overview, City, Health,
  # Conflict map), in this order. The Architecture tab and its Fatos | Cidade switch are gone (the City is a tab
  # of its own, the facts are on Health), and so is the Refactor tab (the findings are filed from Health).
  @issue-730
  Scenario: In Português (Brasil) a project's page has the tabs Visão geral, Cidade, Saúde and Mapa de conflitos in this order, and no Refatoração
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "demo-app" from the Projects screen
    Then the project page of "demo-app" has the tabs "Visão geral", "Cidade", "Saúde" and "Mapa de conflitos"
    And the project page's tabs are "project-tab-overview", "project-tab-city", "project-tab-health" and "project-tab-conflicts", in this order
    And the project page has no "Refatoração" tab and no "Arquitetura" tab
    When I open the "Cidade" project tab
    Then the project tab "Cidade" is selected
    And the City tab has no Facts and City switch

  # #741: an onboarding closed before Finish is not lost. The project's card says "Onboarding not finished"
  # and its Continue (or New project with the same repository) reopens the wizard on the step it was left on
  # (here step 3, Analysis & workflows) with the picks made there; Finish marks it finished. The reachable
  # repository is a local git repository in the scenario's scratch folder (as in features/onboarding.feature).
  @issue-741
  Scenario: An onboarding closed on its third step resumes there with its picks from the card's Continue, and Finish marks it finished
    Given the app is open
    And a local git repository with some code is ready to import
    When I open "Projects" in the sidebar
    And I choose New project in the Projects screen's header
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "resume-741"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    And I pick "Local merge · E2E first" for the suggested "feature" workflow
    And I close the project wizard
    Then the project wizard is not shown
    And the project "resume-741" on the Projects screen says its onboarding is not finished and offers Continue
    When I continue the onboarding of the project "resume-741" from the Projects screen
    Then the wizard is on its "analysis" step
    And the suggested "feature" workflow still has "Local merge · E2E first" picked
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "resume-741" is open
    When I open "Projects" in the sidebar
    Then the project "resume-741" on the Projects screen does not say its onboarding is not finished

  @issue-741
  Scenario: New project with the repository of an unfinished onboarding resumes it on its third step with its picks
    Given the app is open
    And a local git repository with some code is ready to import
    When I open "Projects" in the sidebar
    And I choose New project in the Projects screen's header
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "again-741"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    And I pick "Local merge · E2E first" for the suggested "feature" workflow
    And I close the project wizard
    And I choose New project in the Projects screen's header
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "again-741"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the suggested "feature" workflow still has "Local merge · E2E first" picked

  # #741: a card's Edit opens the project's settings, no longer the old New / Edit project dialog.
  @issue-741
  Scenario: Edit on a project card opens the project's settings, not the project dialog
    Given the app is open
    When I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    Then the settings of the project "demo-app" are open
    And the project dialog is not shown

  # #742: the Remove project dialog offers "Also delete the folder <path>", unticked. Unticked, Remove only takes
  # the project off the list (the folder stays, as before); ticked, it deletes the folder too. The demo project's
  # folder is in the scenario's scratch workspace, checked on the disk.
  @issue-742
  Scenario: Removing a project without the folder option keeps its folder on the disk
    Given the app is open
    When I open "Projects" in the sidebar
    And I choose Remove on the project "demo-app" in the Projects screen
    Then the Remove project dialog offers to also delete the folder of "demo-app", unticked
    When I confirm the Remove project dialog
    Then the Projects screen no longer lists the project "demo-app"
    And the folder of the project "demo-app" is still on the disk

  @issue-742
  Scenario: Removing a project with "Also delete the folder" ticked deletes its folder
    Given the app is open
    When I open "Projects" in the sidebar
    And I choose Remove on the project "demo-app" in the Projects screen
    And I tick "Also delete the folder" in the Remove project dialog
    And I confirm the Remove project dialog
    Then the Projects screen no longer lists the project "demo-app"
    And the folder of the project "demo-app" is gone from the disk
