Feature: A refactor item on the Roadmap ends the way its project works
  The refactor workflow takes a mode (Local, Remote (pull request), Fork + PR) as feature and fix do.
  A project set up with Remote runs its refactors with a pull request without anyone typing an input,
  and the Roadmap says so on the refactor item instead of "Merge local".

  # What these scenarios stand on (#130):
  # - "Set up with Remote" is the wizard's pick recorded on the demo project (variant remote-code), the
  #   project's mode the runs read; "with Local" is the same with local-code.
  # - The refactor item gives no input of its own: no mode is typed, so what the card shows comes from
  #   the project. The roadmap is left planned: nothing starts.
  # - The interface is set to Portuguese, as #792's scenarios: the issue names the label "Merge local"
  #   (pt-BR); the PR's label there is "Abre um PR/MR". The steps also read the badge's data-ending.
  @issue-130
  Scenario: A refactor item in a project set up with Remote shows that it opens a pull request, not "Merge local"
    Given the app is open
    And the demo project's default workflow ends in the "remote" mode
    And the roadmap plans the item "Split the click handler" on the workflow "refactor" without choosing a mode
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Split the click handler" shows the ending "Abre um PR/MR"
    And the roadmap item "Split the click handler" does not show the ending "Merge local"

  @issue-130
  Scenario: A refactor item in a project set up with Local still merges locally
    Given the app is open
    And the demo project's default workflow ends in the "local" mode
    And the roadmap plans the item "Extract the price formatter" on the workflow "refactor" without choosing a mode
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Extract the price formatter" shows the ending "Merge local"
