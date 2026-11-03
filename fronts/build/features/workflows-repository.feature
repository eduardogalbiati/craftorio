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

  # #554: a repository's copy of a workflow no longer shadows the owner's edited workspace copy of the same
  # name; both cards say which copy a project's run uses. The workspace's "issue" is the seeded
  # bundled copy; the repository declares its own copy under the same name.
  @issue-554
  Scenario: The owner's edited workspace copy runs instead of the repository's copy of the same workflow
    Given the app is open
    And the workspace holds an edited copy of the workflow "issue"
    And the project's repository declares its own copy of the workflow "issue"
    When I open "Definitions" in the sidebar
    Then the workspace card of the workflow "issue" says a project's run uses the workspace copy with the owner's models
    And the repository card of the workflow "issue" says it does not run for this project

  @issue-554
  Scenario: Without an edited workspace copy the repository's copy runs at its commit
    Given the app is open
    And the project's repository declares its own copy of the workflow "issue"
    When I open "Definitions" in the sidebar
    Then the repository card of the workflow "issue" says a project's run uses it at the repository's latest commit

  @issue-554
  Scenario: A project that prefers the repository's workflows runs the repository's copy over the owner's edited one
    Given the app is open
    And the workspace holds an edited copy of the workflow "issue"
    And the project's repository declares its own copy of the workflow "issue"
    When I open "Projects" in the sidebar
    And I choose Edit on the project "demo-app" in the Projects screen
    And I turn on "Prefer the repository's workflows" in the project settings
    And I save the project settings
    And I open "Definitions" in the sidebar
    Then the repository card of the workflow "issue" says a project's run uses it at the repository's latest commit
    And the workspace card of the workflow "issue" says it does not run for this project
