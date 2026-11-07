Feature: Local preview confirmation
  Run App at a gate runs the project's local preview. A command the repository declares
  (.multiagent/local-preview.yaml) is the repository's code, not the owner's: before it runs the
  first time, the confirmation shows everything it would run (the install, the command and the
  environment variables) and marks it as coming from the repository.

  # The declaration is written into the demo project's folder: a simulated run makes no worktree and
  # works in that folder, so its "Developer check" gate (Validated mode, `local_preview: true`) reads it.
  # The confirmation popover is data-testid="run-app-confirm"; inside it run-app-confirm-install,
  # run-app-confirm-command, run-app-confirm-env (one entry per variable, NAME=value) and
  # run-app-confirm-source (data-source="repo" | "project" | "workflow", its text naming the repository).
  @issue-481
  Scenario: Run App asks before running a command the repository declares, showing its install, command and env
    Given the app is open
    And the demo project's repository declares a local preview with the install "npm ci", the command "npm run dev" and the env "PORT=4173, NODE_OPTIONS=--require ./hook.js"
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I click Run App on the gate card
    Then the Run App confirmation shows the install "npm ci"
    And the Run App confirmation shows the command "npm run dev"
    And the Run App confirmation shows the env "PORT=4173"
    And the Run App confirmation shows the env "NODE_OPTIONS=--require ./hook.js"
    And the Run App confirmation marks the command as coming from the repository

  @issue-481
  Scenario: Cancelling the Run App confirmation runs nothing and asks again next time
    Given the app is open
    And the demo project's repository declares a local preview with the install "npm ci", the command "npm run dev" and the env "PORT=4173"
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I click Run App on the gate card
    And I cancel the Run App confirmation
    Then no local preview is running for the run
    And the gate card is still in view with its choices enabled
    When I click Run App on the gate card
    Then the Run App confirmation shows the command "npm run dev"
    And the Run App confirmation marks the command as coming from the repository
