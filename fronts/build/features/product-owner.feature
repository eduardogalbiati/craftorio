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

  # #609: the simulated plan answer proposes to split #15, to place #9 in the epic "Run reports" and to
  # create the epic "Ui" (#16, #10). Only the clicked proposal's button works (busy, disabled) while
  # its request is in flight; the other proposals stay clickable. The requests are held so they stay
  # in flight while the scenario checks.
  @issue-609
  Scenario: Placing issues in an epic leaves the other proposals clickable
    Given the app is open
    And applying the Product Owner's proposals takes a while
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    When I click "Place in epic" on the Product Owner's proposal for the epic "Run reports"
    Then "Place in epic" on the proposal for the epic "Run reports" shows it is working and cannot be clicked again
    And "Create epic" on the proposal for the new epic "Ui" can still be clicked
    And "Split" on the split card of "Run safety: one app per workspace" can still be clicked

  @issue-609
  Scenario: Splitting an issue leaves the epic proposals clickable
    Given the app is open
    And applying the Product Owner's proposals takes a while
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    When I click "Split" on the split card of "Run safety: one app per workspace"
    Then "Split" on the split card of "Run safety: one app per workspace" shows it is working and cannot be clicked again
    And "Place in epic" on the proposal for the epic "Run reports" can still be clicked
    And "Create epic" on the proposal for the new epic "Ui" can still be clicked

  @issue-609
  Scenario: While the Product Owner answers, its earlier proposals cannot be applied
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    Given the Product Owner's next answer takes a while
    When I ask the Product Owner "Which issues should go first?"
    Then every split and epic button of the Product Owner's answer is disabled while it answers
