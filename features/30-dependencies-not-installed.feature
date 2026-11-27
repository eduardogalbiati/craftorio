Feature: A project whose dependencies were never installed says so once, plainly, and lets you try again
  On a freshly imported repository nobody ran npm ci in, the project's rule checks (`npm run check`)
  cannot run. The run stops once, without sending the developer back, at a gate that says in one line,
  in the interface language, that the dependencies are not installed and where to run npm ci; its
  "Try again" ("Tentar de novo") reruns the checks, and once the dependencies are there the run goes
  on. Importing such a repository offers to install its dependencies on the project's Next steps card.
  A rule that really fails on the code still goes back to the developer, as before (not covered here).
  The demo project "demo-app" (features/support/app.js) is an npm project; the runs are simulated and
  start in English (the Start panel's steps read English labels), the language is switched at the gate.

  # The run picks "Validated" so it would stop after the developer at "Developer check" (#777); here it
  # stops before that, at the rule checks, on the missing dependencies.
  @issue-30
  Scenario: A run on a project without installed dependencies stops once at a gate that says so in one line, in Portuguese, and offers "Tentar de novo"
    Given the app is open
    And the demo project has a check script and a lockfile, but its dependencies were never installed
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the gate card says the project's dependencies are not installed
    And the gate card offers "Try again"
    And the gate card does not offer "Continue to the review anyway"
    When I switch the run to its chat
    Then the developer was not sent back to fix the rule checks
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I go back to the run waiting at a gate from the sidebar
    Then the gate card says in one line "as dependências do projeto não estão instaladas: rode npm ci em" and the project's folder
    And the gate card shows no stack trace
    And the gate card offers "Tentar de novo"

  @issue-30
  Scenario: Once the dependencies are installed, "Try again" reruns the checks and the run goes on
    Given the app is open
    And the demo project has a check script and a lockfile, but its dependencies were never installed
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the gate card says the project's dependencies are not installed
    When I install the dependencies in the folder the gate card names
    And I choose "Try again" on the gate card
    Then the gate card of the step "Developer check" waits for my approval
    And no gate card says the project's dependencies are not installed

  @issue-30
  Scenario: Importing a repository with a lockfile and no installed dependencies offers to install them
    Given the app is open
    And a local git repository with a lockfile and no installed dependencies is ready to import
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "deps-30"
    And I go to the next step of the wizard
    And I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "deps-30" is open
    And the project page shows the Next steps card
    And the Next steps card offers to install the dependencies with "npm ci"
