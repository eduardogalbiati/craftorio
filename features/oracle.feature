Feature: The Oracle
  The Oracle's panel, docked on the Dashboard and a drawer on the other screens, fits the window:
  the app never shifts sideways and the panel's header stays readable, from a 900 px wide window up.

  @issue-208
  Scenario: Opening the Oracle in a narrow window does not shift the app sideways
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    Then the page has not scrolled sideways
    And the sidebar is visible

  @issue-208
  Scenario: The Oracle's header stays readable in a narrow window
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    Then the Oracle's title is readable, not covered by its header buttons

  @issue-208
  Scenario: Opening the Night watch form in a narrow window does not shift the app sideways
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Night watch" form
    Then the page has not scrolled sideways
    And the sidebar is visible

  # #244: a routine wake-up (a run finished, cancelled, interrupted; a supervisor retry or resume) is a
  # short notice written by the code (run id, status, cost), with no model call. Human gates are not
  # routine: they are unticked here so that the run's only wake-up is its end. Assumes the notice
  # carries data-testid="oracle-run-notice" (new) and shows its line without unfolding.
  @issue-244
  Scenario: A run's routine wake-up is a notice in the Oracle's chat, not a model answer
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I untick the Oracle wake-up "Human gates waiting"
    And I start a simulated run with the task "Add a /health endpoint"
    And a gate card waits for my approval
    And I stop the run
    And I open the Oracle
    Then the Oracle shows a notice for the run with the status "cancelled" and its cost
    And the Oracle did not answer the run's wake-up with a model turn

  # #244: Claude reports a resumed session's cumulative cost; the daily budget counts each turn's own
  # cost (here 4 + 4 + 4 + 4 = 16 USD, not 4 + 8 + 12 + 16 = 40 USD, against the default 20 USD limit)
  @issue-244
  Scenario: A session's cumulative cost does not pause the Oracle by budget
    Given the app is open
    And the Oracle's usage log holds one session today reporting the cumulative costs "4, 8, 12, 16"
    When I open "Backlog" in the sidebar
    And I open the Oracle
    Then the Oracle is not paused by budget
    And the Oracle's footer shows "Today $16.00 of $20.00 daily budget"
    When I ask the Oracle "Where do my tokens go?"
    Then the Oracle shows a simulated answer

  # #244: the status shows the model and whether the last turn started a fresh session or resumed it.
  # Assumes data-testid="oracle-model" and data-testid="oracle-session-mode" (new) in the panel's status.
  @issue-244
  Scenario: The Oracle's status shows its model and whether the last turn resumed the session
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Oracle
    Then the Oracle's status shows the model "Opus 5.5"
    When I ask the Oracle "Which runs failed this week, and why?"
    Then the Oracle's status shows the session "fresh"
    When I ask the Oracle "Where do my tokens go?"
    Then the Oracle's status shows the session "resumed"
    And the Oracle's status shows the model "Opus 5.5"

  # #184: on first start the Oracle's memory is seeded with the owner's standing decisions.
  # Assumes data-testid="oracle-memory" (new) on the Oracle's memory panel.
  @issue-184
  Scenario: A fresh workspace's Oracle memory holds the owner's standing decisions
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Memory" form
    Then the Oracle's memory mentions "owner's language"
    And the Oracle's memory mentions "English"
    And the Oracle's memory mentions "UI criteria"
    And the Oracle's memory mentions "test writer"
    And the Oracle's memory mentions "one app per workspace"
    And the Oracle's memory mentions "cost money"

  # #184: an edit is saved and the seed never writes over it
  @issue-184
  Scenario: The owner's edit of the Oracle memory stays after reopening it
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Memory" form
    And I add the standing decision "Night watch never merges a pull request" to the Oracle's memory
    And I save the Oracle's memory
    And I reload the app
    And I open "Backlog" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Memory" form
    Then the Oracle's memory mentions "Night watch never merges a pull request"
    And the Oracle's memory mentions "English"

  # #184: "Import" takes standing decisions from a pasted text (e.g. a Claude Code memory index).
  # Assumes the memory form has an "Import" button that shows data-testid="oracle-memory-import" (new):
  # a text box for the pasted text and its own "Import" button, which adds the decisions to the draft.
  @issue-184
  Scenario: The owner imports standing decisions from a pasted memory index
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Memory" form
    And I import into the Oracle's memory the pasted text:
      """
      # Memory index
      - [Release cadence](release-cadence.md): ship a release every second Friday
      - [Screenshots](screenshots.md): every UI pull request carries a before and after screenshot
      """
    And I save the Oracle's memory
    And I reload the app
    And I open "Backlog" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Memory" form
    Then the Oracle's memory mentions "ship a release every second Friday"
    And the Oracle's memory mentions "before and after screenshot"
    And the Oracle's memory mentions "English"
