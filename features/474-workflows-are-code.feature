Feature: Workflows, skills and seeds are code
  A workflow, a skill or a seed runs commands and prompts agents with tools: it is code, not data.
  The Workflows screen says so, and the app warns once, the first time a workflow, skill or seed that
  is not bundled with the app is imported or saved (one confirmation per file, by its fingerprint,
  like Run App's local preview confirmation). Bundled ones never warn.

  @issue-474
  Scenario: The Workflows screen says workflows, skills and seeds are code to install only when trusted
    Given the app is open
    When I open "Definitions" in the sidebar
    Then the Workflows screen is on its "Definitions" tab
    And the Workflows screen notes that workflows, skills and seeds are code, to install only ones you trust

  # Assumes a workflow file copied into the workspace's workflows folder (not bundled, never confirmed)
  # stands for one imported from someone else; the Builder opens it editable.
  @issue-474
  Scenario: Saving a workflow that is not bundled warns once that it is code, and confirming saves it
    Given the app is open
    And the workspace's workflows folder has a workflow "shared-retrospective.yaml" that is not bundled
    When I open "Builder" in the sidebar
    And I open the workflow "shared-retrospective.yaml" in the builder
    And I set the builder's description to "Reviews a finished run, shared by a colleague"
    And I save the workflow in the builder
    Then a warning says workflows, skills and seeds are code, to install only ones you trust
    And the workflow file "shared-retrospective.yaml" does not hold "Reviews a finished run, shared by a colleague"
    When I confirm the code warning
    Then the workflow file "shared-retrospective.yaml" holds "Reviews a finished run, shared by a colleague"

  @issue-474
  Scenario: After confirming once, saving the same workflow again does not warn again
    Given the app is open
    And the workspace's workflows folder has a workflow "shared-retrospective.yaml" that is not bundled
    When I open "Builder" in the sidebar
    And I open the workflow "shared-retrospective.yaml" in the builder
    And I set the builder's description to "First edit"
    And I save the workflow in the builder
    And I confirm the code warning
    Then the workflow file "shared-retrospective.yaml" holds "First edit"
    When I set the builder's description to "Second edit"
    And I save the workflow in the builder
    Then the workflow file "shared-retrospective.yaml" holds "Second edit"
    And no code warning shows
