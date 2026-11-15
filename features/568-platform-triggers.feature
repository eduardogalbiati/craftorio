Feature: Runs start from git platform events, by rules the repository declares
  A repository lists `triggers:` in its `.multiagent/project.yaml`: an issue labelled "ready", an
  "@orchestrator" comment on a pull request or a failed CI run on main starts the workflow the rule
  names. The owner turns triggers on per project in Settings (off by default), and the project page
  shows the rules, the last event seen and the runs the triggers started. A rule naming a workflow the
  project does not have is reported on the project page and ignored.

  # The project's workflows are "feature" and "fix" (on the project and in the manifest); each table row
  # is one rule of the manifest's `triggers:` list (features/steps/platform-triggers.steps.js writes it).
  # Settings › Execution gets a "Platform triggers" group with one switch per project.
  @issue-568
  Scenario: Turned on in Settings, the project page shows the repository's trigger rules
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares these triggers:
      | event                                   | workflow |
      | issue labelled ready                    | feature  |
      | @orchestrator comment on a pull request | fix      |
      | failed CI on main                       | fix      |
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the platform triggers of "shop-api"
    And I open "Projects" in the sidebar
    And I open the project "shop-api" from the Projects screen
    Then the project's triggers are on
    And the project's triggers show the rule "issue labelled ready → feature"
    And the project's triggers show the rule "@orchestrator comment on a pull request → fix"
    And the project's triggers show the rule "failed CI on main → fix"
    And the project's triggers show the last event seen and the runs they started

  @issue-568
  Scenario: Triggers are off until the owner turns them on, and the project page says so
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares these triggers:
      | event                | workflow |
      | issue labelled ready | feature  |
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the platform triggers of "shop-api" are off
    When I open "Projects" in the sidebar
    And I open the project "shop-api" from the Projects screen
    Then the project's triggers are off
    And the project's triggers show the rule "issue labelled ready → feature"

  @issue-568
  Scenario: A rule naming a workflow the project does not have is reported as ignored
    Given the app is open
    And the workspace has a project "shop-api" whose repository declares these triggers:
      | event                | workflow    |
      | issue labelled ready | feature     |
      | failed CI on main    | deploy-prod |
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the platform triggers of "shop-api"
    And I open "Projects" in the sidebar
    And I open the project "shop-api" from the Projects screen
    Then the project's triggers show the rule "issue labelled ready → feature"
    And the project's triggers report the rule for "failed CI on main" as ignored, the project having no workflow "deploy-prod"
