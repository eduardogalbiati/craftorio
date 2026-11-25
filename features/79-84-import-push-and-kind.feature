Feature: An imported repository can push, is named after its folder and is not taken for a backend when it holds only documents
  Importing a repository says, before the wizard ends, when the clone cannot push and what to run to fix it
  (`gh auth setup-git`), with a button that runs it; a run whose CI step opened no pull request says so on its
  "CI failed" gate, with the reason, instead of "CI on  did not pass" (#79). A repository imported from a folder
  on this computer is cloned under its own folder's name ("eslint-js", not "repos-eslint-js"), and a repository
  that holds only a README and a LICENSE is not shown as "Backend (no UI)" but as documentation, or as not
  detected so that the owner chooses (#84).

  # E2E hook the developer adds (simulation only, as CRAFTORIO_E2E_REPO_PUSH of #738): CRAFTORIO_E2E_GIT_PUSH=0
  # makes the clone's push check fail as git does without credentials (gh says the owner may push, git push
  # --dry-run is refused), and the simulated `gh auth setup-git` of the warning's button fixes it.
  @issue-79
  Scenario: Importing a repository the clone cannot push to says so before the end, with the command to run and a button
    Given the app is open where git cannot push to the repositories I import until its credentials are set up
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "push-79"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    And the wizard warns that the clone cannot push and says to run "gh auth setup-git"
    And the push warning offers a button to set up git's credentials
    When I set up git's credentials from the push warning
    Then the wizard no longer warns that the clone cannot push

  # E2E hook the developer adds (simulation only): CRAFTORIO_E2E_CI_NO_PR=<reason> makes a simulated run's CI step
  # answer that it opened no pull request (no PR URL, CI failed for an infra reason, the reason as its log), so
  # the run stops at the "CI failed" gate.
  @issue-79
  Scenario: A run whose CI step opened no pull request says on its gate that no PR was opened, and why
    Given the app is open where a simulated run's CI step opens no pull request because "the branch could not be pushed"
    When I open the Start panel
    And I choose the workflow "feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the gate card of the step "CI failed" waits for my approval
    And the gate card says "no PR was opened: the branch could not be pushed"
    And the gate card does not say "did not pass"

  @issue-84
  Scenario: A repository imported from a folder on this computer is cloned under its own folder's name
    Given the app is open
    And a local git repository in the folder "repos/eslint-js" is ready to import
    When I open the project wizard
    And I choose the other source "Any git URL" in the wizard
    And I type the local repository's folder path in the wizard
    Then the wizard says the repository will be cloned into the folder "eslint-js"
    And the wizard does not say "repos-eslint-js"
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the workspace has the repository cloned into the folder "eslint-js"

  @issue-84
  Scenario: A repository with only a README and a LICENSE is not shown as a backend
    Given the app is open
    And a local git repository with only a README and a LICENSE is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "docs-84"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "docs-84" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's Project type is not "Backend (no UI)"
    And the review's Project type reads documentation or asks me to choose one
