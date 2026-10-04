Feature: Backlog Product Owner
  The Product Owner's drawer (Backlog › Product Owner) on the demo project, answered by the
  simulated Product Owner (no model call). The simulated answer comes fast, so the steps watch the
  drawer while it works and check what it showed then.

  @issue-234
  Scenario: A suggested question locks the pills and Ask until the answer, the text field stays free
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I watch the Product Owner's drawer
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the suggested questions, "Register an issue…" and Ask were disabled while the Product Owner worked
    And the text field stayed enabled while the Product Owner worked
    And the working line "Product Owner is working…" with its timer showed while the Product Owner worked
    And the suggested questions, "Register an issue…" and Ask are enabled again
    And the working line is gone

  @issue-234
  Scenario: Asking a typed question shows it in view and locks Ask until the answer
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I watch the Product Owner's drawer
    And I ask the Product Owner "Which issues should go first?"
    Then the Product Owner answers
    And my question "Which issues should go first?" was in view in the conversation as soon as I asked
    And the suggested questions, "Register an issue…" and Ask were disabled while the Product Owner worked
    And the suggested questions, "Register an issue…" and Ask are enabled again

  @issue-235
  Scenario: Plan mode lists the workflows by name and AI Development shows its own options
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I switch the Product Owner to "Plan the backlog"
    Then the plan's workflow choice offers "AI Development, local hero" and "Software development, local hero"
    When I plan with the workflow "AI Development, local hero"
    Then the Cost chip is hidden
    And the plan shows the workflow's options
    And "Write and run" is selected for "E2E tests"
    And the Product Owner's header says "Planning for demo-app · AI Development, local hero"

  @issue-235
  Scenario: Planning with Software development, local hero shows the Cost chip
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I switch the Product Owner to "Plan the backlog"
    And I plan with the workflow "AI Development, local hero"
    And I plan with the workflow "Software development, local hero"
    Then the Cost chip is shown
    And the Product Owner's header says "Planning for demo-app · Software development, local hero"

  # The simulated plan answer proposes to split the demo's big issue #15 (a long title, 12 tasks whose
  # text has `code` spans): its split card is the one checked
  @issue-242
  Scenario Outline: A split proposal fits in the Product Owner's drawer in a <window> window
    Given the app is open in a <size> window
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    And the split card of "Run safety: one app per workspace" fits within the drawer
    And the conversation does not scroll sideways
    And the task lines of the split card of "Run safety: one app per workspace" show no Markdown marks
    And the split card of "Run safety: one app per workspace" shows "Split" and "Edit…" inside it

    Examples:
      | window  | size     |
      | default | 1400x900 |
      | narrow  | 900x800  |
