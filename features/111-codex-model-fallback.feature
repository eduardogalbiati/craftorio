Feature: A Codex account without Codex's usual models is told which model it will run on
  With Codex as the orchestrator AI (#97), the default workflows run on gpt-6.2-astra, gpt-6.2-sol,
  gpt-6.1-terra and gpt-6-luna. An account whose model list lacks them falls back to a model it offers
  (#111): the Setup's AIs step and Settings › Agents & CLIs warn, in the interface language, that the account
  lacks those models and name the one used instead; with no usable model, Codex cannot be chosen as the
  orchestrator.

  # The account's model list is the Codex CLI's cache (<CODEX_HOME>/models_cache.json): the Given step writes
  # one offering only the listed models and opens the app with CODEX_HOME on it, Codex CLI ready
  # (CRAFTORIO_E2E_CLI_READY, orchestrator-ai-choice.steps.js). Assumes the fallback for the mapped models is
  # gpt-6-luna when the account offers gpt-6-luna, gpt-5.6-terra and gpt-5.6-luna (the only mapped model it
  # has), and that Codex stays choosable then.
  @issue-111
  Scenario: The Setup warns that the Codex account lacks Codex's models and names the one it will use
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready and the Codex account offers only "gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna"
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Connect your AIs" step
    And the Setup's Codex card warns that the account lacks Codex's models and will use "gpt-6-luna" instead
    When I move the Setup's orchestrator choice to "Codex CLI" with the keyboard
    Then the Setup's orchestrator is "Codex CLI"

  # gpt-reserve and codex-auto-review are neither mapped models nor ones a fallback can use. Assumes the
  # warning names what it prevents ("orchestrator") in English.
  @issue-111
  Scenario: A Codex account with no usable model cannot be chosen as the orchestrator in the Setup
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready and the Codex account offers only "gpt-reserve, codex-auto-review"
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Connect your AIs" step
    And the Setup's "Codex CLI" cannot be chosen as the orchestrator
    And the Setup's orchestrator is "Claude Code"
    And the Setup's Codex card warns that the account offers no model the orchestrator can run on

  # Settings' tabs re-render in Portuguese at once (#329): Agents & CLIs reads "Agentes & CLIs". The warning
  # reads in Portuguese: none of a few English words (account, instead, will, models...) outside the model
  # names.
  @issue-111
  Scenario: In Português (Brasil), Agents & CLIs shows the Codex models warning and still lets Codex be chosen
    Given the app is open on a machine where "Claude Code" and "Codex CLI" are ready and the Codex account offers only "gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the "Agentes & CLIs" settings tab
    Then Agents & CLIs warns that the Codex account lacks Codex's models and will use "gpt-6-luna" instead, in "Português (Brasil)"
    And the orchestrator in Agents & CLIs is "Claude Code"
    When I choose "Codex CLI" as the orchestrator in Agents & CLIs
    Then the orchestrator in Agents & CLIs is "Codex CLI"
