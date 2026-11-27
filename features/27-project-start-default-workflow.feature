Feature: Start workflow on a project opens the Start panel on the project's default workflow
  A project's "Start workflow" ("Iniciar workflow" in Portuguese), on its page or on its Projects card, opens the
  Start panel on the project's default workflow, the one its page shows as "Default workflow" ("Workflow padrão"),
  for a created project as for an imported one. Given a project and no workflow, the project's default comes
  before the last workflow used; a workflow asked for by name, such as the Backlog's "New issue…" ("Nova issue…")
  on the issue workflow, is still the one chosen (#27).

  # Until #27 the panel opened on analyze-project, the first workflow by name, right after the onboarding.
  @issue-27
  Scenario: On a new workspace, a created project's page starts on its default workflow, feature
    Given the app is open on a new workspace
    When I skip the Setup and confirm
    And I choose to create a project from Home
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Garden Log" is open
    And the project page's default workflow is "feature"
    When I choose Start workflow on the project page
    Then the Start panel opens on the workflow "feature"

  # The demo workspace remembers "feature" as the last workflow used; the imported repository's manifest makes
  # "test-backfill" the project's default, so only the project's default can choose it.
  @issue-27
  Scenario: An imported project's card on Projects starts on the project's default, not on the last workflow used
    Given the app is open
    And a local git repository whose manifest has "test-backfill" as its default workflow is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "default-27"
    And I go to the next step of the wizard
    And I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "default-27" is open
    And the project page's default workflow is "test-backfill"
    When I open "Projects" in the sidebar
    And I choose Start workflow on the project "default-27" in the Projects screen
    Then the Start panel opens on the workflow "test-backfill"

  @issue-27
  Scenario: The Backlog's New issue still opens the Start panel on the issue workflow
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares its own workflow "shop-triage", with "feature" for Features and "fix" in Remote mode for Fixes
    And the backlog of "shop-api" has the open issue "Export orders as CSV"
    When I open "Backlog" in the sidebar
    And I choose the project "shop-api" in the header
    And I choose "New issue…" on the Backlog
    Then the Start panel opens on the workflow "issue"
