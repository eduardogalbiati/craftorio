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

  @issue-354
  Scenario: The Architecture and Refactor tabs say what they will hold
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the "Architecture" project tab
    Then the project tab "Architecture" shows an empty state mentioning "architecture"
    When I open the "Refactor" project tab
    Then the project tab "Refactor" shows an empty state mentioning "refactor"
