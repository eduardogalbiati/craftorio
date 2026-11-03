Feature: Setup and Projects lead to the new-project wizard
  The first-run Setup has three steps (Agents, Try it safely, First project): its Workflows step is
  gone, since the wizard chooses a project's workflows. Its last step opens the new-project wizard.
  Projects › New project, in the screen's header and in its empty state, opens the wizard too.

  # A new workspace has no project: arriving on the Setup's last step opens the wizard by itself,
  # as it opened the old New project dialog.
  @issue-643
  Scenario: The Setup has three steps without Workflows, and its last step opens the wizard
    Given the app is open on a new workspace
    Then the first-run Setup is open on its "Agents" step
    And the Setup's stepper reads "Agents", "Try it safely" and "First project"
    And the Setup's stepper has no "Workflows" step
    When I go to the Setup's next step
    And I go to the Setup's next step
    Then the project wizard is open on its first step

  @issue-643
  Scenario: New project on the Projects screen opens the wizard, from the empty state and from the header
    Given the app is open on a new workspace
    When I skip the Setup and confirm
    And I open "Projects" in the sidebar
    Then the Projects screen says there is no project yet
    When I choose New project in the Projects screen's empty state
    Then the project wizard is open on its first step
    When I close the project wizard
    And I choose New project in the Projects screen's header
    Then the project wizard is open on its first step

  # #741: a project's Edit opens the project's settings (the old dialog is gone): see the @issue-741
  # scenario in fronts/build/features/projects.feature.
