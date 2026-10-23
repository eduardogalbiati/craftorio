Feature: Workflows a repository declares
  A repository declares its workflows in its manifest: bundled ones by name, its own copies by file.
  The Workflows screen lists them in their category sections with a "repository @ <short sha>" badge,
  read-only. A repository workflow stays off until the owner accepts it for that commit. A malformed
  manifest is reported on the Workflows screen and the project runs on the workspace's workflows.
  Each category section says in one line what it is for.

  # Assumes the demo project's folder made a git repository with one commit holding the manifest and
  # the repository's own copy of a workflow (category "intake").
  @issue-485
  Scenario: A repository's own workflow is listed under its category, off until the owner accepts it
    Given the app is open
    And the project's repository declares its own workflow "repo-triage" in the "Intake" category
    When I open "Definitions" in the sidebar
    Then the workflow "repo-triage" is listed in the "Intake" section with a repository badge at the repository's latest commit
    And the workflow "repo-triage" is not accepted
    When I accept the workflow "repo-triage"
    Then the workflow "repo-triage" is accepted

  @issue-485
  Scenario: A malformed repository manifest is reported and the workspace's workflows are still listed
    Given the app is open
    And the project's repository has a malformed workflows manifest
    When I open "Definitions" in the sidebar
    Then the Workflows screen reports that the repository's manifest is malformed
    And the workflow "software-development" is listed on the Workflows screen

  @issue-485
  Scenario: Each workflow category explains in one line what it is for
    Given the app is open
    When I open "Definitions" in the sidebar
    Then the "Solo" section explains "local merge"
    And the "Team" section explains "pull requests, CI and CD"
    And the "Intake" section explains "issues"
    And the "Release" section is shown with its explanation
