Feature: The run screens of a run on Codex
  A Codex turn on a ChatGPT account has no API price: its cost reads "unknown" in the interface language,
  never "$0.00", and a total mixing it with priced turns says it is partial. A skipped Rule checks step
  reads "Skipped", not "Passed". A Codex turn is tagged with its CLI and model ("Codex · gpt-6-luna"),
  not "ChatGPT", and a Codex session says once that the CLI does not show its reasoning. With the
  interface in Português (Brasil), the run panel shows no English label (#117).

  # The runs of the first two scenarios are seeded (fronts/build/features/steps/turn-costs.steps.js): a
  # Codex turn is recorded as provider codex, cost_usd null, with tokens (Codex reports no cost). Assumes
  # the demo workspace sets no price for gpt-6-luna. "the Run screen" is the total on the orchestrator's
  # session card (run-total-cost), which a real run (mock: false) has.
  @issue-117
  Scenario: A Codex turn on a ChatGPT account shows its cost as unknown, never $0.00, and the run's total says it is partial
    Given the app is open
    And the demo project has a finished real run "cdx00117"
    And its "developer" turn ran on Codex "gpt-6-luna" on a ChatGPT account, which has no API price
    And its "reviewer" turn ran on the known model "claude-opus-5-5" at 0.93
    When I open "Runs" in the sidebar
    And I search the runs for "cdx00117"
    Then the run's total cost in "the run list" says it is partial
    When I open the row of the run "cdx00117" in the list
    Then the cost of the run's "developer" session shows "unknown"
    And the cost of the run's "developer" session does not show "$0.00"
    When I view the run "cdx00117" from the list
    Then the cost of the run's "developer" session shows "unknown"
    And the cost of the run's "developer" session does not show "$0.00"
    And the run's total cost in "the Run screen" says it is partial
    When I select the run's "developer" session
    Then the selected session says once that the CLI does not show its reasoning

  # The project has no check script, linter nor type checker, so the rule checks were skipped (step
  # rule_check, output status skipped); the run chat's orchestrator message for it read "Passed".
  @issue-117
  Scenario: A skipped Rule checks step reads Skipped, and the Codex turn is tagged with its CLI and model
    Given the app is open
    And the demo project has a finished AI Development run "skp00117"
    And its "developer" turn ran on Codex "gpt-6-luna" on a ChatGPT account, which has no API price
    And its "Rule checks" step was skipped because the project has no rule checks
    When I open "Runs" in the sidebar
    And I search the runs for "skp00117"
    And I view the run "skp00117" from the list
    And I open the run's Chat tab
    Then the orchestrator's message for "Rule checks" shows that it was skipped, not passed
    And the run chat tags the "developer" agent's turn "Codex · gpt-6-luna", not "ChatGPT"

  # Codex is the orchestrator AI (#97: the Feature workflow's agents then run on Codex models); the run is
  # simulated and started in English (the Start panel's steps read English labels), "Validated" stops it
  # at a gate, the language is switched there. The run panel's terminal buttons ("Live terminal", "Open in
  # CLI", packages/ui-kit/term-dock.js), the workflow input labels ("Mode") and the next turn of a Codex
  # session ("resumes (cache lifetime unknown)", packages/shared/session-cache.js) read in Portuguese.
  @issue-117
  Scenario: In Português (Brasil), the Run screen of a Codex run shows no English labels
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I choose "Codex CLI" as the orchestrator in Agents & CLIs
    And I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I go back to the run waiting at a gate from the sidebar
    And I switch the run to its details
    And I select the run's "developer" session
    Then the open screen shows none of these English texts:
      | Live terminal          |
      | Open in CLI            |
      | Test suite             |
      | Mode                   |
      | Approve before merge   |
      | cache lifetime unknown |
      | could not be merged    |
