Feature: The owner sees the checks found in a project before a run, and can change them or turn them off
  After each developer commit a run checks the project's own rules: the workflow's `check_command`, else the
  `check` script, else the linter and the type checker the project itself configures (#50). What was found
  shows before any run, in the project's settings (its page) and in the Start panel, for Fix as well as
  Feature; the owner's change in the project's settings wins, and "off" runs none.
  The demo project "demo-app" (features/support/app.js) gets a `lint` and a `typecheck` script and no
  `check` script. No run is started here: what the step runs is covered by the engine's tests.

  @issue-50
  Scenario: The project's settings show the checks found, and the owner's change is what the Start panel shows
    Given the app is open
    And the demo project has a lint script and a typecheck script, and no check script
    When I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    Then the settings of the project "demo-app" are open
    And the project settings show the checks found "npm run lint" and "npm run typecheck"
    When I change the project's check commands to "npm run typecheck"
    And I save the project settings
    And I choose Start workflow on the project page
    Then the Start panel shows the check "npm run typecheck"
    And the Start panel does not show the check "npm run lint"

  @issue-50
  Scenario: The Start panel of Fix shows the checks found before the run starts
    Given the app is open
    And the demo project has a lint script and a typecheck script, and no check script
    When I open the Start panel
    And I choose the workflow "Fix" in the Start panel
    Then the Start panel shows the check "npm run lint"
    And the Start panel shows the check "npm run typecheck"

  @issue-50
  Scenario: Checks turned off in the project's settings show as off in the Start panel
    Given the app is open
    And the demo project has a lint script and a typecheck script, and no check script
    When I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    And I turn off "Run the project's checks" in the project settings
    And I save the project settings
    Then the project settings show "Run the project's checks" turned off
    When I choose Start workflow on the project page
    Then the Start panel says the project's checks are off
    And the Start panel does not show the check "npm run lint"
