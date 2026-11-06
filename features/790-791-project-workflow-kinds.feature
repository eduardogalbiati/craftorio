Feature: The project decides which workflow runs, by default and for each kind of issue
  The default development workflow comes from the project and its repository's manifest, not from a
  global setting. Each project also names a workflow for Features and one for Fixes, and the Product
  Owner gives each issue its kind and that kind's workflow, with a badge, a summary of the plan by
  kind and a Feature | Fix | Other control ("Outro" in Portuguese) on each recommendation.

  # The manifest lists "feature" first, so only its `default` can make "test-backfill" the default. A
  # repository imported without a provider has no synced backlog: the scenario gives it one, because the
  # Product Owner reads it. A request of eight words or more gets a simulated draft at once.
  @issue-790
  Scenario: A project imported from a repository with a default shows it as the default in the Product Owner's select
    Given the app is open
    And a local git repository whose manifest has "test-backfill" as its default workflow is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "default-790"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page shows the Next steps card
    Given the backlog of "default-790" has the open issue "Show the order total"
    When I click "Open the PO" in the Next steps card
    Then the Product Owner's chat is open on "Register an issue" for the project "default-790"
    When I ask the Product Owner "Let customers export their orders as a CSV file from the orders screen"
    Then the Product Owner answers
    And the Product Owner's workflow select shows "test-backfill" as the default

  @issue-790
  Scenario: Settings no longer has a default development workflow
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the General settings show a "Language" group
    And Settings has no "Default development workflow" control

  # The simulated plan has one recommendation per issue here: the bug and the issue share no area. The
  # manifest's map gives Fixes `fix` in Remote mode, what protects a repository whose main takes no push.
  @issue-791
  Scenario: A plan with a bug and a feature shows each one's kind, and the bug gets the project's Fix workflow in Remote mode
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares its own workflow "shop-triage", with "feature" for Features and "fix" in Remote mode for Fixes
    And the backlog of "shop-api" has the open bug "Checkout crashes on an empty cart" and the open issue "Export orders as CSV"
    When I open "Backlog" in the sidebar
    And I choose the project "shop-api" in the header
    And I open the Product Owner
    And I click the suggested question "Analyze the backlog and propose runs"
    Then the Product Owner answers
    And the plan sums up its runs as "1 Feature · 1 Fix"
    And the plan lists the issue "Checkout crashes on an empty cart" under "Fix"
    And the plan lists the issue "Export orders as CSV" under "Feature"
    And the recommendation for "Checkout crashes on an empty cart" shows the "Fix" badge
    And the recommendation for "Export orders as CSV" shows the "Feature" badge
    And the recommendation for "Checkout crashes on an empty cart" runs the workflow "Fix" in "Remote" mode
    And the recommendation for "Export orders as CSV" runs the workflow "Feature"
    And the recommendation for "Checkout crashes on an empty cart" offers "Feature", "Fix" and "Other", with "Fix" selected

  # The table is every workflow of the app that takes a task, and the repository's own one
  @issue-791
  Scenario: The kind control swaps a recommendation's workflow, and Other lists every workflow
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares its own workflow "shop-triage", with "feature" for Features and "fix" in Remote mode for Fixes
    And the backlog of "shop-api" has the open bug "Checkout crashes on an empty cart" and the open issue "Export orders as CSV"
    When I open "Backlog" in the sidebar
    And I choose the project "shop-api" in the header
    And I open the Product Owner
    And I click the suggested question "Analyze the backlog and propose runs"
    Then the Product Owner answers
    When I choose "Fix" on the recommendation for "Export orders as CSV"
    Then the recommendation for "Export orders as CSV" runs the workflow "Fix" in "Remote" mode
    And the recommendation for "Export orders as CSV" shows the "Fix" badge
    When I choose "Other" on the recommendation for "Export orders as CSV"
    Then the workflow list of the recommendation for "Export orders as CSV" offers
      | workflow      |
      | feature       |
      | fix           |
      | refactor      |
      | release       |
      | test-backfill |
      | shop-triage   |
    When I pick "Test backfill" from the workflow list of the recommendation for "Export orders as CSV"
    Then the recommendation for "Export orders as CSV" runs the workflow "Test backfill"
    And the recommendation for "Export orders as CSV" offers "Feature", "Fix" and "Other", with "Other" selected

  @issue-791
  Scenario: The project page shows the Feature and Fix workflows, and the Product Owner follows a change
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares its own workflow "shop-triage", with "feature" for Features and "fix" in Remote mode for Fixes
    And the backlog of "shop-api" has the open bug "Checkout crashes on an empty cart" and the open issue "Export orders as CSV"
    When I open "Projects" in the sidebar
    And I open the project "shop-api" from the Projects screen
    Then the project's "Feature" workflow is "feature"
    And the project's "Fix" workflow is "fix"
    When I change the project's "Fix" workflow to "Test backfill"
    And I open "Backlog" in the sidebar
    And I choose the project "shop-api" in the header
    And I open the Product Owner
    And I click the suggested question "Analyze the backlog and propose runs"
    Then the Product Owner answers
    And the recommendation for "Checkout crashes on an empty cart" runs the workflow "Test backfill"
