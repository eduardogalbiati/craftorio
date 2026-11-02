Feature: A project's workflows, as cards on its Overview
  The Workflows block of a project's Overview (Projects › <project> › Overview) shows only the
  workflows added to the project, one card each (name, category, variant, a short description, a
  "Default" badge on the project's default, and the actions "Make default" and "Remove"), instead of
  every installed workflow as a checkbox. "+ Add a workflow" opens a dialog with the installed
  workflows not on the project yet, by category, with a search; picking one adds its card.
  A project with no workflow says new roadmap items use the Settings default.
  The demo project "demo-app" (features/support/app.js) starts with no workflow of its own.

  # The block's baseline (features/__screenshots__, created on purpose with
  # npm run test:e2e:update -- --grep @visual)
  @issue-729 @visual
  Scenario: The project's page shows only the project's workflows, as cards, its default one badged
    Given the app is open in the dark theme
    And the demo project has the workflows "feature" and "fix", with "feature" as its default
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    Then the project's Workflows block shows exactly the cards "feature" and "fix"
    And the project's Workflows block lists no workflow as a checkbox
    And the workflow card "feature" has the "Default" badge
    And the workflow card "fix" has no "Default" badge
    And the workflow card "fix" shows the category "Build" and offers "Make default" and "Remove"
    And the project's Workflows block looks like the baseline "project-workflows-cards-dark.png"

  @issue-729
  Scenario: Adding a workflow picks it from the installed ones not on the project yet
    Given the app is open
    And the demo project has the workflows "feature" and "fix", with "feature" as its default
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I click "+ Add a workflow" in the project's Workflows block
    Then the add-a-workflow dialog offers "issue-tracker" and "refactor"
    And the add-a-workflow dialog does not offer "feature" or "fix"
    When I search "refac" in the add-a-workflow dialog
    Then the add-a-workflow dialog offers "refactor"
    And the add-a-workflow dialog does not offer "issue-tracker"
    When I pick "refactor" in the add-a-workflow dialog
    Then the add-a-workflow dialog is closed
    And the project's Workflows block shows exactly the cards "feature", "fix" and "refactor"
    And the workflow card "feature" has the "Default" badge
    When I reload the app
    And I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    Then the project's Workflows block shows exactly the cards "feature", "fix" and "refactor"

  @issue-729
  Scenario: A project with no workflow says new items use the Settings default and offers to add one
    Given the app is open
    And the demo project has no workflow
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    Then the project's Workflows block says "No workflow yet: new roadmap items use the Settings default"
    And the project's Workflows block shows no workflow card
    And the project's Workflows block offers "+ Add a workflow"
