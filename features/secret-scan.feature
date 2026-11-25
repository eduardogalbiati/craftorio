Feature: A run looks for secrets in its own commits, and says so when it could not
  Before the code review a run scans its commits with gitleaks, which is optional: the Setup lists it
  with its install command and a run never installs it. Without it the run goes on, and its gate says
  "secrets not scanned", never that the scan passed. A project with its own scan turns it off in the
  Start panel.

  # CRAFTORIO_E2E_CLI_MISSING=gitleaks (simulation only, as for the other CLIs): the machine has no
  # gitleaks, whatever the one running the scenarios has.
  @issue-49
  Scenario: The Setup of a machine without gitleaks lists it as optional, with its install command
    Given the app is open on a new workspace of a machine without "Gitleaks"
    Then the first-run Setup is open on its "Agents" step
    And the Setup reads "Not installed" for "Gitleaks"
    And the Setup marks "Gitleaks" as optional
    And the Setup shows how to install "Gitleaks"

  # The same hook: the run's scan finds no gitleaks either. The scan comes before the owner's gate.
  @issue-49
  Scenario: A run on a machine without gitleaks goes on, and its gate says the secrets were not scanned
    Given the app is open on a machine without the "Gitleaks"
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the gate card of the step "Developer check" waits for my approval
    And the gate card says "secrets not scanned"

  @issue-49
  Scenario: The Start panel lets a project with its own scan turn the secret scan off
    Given the app is open
    When I open the Start panel
    And I choose the workflow "feature" in the Start panel
    Then the Start panel has the input "secret_scan"
    And the field "Secret scan" offers "Off"
