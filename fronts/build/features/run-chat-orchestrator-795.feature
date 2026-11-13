Feature: The run's Chat shows the orchestrator working
  A step with no agent (a suite, the E2E suite, the red check, ...) is run by the orchestrator. While
  it runs, the run's Chat shows an orchestrator message naming the step and what it runs, that it is
  working (the elapsed time and the step's timeout); the message expands to the tail of the step's
  log with a link to the whole log, and once the step ends it becomes its outcome (passed, or failed
  with the count). The agents' messages stay as they are.

  # What these scenarios stand on (#795):
  # - A simulated Feature run (features/support/workflows.js) with Validation left Automatic goes on
  #   past Develop and the review to "Run suite (Unit)" (step `suite`) without a gate.
  # - A simulated suite step is instant today, so its running state cannot be watched. The scenarios
  #   use a new E2E hook of the simulation (only when MULTIAGENT_SIMULATION_ONLY=1, like the
  #   onboarding's MULTIAGENT_E2E_ONBOARDING_* hooks): MULTIAGENT_E2E_SUITE_DELAY_MS=<ms> with
  #   MULTIAGENT_E2E_SUITE_DELAY_STEP=<step id> keeps that simulated suite step's round running that
  #   long, its log header already written (packages/engine/engine/suite-step.js mock branch), before
  #   its simulated result. See fronts/build/features/steps/run-chat-orchestrator.steps.js.
  # - The failed outcome comes from the simulation's mockSequences.suite (suite-step.js mockSuite
  #   "fail": 1 failing test), passed to run:start the way agent-providers.feature does.

  @issue-795
  Scenario: The suite's orchestrator message shows it working while it runs, then its result, next to the agents' messages
    Given the app is open where the simulated "Run suite (Unit)" step takes 20 seconds
    When I start a simulated run with the task "Add a /health endpoint"
    And I switch the run to its chat
    Then the run chat shows the orchestrator's message for "Run suite (Unit)" while it runs
    And the orchestrator's message for "Run suite (Unit)" names what it runs, "npm test"
    And the orchestrator's message for "Run suite (Unit)" shows its elapsed time going up and its timeout
    Then once it ends, the orchestrator's message for "Run suite (Unit)" shows that it passed
    And the "run chat steps" shows the step "Develop"

  @issue-795
  Scenario: The orchestrator's message expands to the tail of the step's log, with a link to the whole log
    Given the app is open where the simulated "Run suite (Unit)" step takes 20 seconds
    When I start a simulated run with the task "Add a /health endpoint"
    And I switch the run to its chat
    Then the run chat shows the orchestrator's message for "Run suite (Unit)" while it runs
    When I expand the orchestrator's message for "Run suite (Unit)"
    Then the orchestrator's message for "Run suite (Unit)" shows the tail of its log with "npm test"
    And the orchestrator's message for "Run suite (Unit)" links to the step's whole log
    Then once it ends, the orchestrator's message for "Run suite (Unit)" shows that it passed
    And the orchestrator's message for "Run suite (Unit)" shows the tail of its log with "pass 42"

  @issue-795
  Scenario: A failed suite's orchestrator message says it failed, with the number of failing tests
    Given the app is open
    When I start a simulated Feature run with the task "Add a /health endpoint" whose "Run suite (Unit)" fails once
    And I switch the run to its chat
    Then once it ends, the orchestrator's message for "Run suite (Unit)" shows that it failed with 1 failing test
