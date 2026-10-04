Feature: Readable step names
  Every screen names a workflow's steps by their display name (the step's `display` in the
  workflow YAML, else its id made readable: "acceptance_tests" -> "Acceptance tests"); the step id
  stays only in the element's tooltip.

  # The demo roadmap's item #16 runs "-run00016" (scripts/screenshot.js demoRoadmapRuns), in code
  # review; the scenario moves it on to "acceptance_tests", a step in none of its workflow's groups,
  # so the card names the step itself (software-development-local-hero has no such step: the
  # readable fallback "Acceptance tests")
  @issue-245
  Scenario: A roadmap card's progress names its step readably, the step id in its tooltip
    Given the app is open
    And the running demo run "run00016" has moved on to the step "acceptance_tests"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the "roadmap progress" shows the step "Acceptance tests"
    And no visible text in the "roadmap progress" shows a snake_case step id
    And the "roadmap progress" tooltip contains "acceptance_tests"

  # The demo run "-run00016" is in code review: its strip's last chip says what runs now
  @issue-245
  Scenario: The run list's progress strip names the steps readably, the step ids in their tooltips
    Given the app is open
    When I open "Runs" in the sidebar
    And I search the runs for "run00016"
    Then the "run list progress" shows the step "Code review"
    And no visible text in the "run list progress" shows a snake_case step id
    And the "run list progress" tooltip contains "code_review"

  @issue-245
  Scenario: The run chat's step tags name the steps readably, the step ids in their tooltips
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I switch the run to its chat
    Then the "run chat steps" shows the step "Develop"
    And no visible text in the "run chat steps" shows a snake_case step id
    And the "run chat steps" tooltip contains "develop"
