Feature: Gates the on-call Supervisor answers
  At an escalation gate (test_failed in the Feature workflow) the Supervisor on call answers by itself
  only with the gate's recommended answer or an answer that does not merge or push (retry, stop).
  Any other answer is left to the owner: the gate waits, and shows the Supervisor's recommendation and
  its reason. A gate the Supervisor crossed says so on the Run screen (who answered, the answer, why)
  and in the morning summary, in the interface language (#124).

  # The runs are seeded (fronts/build/features/steps/supervisor-gates.steps.js, whose header gives the
  # event shapes): a Supervisor decision needs an LLM, which the E2E suite never runs. The test_failed
  # gate offers "Continue to the build anyway" (continue, goes on to the build and the merge) and "Stop
  # the run" (stop, the workflow's recommendation for a red suite; nothing is merged).
  # "sgw00124" is still running in another app, waiting at the gate: the Supervisor would have answered
  # continue, against the recommended stop, so it left the gate to the owner.

  @issue-124
  Scenario: The Supervisor leaves a Continue against the recommended Stop to me: the gate waits with its recommendation and reason
    Given the app is open
    And the demo project has a Feature run "sgw00124" waiting at its test gate, where the Supervisor would answer "continue" against the recommended "stop" because "The failing test is outside the change; the build can go on."
    When I open "Runs" in the sidebar
    And I search the runs for "sgw00124"
    And I open the chat of the run "sgw00124" from the list
    Then the run's test gate waits for an answer
    And the run's test gate shows the Supervisor's recommendation "Continue to the build anyway" with the reason "The failing test is outside the change"
    And the run's test gate was not answered by the Supervisor

  @issue-124
  Scenario: A gate the Supervisor answered with its recommended choice shows on the Run screen who answered, the answer and why
    Given the app is open
    And the demo project has a finished Feature run "sga00124" whose test gate the Supervisor answered with the recommended "stop" because "The same test failed in both rounds; a third round would fail the same way."
    When I open "Runs" in the sidebar
    And I search the runs for "sga00124"
    And I view the run "sga00124" from the list
    And I switch the run to its details
    Then the Run screen shows the test gate answered by the Supervisor with "Stop the run"
    And the Supervisor's answer to the test gate on the Run screen gives the reason "The same test failed in both rounds"

  # The run "sgn00124" is a real run (simulated runs never count in the Night watch) of last night's
  # watch. Its reason is the Supervisor's own text, written in the interface language; the line's
  # labels (the answer, who answered) come from the catalogs: pt-BR "Parar a run" (engine.test_failed_stop).
  @issue-124
  Scenario: In Português (Brasil), the morning summary lists the gate the Supervisor crossed last night with its reason
    Given the app is open
    And the Night watch ended 2 hours ago
    And the demo project has a real Feature run "sgn00124" from last night whose test gate the Supervisor answered with the recommended "stop" because "O mesmo teste falhou nas duas rodadas; uma terceira falharia igual."
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I reload the app
    And I open "Início" in the sidebar
    Then the morning summary lists the test gate answered by the Supervisor with "Parar a run"
    And the Supervisor's answer in the morning summary gives the reason "O mesmo teste falhou nas duas rodadas"
    And the open screen shows none of these English texts:
      | Stop the run            |
      | The supervisor answered |
      | answered by             |
