Feature: Installing a repository's dependencies without running their scripts
  A dependency install runs the packages' install scripts: code from the repository and from its
  dependencies. Each project has the setting "Install dependencies without running their scripts"
  (the install then skips those scripts). It is off by default for a project of your own, and
  suggested on at the first run of a repository cloned from the Backlog or Discovery. A run's start
  log event names the commands it is about to run from the repository (the install, the check script,
  the detected test command), so the run's recording shows them.
  The demo project "demo-app" (features/support/app.js) is a project of the user's own, not cloned
  from the Backlog or Discovery; its folder holds a package.json (an npm project).

  @issue-472
  Scenario: A project of your own installs with its dependencies' scripts until you turn the setting on, and the setting is kept
    Given the app is open
    When I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    Then the project settings show "Install dependencies without running their scripts" turned off
    When I turn on "Install dependencies without running their scripts" in the project settings
    And I save the project settings
    And I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    Then the project settings show "Install dependencies without running their scripts" turned on

  @issue-472
  Scenario: A run's start log names the commands it runs from the repository
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    When I open the run details' "Events" tab
    Then the run's events name the commands it runs from the repository, including "npm"
