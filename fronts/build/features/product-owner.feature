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

  # #670: a signed-off spec's mockups (its images) reach the issues. "Create epic and phase issues" on
  # the item opens the Product Owner's proposal (one issue per phase of the spec), which first shows
  # which issue covers each mockup; a mockup in scope with no issue blocks the proposal, a mockup of a
  # later phase is listed as such. The spec's mockups and the phases naming them are seeded.
  @issue-670
  Scenario: Every mockup of the spec is covered by an issue and the proposal can go to the roadmap
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    And the proposal says no mockup is missing an issue
    And the proposal can be added to the roadmap

  @issue-670
  Scenario: A mockup in scope with no issue blocks the proposal
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
      | mock-4.jpg |         |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    And the proposal says "mock-4.jpg has no issue"
    And the proposal cannot be added to the roadmap

  @issue-670
  Scenario: Mockups of a later phase are listed as later phases and do not block the proposal
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-5.jpg | Later   |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
    And the proposal lists "mock-5.jpg" as a later phase
    And the proposal says no mockup is missing an issue
    And the proposal can be added to the roadmap

  # #431: the drawer's foot ("Plan with [workflow]" and the workflow's options) takes less room. The
  # main options (Mode, Unit tests, E2E tests, Screenshots) come first, under small group labels; the
  # others wait behind "Show more options". A chevron on the "Plan with" row collapses the options to
  # a one-line summary of the chosen values; the choice is remembered. AI Development, local hero's
  # defaults: Validation Automatic, E2E tests Write and run (#235). The issue's "Mode (Automatic or
  # Validated)" is the input labelled "Validation" since #630.
  @issue-431
  Scenario: The plan shows the main options first, grouped, and the others behind "Show more options"
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I switch the Product Owner to "Plan the backlog"
    And I plan with the workflow "AI Development, local hero"
    Then the plan's options show "Validation", "Unit tests", "E2E tests" and "Screenshots"
    And the plan's options do not show "Check command"
    And the plan's options are grouped under "How it runs" and "Tests"
    When I click "Show more options" in the plan's options
    Then the plan's options show "Check command"
    And the plan's options offer "Show fewer options"

  @issue-431
  Scenario: Collapsing the plan's options leaves a one-line summary, and expanding them keeps the values
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I switch the Product Owner to "Plan the backlog"
    And I plan with the workflow "AI Development, local hero"
    And I collapse the plan's options
    Then the plan's options are hidden, the "Plan with" row stays
    And the plan's summary shows "Automatic"
    And the plan's summary shows "E2E: Write and run"
    When I expand the plan's options
    Then "Automatic" is still chosen for "Validation" in the plan's options
    And "Write and run" is still chosen for "E2E tests" in the plan's options

  @issue-431
  Scenario: The Product Owner's drawer remembers the plan's options collapsed
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I switch the Product Owner to "Plan the backlog"
    And I plan with the workflow "AI Development, local hero"
    And I collapse the plan's options
    And I close the Product Owner
    And I open the Product Owner
    Then the plan's options are hidden, the "Plan with" row stays
    And the plan's summary shows "Automatic"
