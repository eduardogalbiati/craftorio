Feature: Agent providers per run, and their fallbacks
  The Start panel (and the Assign dialog, a roadmap item's Edit) lists, under "Agents", each agent of
  the chosen workflow with its provider, model and effort (the workflow's values as defaults); a
  change applies to that run only. When an agent's provider runs out of credits or hits a usage limit,
  the engine falls back to the next provider/model of the agent's fallback list (an `agent.fallback`
  event with from, to and reason): the run chat and the run's agents table show which provider/model
  answered each turn and every fallback with its reason, and a notification tells the owner. With no
  fallback left the run fails as before, with the provider's message.

  # feature's "Reviewer" runs on claude, claude-opus-5-5, effort high; its "Developer" on claude,
  # claude-opus-5-5 (the workflow's defaults). Validation "Validated" stops the run at its
  # "Developer check" gate right after Develop (#777: features/support/workflows.js).
  @issue-262
  Scenario: The Start panel lists the workflow's agents with their defaults, and a change applies to that run only
    Given the app is open
    When I choose the workflow "feature" in the Start panel
    Then the Start panel's agent "Reviewer" runs on "claude" with the model "claude-opus-5-5" and the effort "high"
    And the Start panel's agent "Developer" runs on "claude" with the model "claude-opus-5-5"
    When I set the Start panel's agent "Developer" to "codex" with the model "gpt-6-luna"
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I switch the run to its chat
    Then the run chat shows that "Develop" was answered by "codex" with the model "gpt-6-luna"
    When I choose the workflow "feature" in the Start panel
    Then the Start panel's agent "Developer" runs on "claude" with the model "claude-opus-5-5"

  # A simulated run (no model) started like the Start panel starts one, with the developer moved to
  # codex for this run (fallback: claude, claude-opus-5-5) and the simulation scenario
  # mockSequences.usage_limits: { develop: 1 }: the first develop turn answers with Codex's
  # usage-limit message, so the engine falls back and the turn is answered by claude.
  @issue-262
  Scenario: An agent whose provider hit its usage limit falls back to the next provider, and the owner is told
    Given the app is open
    And a simulated AI Development run is open whose "developer" on "codex · gpt-6-luna" hits its usage limit once and falls back to "claude · claude-opus-5-5"
    When I switch the run to its chat
    Then the run chat shows the fallback of "Develop" from "codex · gpt-6-luna" to "claude · claude-opus-5-5" with the reason "usage limit"
    And the run chat shows that "Develop" was answered by "claude" with the model "claude-opus-5-5"
    When I open "Runs" in the sidebar
    And I expand the run I started in the list
    Then the run's agents table shows "Developer" on "claude" with the model "claude-opus-5-5"
    And the run's agents table shows the fallback of "Developer" from "codex · gpt-6-luna" with the reason "usage limit"
    When I open the notifications from the header bell
    Then a notification says that "Developer" fell back from "codex" to "claude" because of the "usage limit"

  # The run "-lim00262" is seeded finished as the engine writes it today: the developer, on codex with
  # no fallback, got Codex's usage-limit message and the run failed with it (no agent.fallback event).
  @issue-262
  Scenario: With no fallback left, the run fails with the provider's message
    Given the app is open
    And the demo project has a finished AI Development run "lim00262" whose developer on "codex · gpt-6-luna" hit "You've hit your usage limit. Upgrade to Plus to continue using Codex" with no fallback left
    When I open "Runs" in the sidebar
    And I search the runs for "lim00262"
    Then the run list row of "lim00262" shows the status "Failed" with the id "failed"
    When I open the chat of the run "lim00262" from the list
    Then the run chat ends with the failure "You've hit your usage limit. Upgrade to Plus to continue using Codex"
    And the run chat shows no fallback

  # #312: Settings › Agents & CLIs lists each provider's accounts in order (name, config folder, enabled),
  # next to the Fallbacks editor. The workspace starts with one Claude account, "Claude A"; the new
  # account's folder is empty, so it is not signed in yet.
  @issue-312
  Scenario: The owner adds a second Claude account and sees how to log it in
    Given the app is open
    And the workspace has the "claude" account "Claude A"
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    Then the "claude" accounts read "Claude A"
    When I add the "claude" account "Claude B" on a new empty folder
    Then the new account shows the command that logs "claude" in on its folder, then "/login"
    And the new account shows "Not signed in"
    And the accounts say that the owner must follow each provider's terms for using more than one account
    When I save the Agents & CLIs settings
    Then the "claude" accounts read "Claude A", then "Claude B"
    And the "claude" account "Claude B" is enabled

  # A simulated run (no model) with the Claude accounts "Claude A" then "Claude B" and the simulation
  # scenario mockSequences.usage_limits: ["claude@Claude A"]: every turn on Claude A answers with
  # Claude's usage-limit message, so the turn moves to Claude B and the run goes on to its gate.
  @issue-312
  Scenario: A turn whose Claude account hit its usage limit moves to the next Claude account
    Given the app is open
    And a simulated AI Development run is open where the "claude" account "Claude A" hits its usage limit and "Claude B" is next
    Then a gate card waits for my approval
    When I switch the run to its chat
    Then the run chat says a turn moved to "Claude B" because "Claude A" hit its limit
    And the run did not move to another provider than "claude"

  # Both Claude accounts hit their usage limit and Claude has no fallback chain: the run waits for
  # credits instead of failing or switching provider.
  @issue-312
  Scenario: With no account and no fallback left, the run waits for credits
    Given the app is open
    And a simulated AI Development run is open where both "claude" accounts "Claude A" and "Claude B" hit their usage limit, with no fallback
    When I switch the run to its chat
    Then the run shows it is waiting for "claude" credits
    And the run has not failed
    And the run did not move to another provider than "claude"
