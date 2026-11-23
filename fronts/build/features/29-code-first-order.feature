Feature: A code-first Feature item runs the developer before the tests
  On the Feature workflow, the test order "Code first" (the variant "Local merge · code first") has the
  developer write the code first and the acceptance tests after it; "E2E first" keeps the tests before
  the code. The Roadmap card draws its stations in that order, and the Assign dialog of a code-first
  project does not describe the Feature workflow as tests first.

  # What these scenarios stand on (#29):
  # - The demo's stages are replaced by one stage of one planned, simulated item in Local mode and
  #   Automatic validation (no owner's gate), and the roadmap is left planned: nothing starts, so the
  #   stations come from the item's workflow and its test order, not from a run.
  # - Today a planned Feature item in Local mode shows Tests, Develop, Review, Validate, Merge.
  # - The stations are read by their data-step (the workflow's group names).
  # - The Assign dialog opens on the project's default workflow (Feature); its one-line description
  #   gets data-testid="assign-wf-desc".

  @issue-29
  Scenario: A code-first item shows Develop before Tests on its card
    Given the app is open
    And the roadmap plans the item "Code first item" on the workflow "Feature" with the test order "Code first"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the stations of the roadmap item "Code first item" are "Develop, Tests, Review, Validate, Merge"

  @issue-29
  Scenario: An E2E-first item still shows Tests before Develop on its card
    Given the app is open
    And the roadmap plans the item "E2E first item" on the workflow "Feature" with the test order "E2E first"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the stations of the roadmap item "E2E first item" are "Tests, Develop, Review, Validate, Merge"

  @issue-29
  Scenario: The Assign dialog of a code-first project does not describe the Feature workflow as tests first
    Given the app is open
    And the demo project's Feature workflow is "Local merge · code first"
    And the backlog has the open issues "Code first: a dark theme" and "Code first: export to PDF"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I select the issue "Code first: a dark theme"
    And I open the Assign dialog for the selected issues
    Then the Assign dialog has the "Feature" workflow chosen
    And the Assign dialog's workflow description does not say "Tests first"
