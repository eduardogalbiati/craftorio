Feature: The roadmap card says how a run ends
  Every roadmap item whose workflow merges or opens a PR shows, before it runs, how its run ends: a PR,
  a local merge or a fork, following the item's own mode whatever the project's default is. When that
  differs from the default, the badge explains why, and the last station of the pipeline says the same.

  # What these scenarios stand on (#792):
  # - The project's default is its default workflow in the mode of its pick (feature, remote),
  #   so an item in Remote mode ends as the default does and one in Local mode differs.
  # - The demo's stages are replaced by one stage of planned, simulated items, and the roadmap is left
  #   planned: nothing starts, so what the card shows comes from the item's mode and not from a run.
  # - The interface is set to Portuguese: the issue gives these labels in pt-BR, and the English ones
  #   are the developer's choice. The steps also read the badge's data-ending and the station's data-step.
  # - `feature` and `fix` both follow the item's mode: one scenario each.

  @issue-792
  Scenario: An item in Remote mode says it opens a PR and its pipeline ends in the PR
    Given the app is open
    And the demo project's default workflow ends in the "remote" mode
    And the roadmap plans the item "Item that opens a PR" on the workflow "feature" in "remote" mode
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Item that opens a PR" shows the ending "Abre um PR/MR"
    And the last station of the roadmap item "Item that opens a PR" is "Abrir PR"
    And the pipeline of the roadmap item "Item that opens a PR" shows no "Merge" station

  @issue-792
  Scenario: An item in Local mode on a project that defaults to PRs says it merges locally, explains why, and keeps Merge
    Given the app is open
    And the demo project's default workflow ends in the "remote" mode
    And the roadmap plans the item "Item that merges here" on the workflow "fix" in "local" mode
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Item that merges here" shows the ending "Merge local"
    And the ending of the roadmap item "Item that merges here" explains how it differs from the default
    And the last station of the roadmap item "Item that merges here" is "Merge"
