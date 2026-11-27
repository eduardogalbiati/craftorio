Feature: The Setup and Settings choose which AI runs as the orchestrator
  The Setup's AIs step asks "Which AI do you want to use as the orchestrator?": the Claude Code and Codex
  CLI cards each have a "Use as orchestrator" radio (one radio group, exactly one checked, the keyboard
  moves it); Grok Build has no such choice, and a CLI that is not installed or not signed in cannot be
  chosen. The chosen card reads "Required", the others "Optional". Settings › Agents & CLIs shows and
  changes the same choice, for the next run. The default workflows (feature, fix, release) then run on the
  chosen provider's models; on Codex: claude-sonnet-5-5 → gpt-6.1-terra, claude-opus-5-5 → gpt-6.2-sol,
  claude-haiku-5-5 → gpt-6-luna, claude-fable-5-2 → gpt-6.2-astra (#97).

  # Assumes a simulated machine can have a CLI ready or not signed in, as CRAFTORIO_E2E_CLI_MISSING makes
  # one missing (simulation only): CRAFTORIO_E2E_CLI_READY=<id>[,<id>] (installed and signed in) and
  # CRAFTORIO_E2E_CLI_SIGNED_OUT=<id>[,<id>] (installed, not signed in), see orchestrator-ai-choice.steps.js.
  # The demo workspace has a project, so the Setup is run again from Settings and its First project step
  # opens no wizard; Finish opens the Start panel. fix.yaml's orchestrator is on claude-sonnet-5-5 and its
  # developer on claude-opus-5-5: on Codex, gpt-6.1-terra and gpt-6.2-sol.
  @issue-97
  Scenario: Picking Codex as the orchestrator in the Setup runs a simulated fix on Codex's models
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Connect your AIs" step
    And the Setup's AIs step asks "Which AI do you want to use as the orchestrator?"
    And the Setup's orchestrator choice is one radio group of Claude Code and Codex CLI
    And the Setup's orchestrator is "Claude Code"
    When I move the Setup's orchestrator choice to "Codex CLI" with the keyboard
    Then the Setup's orchestrator is "Codex CLI"
    And the Setup marks "Codex CLI" as required
    And the Setup marks "Claude Code" as optional
    When I go to the Setup's next step
    And I go to the Setup's next step
    And I finish the Setup
    And I choose the workflow "Fix" in the Start panel
    And I start a simulated run with the task "Fix the /health endpoint returning 500"
    Then the Run screen's "Orchestrator" session runs on "codex" with the model "gpt-6.1-terra"
    And the Run screen's "Developer" session runs on "codex" with the model "gpt-6.2-sol"

  # Codex is installed but not signed in (CRAFTORIO_E2E_CLI_SIGNED_OUT=codex); Claude Code is ready.
  @issue-97
  Scenario: A Codex that is not signed in cannot be chosen, and Grok Build offers no orchestrator choice
    Given the app is open on a machine where "Claude Code" is ready and "Codex CLI" is not signed in
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Connect your AIs" step
    And the Setup reads "Not signed in" for "Codex CLI"
    And the Setup's "Codex CLI" cannot be chosen as the orchestrator
    And the Setup's orchestrator is "Claude Code"
    And the Setup marks "Claude Code" as required
    And the Setup marks "Codex CLI" as optional
    And the Setup's "Grok Build" card offers no orchestrator choice

  # Assumes the choice in Agents & CLIs is saved when it changes (no Save button), like the Setup's own
  # choices; leaving Settings and coming back reads it from the engine's settings again.
  @issue-97
  Scenario: Settings › Agents & CLIs shows the orchestrator choice and keeps a change to Codex
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    Then the orchestrator in Agents & CLIs is "Claude Code"
    When I choose "Codex CLI" as the orchestrator in Agents & CLIs
    Then the orchestrator in Agents & CLIs is "Codex CLI"
    When I open "Home" in the sidebar
    And I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    Then the orchestrator in Agents & CLIs is "Codex CLI"
