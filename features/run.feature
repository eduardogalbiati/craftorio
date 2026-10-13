Feature: Runs and gates
  A simulated run of the demo project, started from the Start panel, stops at its human gates.

  @issue-222 @smoke
  Scenario: A simulated run starts and reaches a gate
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    And a gate card waits for my approval

  @issue-222 @smoke
  Scenario: The gate card shows its summary and its buttons
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the gate card shows its summary and its buttons

  @issue-203
  Scenario: The Start panel offers the test options as pills
    Given the app is open
    When I open the Start panel
    Then "Unit tests" offers "Write and run", "Run existing" and "Off"
    And "E2E tests" offers "Off", "Write" and "Write and run"
    When I pick "Run existing" for "Unit tests"
    Then "Run existing" is selected for "Unit tests"

  @issue-203 @issue-216
  Scenario: The run shows its test options as pills
    Given the app is open
    When I open the Start panel
    And I pick "Run existing" for "Unit tests"
    And I pick "Off" for "E2E tests"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run shows the pill "Unit tests: Run existing"
    And the run shows the pill "E2E tests: Off"

  @issue-286
  Scenario: The Start panel of AI Development (local hero) offers the developer's effort next to the developer's model
    Given the app is open
    When I open the Start panel
    And I choose the workflow "ai-development-local-hero" in the Start panel
    Then the field "Developer effort" comes right after "Developer model"
    And "Developer effort" offers the choices "default", "low", "medium", "high" and "xhigh"
    And "Default" is selected for "Developer effort"

  @issue-340
  Scenario: The Start panel offers Rust as a project language
    Given the app is open
    When I open the Start panel
    And I choose the workflow "software-development" in the Start panel
    Then the field "Language" offers "Rust"
    And the field "Language" offers "JavaScript"

  # Assumes the demo workspace (scripts/screenshot.js, demoRoadmapRuns) gets a finished run whose id
  # ends in "-run00233": its develop attempt 1/2 timed out, its cost estimated from the stream's model calls
  @issue-233
  Scenario: A run with a timed-out attempt marks its estimated cost
    Given the app is open
    When I open "Home" in the sidebar
    And I open the "Analytics" tab of Home
    And I open the "Run" Analytics tab
    And I pick the run "run00233" in Analytics
    Then the run's total cost in Analytics is marked as estimated
    And the cost of the agent "developer" in Analytics is marked as estimated
    When I open the run from Analytics
    Then the run's total cost is marked as estimated

  # Assumes the demo workspace gets an old run (recorded before #233) whose id ends in "-old00233":
  # its develop attempt was stopped and no cost was recorded for it
  @issue-233
  Scenario: An old run's stopped attempt shows its cost as not recorded
    Given the app is open
    When I open "Home" in the sidebar
    And I open the "Analytics" tab of Home
    And I open the "Run" Analytics tab
    And I pick the run "old00233" in Analytics
    And I open the run from Analytics
    Then the run's "developer" session shows "cost not recorded"

  @issue-183
  Scenario: A human gate opens the Oracle with the gate as context
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I click the gate's "Interact with Oracle" button
    Then the Oracle drawer opens
    And the gate card is still in view with its choices enabled
    And the Oracle's question box shows a context chip naming the gate's run and step
    And the Oracle suggests "What was implemented, in plain words?", "Does it cover every task of the issue?", "What could break?" and "Should I approve or ask for changes?"

  @issue-183
  Scenario: The gate's context chip can be removed from the Oracle's question box
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I click the gate's "Interact with Oracle" button
    And I remove the Oracle's context chip
    Then the Oracle's question box has no context chip
    And the gate card is still in view with its choices enabled

  # The simulated Oracle answers with a fixed text and never proposes "Ask for changes" text, so the
  # "Use this text" card has no deterministic E2E path: this scenario checks the gate stays pending
  @issue-183
  Scenario: Asking the Oracle about a gate never answers the gate
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I click the gate's "Interact with Oracle" button
    And I ask the Oracle the suggested question "What could break?"
    Then the Oracle shows a simulated answer
    And a gate card waits for my approval
    And the gate card is still in view with its choices enabled

  # ---- #288: the chat of a run interrupted at a gate ------------------------------------------------
  # The run "-int00288" is seeded as the app closed it: develop done, then the "Developer check" gate
  # asked for an answer, no summary and no live owner (the app reads it as interrupted).

  @issue-288
  Scenario: The chat of a run interrupted at a gate says where it stopped and offers Resume
    Given the app is open
    And the demo project has a run "int00288" interrupted at the gate "Developer check"
    When I open "Runs" in the sidebar
    And I search the runs for "int00288"
    And I open the chat of the run "int00288" from the list
    Then the run chat notes "Interrupted at Developer check"
    And the run chat does not say "Waiting for an answer."
    And the run chat offers a Resume button

  @issue-288
  Scenario: Resume in the chat of an interrupted run opens the resume dialog on the stopped step
    Given the app is open
    And the demo project has a run "int00288" interrupted at the gate "Developer check"
    When I open "Runs" in the sidebar
    And I search the runs for "int00288"
    And I open the chat of the run "int00288" from the list
    And I click Resume in the run chat
    Then the resume dialog opens with the step "Developer check" preselected

  # ---- #301: the Warm Up step of AI Development (local hero) ----------------------------------------
  # A read-only agent step "Warm Up" (step warm_up, agent mapper) maps the code before Develop. It is
  # an agent step like the others: no new screen.

  # A simulated run of ai-development-local-hero goes acceptance tests, red check, Warm Up, Develop,
  # then stops at its "Developer check" gate
  @issue-301
  Scenario: A simulated AI Development run shows Warm Up right before Develop, run by the mapper
    Given the app is open
    When I choose the workflow "ai-development-local-hero" in the Start panel
    And I pick "Validated" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the run's steps show "Warm Up" right before "Develop"
    And the run's step "Warm Up" is run by the agent "Mapper"
    When I switch the run to its chat
    Then the "run chat steps" shows the step "Warm Up"

  # The run "-wup00301" is seeded finished: its Warm Up failed (the mapper crashed), Develop ran
  # after it, and the run succeeded
  @issue-301
  Scenario: When Warm Up fails, the run goes on to Develop
    Given the app is open
    And the demo project has a finished AI Development run "wup00301" whose Warm Up failed
    When I open "Runs" in the sidebar
    And I search the runs for "wup00301"
    Then the run list row of "wup00301" shows the status "Succeeded" with the id "success"
    When I open the chat of the run "wup00301" from the list
    Then the run chat says that "Warm Up" failed
    And the run chat shows the step "Develop" after the failure of "Warm Up"

  # ---- #304: the affected suite of AI Development (local hero) --------------------------------------
  # The suite step runs with scope affected: the affected test files first, then (when they pass) the
  # whole suite once. The run "-sui00304" is seeded finished: its suite ran test/roadmap.test.js
  # ("imports src/roadmap.js", log logs/suite-1.log), then the whole suite (logs/suite-1-full.log).
  # "The run report" is read here as Analytics › Run (its Suite rounds table).

  @issue-304
  Scenario: The suite step's card shows the affected scope, why each test file ran, and the full run's log
    Given the app is open
    And the demo project has a finished AI Development run "sui00304" whose suite ran the affected tests, then the whole suite
    When I open "Runs" in the sidebar
    And I search the runs for "sui00304"
    And I view the run "sui00304" from the list
    Then the "Suite" step card shows that the affected tests ran
    And the "Suite" step card explains the selection with "imports src/roadmap.js"
    And the "Suite" step card links the log of the whole suite's run

  @issue-304
  Scenario: The run report shows the suite's scope and selection
    Given the app is open
    And the demo project has a finished AI Development run "sui00304" whose suite ran the affected tests, then the whole suite
    When I open "Runs" in the sidebar
    And I search the runs for "sui00304"
    And I open the run "sui00304" in Analytics from the list
    Then the run report's suite round shows that the affected tests ran
    And the run report's suite round explains the selection with "imports src/roadmap.js"

  # ---- #320: how each session's next turn starts (Claude's cache lives 1 hour) ---------------------
  # The runs "-wrm00320" and "-cld00320" are seeded stopped at the "Developer check" gate, their times
  # written relative to now. A seeded run's gate is not live (the app reads it as interrupted, with no
  # gate card), so its agents table is checked in Workflows › Runs; the gate card's Continue line is
  # checked on a live simulated run, whose turns have just ended (no session can be cold yet).

  @issue-320
  Scenario: The agents table says which sessions resume warm, which start fresh from a note, and which are closed
    Given the app is open
    And the demo project has a run "wrm00320" stopped at the gate "Developer check" whose persistent "reviewer" last turn ended 18 minutes ago with a context of 60000 tokens
    And its "developer" works from a handoff note, its last turn ended 25 minutes ago
    And its "mapper" session is closed
    When I open "Runs" in the sidebar
    And I search the runs for "wrm00320"
    And I open the row of the run "wrm00320" in the list
    Then the next turn of the run's "reviewer" session shows "warm" and "min left"
    And the next turn of the run's "developer" session shows "fresh from note"
    And the next turn of the run's "mapper" session shows "—"

  @issue-320
  Scenario: A persistent session idle for more than an hour resumes cold, with its context size
    Given the app is open
    And the demo project has a run "cld00320" stopped at the gate "Developer check" whose persistent "reviewer" last turn ended 180 minutes ago with a context of 140000 tokens
    When I open "Runs" in the sidebar
    And I search the runs for "cld00320"
    And I open the row of the run "cld00320" in the list
    Then the next turn of the run's "reviewer" session shows "cold" and "140K"

  @issue-320
  Scenario: The gate card says what Continue re-reads, and that nothing resumes cold right after the turns
    Given the app is open
    When I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    And the gate card's Continue line says "Continue"
    And the gate card's Continue line does not say "cold"

  # ---- #369: a Claude turn on a model the installed Claude Code does not know ----------------------
  # Claude Code prices a turn on a model it does not know (stderr `[claude-code:unrecognized_model]`)
  # at Opus rates; the app prices it from its tokens instead, or shows the cost as unknown when it has
  # no price for the model. The runs are seeded finished (features/steps/turn-costs.steps.js): the
  # session snapshot's cost_estimate { source, model, cli_version, cli_cost_usd }.

  @issue-369
  Scenario: A turn on a model Claude Code does not know shows its cost estimated from tokens, in the run list and on the Run screen
    Given the app is open
    And the demo project has a finished AI Development run "est00369"
    And its "developer" turn ran on "claude-haiku-5-5", a model Claude Code "2.3.1" does not know, priced from its tokens at 0.42 while the CLI said 2.84
    And its "reviewer" turn ran on the known model "claude-opus-5-5" at 1.37
    When I open "Runs" in the sidebar
    And I search the runs for "est00369"
    And I open the row of the run "est00369" in the list
    Then the cost of the run's "developer" session shows "0.42"
    And the cost of the run's "developer" session is marked "estimated from tokens" because "Claude Code 2.3.1 does not know claude-haiku-5-5"
    And the cost of the run's "reviewer" session has no estimate mark
    When I view the run "est00369" from the list
    Then the cost of the run's "developer" session shows "0.42"
    And the cost of the run's "developer" session does not show "2.84"
    And the cost of the run's "developer" session is marked "estimated from tokens" because "Claude Code 2.3.1 does not know claude-haiku-5-5"
    And the cost of the run's "reviewer" session has no estimate mark

  @issue-369
  Scenario: A turn on a model with no price shows its cost as unknown, never the CLI's number
    Given the app is open
    And the demo project has a finished AI Development run "unk00369"
    And its "developer" turn ran on "claude-haiku-5-5", a model Claude Code "2.3.1" does not know and has no price for, while the CLI said 2.84
    When I open "Runs" in the sidebar
    And I search the runs for "unk00369"
    And I open the row of the run "unk00369" in the list
    Then the cost of the run's "developer" session does not show "2.84"
    And the cost of the run's "developer" session is marked "no price for claude-haiku-5-5" because "Claude Code 2.3.1 does not know claude-haiku-5-5"
    When I view the run "unk00369" from the list
    Then the cost of the run's "developer" session does not show "2.84"
    And the cost of the run's "developer" session is marked "no price for claude-haiku-5-5" because "Claude Code 2.3.1 does not know claude-haiku-5-5"
