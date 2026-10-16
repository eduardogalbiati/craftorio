Feature: The expanded run card
  A run's row in the shared run list (Workflows › Runs, Projects › Project), expanded, shows two
  columns: what the run produced (Produced first, Show all for its process files, chips by
  category, "n of m" in its head) and its repository (the branch and its state, the run's commits
  and a "Review changes" button that opens the changes viewer).

  # Assumes the demo workspace's run "-res00225" (scripts/screenshot.js demoArtifactRuns: result.md,
  # a screenshot, test-results.json and review-report.md produced; handoffs/developer-1.md,
  # decisions.tsv and logs/develop-1.log process files) and the simulated changes of every run
  # (simulateChannels: two commits on main, b7e1c2d "Retry with exponential backoff (review fixes)"
  # and 4f0a9e3 "Settings: defaults when the file is missing", 7 files).
  @issue-289
  Scenario: An expanded run opens on what it produced, beside its commits
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open "Runs" in the sidebar
    And I search the runs for "res00225"
    And I expand the run "res00225" in the list
    Then the run card's artifacts show "Produced"
    And the run card counts its produced artifacts out of all of them
    And the run card lists the artifact "result.md"
    And the run card does not list the artifact "develop-1.log"
    When I filter the run card's artifacts by "Tests"
    Then the run card lists the artifact "test-results.json"
    And the run card does not list the artifact "result.md"
    And the run card's repository is on the base "main"
    And the run card lists 2 commits
    And the run card lists the commit "b7e1c2d" "Retry with exponential backoff (review fixes)"
    And the run card lists the commit "4f0a9e3" "Settings: defaults when the file is missing"

  # A run that produced nothing: its logs and its handoff note are process files, behind Show all
  @issue-289
  Scenario: A run with only process files says so, and Show all reveals them
    Given the app is open
    And the demo workspace gains a finished run "prc00289" that only has logs and a handoff note
    When I open "Runs" in the sidebar
    And I search the runs for "prc00289"
    And I expand the run "prc00289" in the list
    Then the run card's artifacts say "Nothing produced yet"
    When I show all the run card's artifacts from its empty state
    Then the run card's artifacts show "Show all"
    And the run card lists the artifact "develop-1.log"
    And the run card lists the artifact "developer-1.md"

  @issue-289
  Scenario: Review changes opens the changes viewer on the run's commits
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open "Runs" in the sidebar
    And I search the runs for "res00225"
    And I expand the run "res00225" in the list
    And I review the run card's changes
    Then the changes viewer opens

  # #409: the card's actions are only "◆ Send to supervisor" and "Open run" (plus "Resume from step…"
  # on a resumable run: res00225 succeeded, so not here); Open run opens the Run screen on Details
  @issue-409
  Scenario: An expanded run offers only Send to supervisor and Open run, and Open run shows its details
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open "Runs" in the sidebar
    And I search the runs for "res00225"
    And I expand the run "res00225" in the list
    Then the run card's actions are "Send to supervisor" and "Open run"
    And the run card offers none of "Open logs", "Ask the supervisor", "Watch with the supervisor", "Open chat", "View run" and "Open in Analytics"
    When I click the run card's "Open run"
    Then the Run screen shows the run "res00225" on its Details tab

  # #409: no model call until the person sends: the drawer opens with the run attached, nothing asked
  @issue-409
  Scenario: Send to supervisor opens the Supervisor's drawer with the run attached
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open "Runs" in the sidebar
    And I search the runs for "res00225"
    And I expand the run "res00225" in the list
    And I click the run card's "Send to supervisor"
    Then the Supervisor chat opens as a drawer on the right
    And the Supervisor chat has the run "res00225" attached
    And the Supervisor chat has not answered anything
