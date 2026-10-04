Feature: Roadmap statuses, done items, filters and run timers
  The demo project's roadmap (scripts/screenshot.js demoRoadmap): stage 1 "Stability first" is done
  (its run is months old); stage 2 "Tonight" has a running run (#16 "Keyboard focus is lost after
  closing a dialog", in code review for 52 minutes), a run waiting at a gate (#15), a failed run
  (#13 "Run reports"), a start refused before any run (#14 "Workspace safety and recovery") and two
  items done a few hours ago (#9, #12); stages 3 to 5 are planned. Its 10 items all run the
  software-development-local-hero workflow except stage 4 (test-batch) and stage 5
  (software-development).

  # ---- #266: readable statuses, the run chip on the roadmap card ---------------------------------------

  @issue-266
  Scenario: A running roadmap item shows the run chip with a pulsing "Running" and opens its run
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run chip reading "Running"
    And the run chip of the roadmap item "Keyboard focus is lost after closing a dialog" names the workflow "Software development local hero"
    And the "Running" status of the roadmap item "Keyboard focus is lost after closing a dialog" pulses
    When I click the run chip of the roadmap item "Keyboard focus is lost after closing a dialog"
    Then the run screen shows the run "run00016"

  @issue-266
  Scenario: A failed run links to its run, a start that failed before any run offers Retry and Skip instead
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Run reports" shows a run chip reading "Failed"
    And the roadmap item "Workspace safety and recovery" shows the status "Failed to start"
    And the status of the roadmap item "Workspace safety and recovery" is not a link
    And the roadmap item "Workspace safety and recovery" shows the error "already has work from a cancelled run"
    And the roadmap item "Workspace safety and recovery" offers Retry and Skip, enabled
    When I click the run chip of the roadmap item "Run reports"
    Then the run screen shows the run "run00013"

  @issue-266
  Scenario: Statuses read as words on the roadmap and in the run list, their ids kept aside
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then every status on the roadmap reads as a capitalised label, not its id
    When I open "Runs" in the sidebar
    And I search the runs for "run00013"
    Then the run list row of "run00013" shows the status "Failed" with the id "failed"

  # ---- #267: "+n done" expands only its own stage ------------------------------------------------------

  @issue-267
  Scenario: The green "+2 done" chip of a stage shows its done items without switching the roadmap to All
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 2 offers the chip "+2 done", folded
    When I click the done chip of stage 2
    Then stage 2 offers the chip "Hide 2 done", expanded
    And stage 2 shows 2 done items
    And the roadmap's item switch is on "Planned"
    And the roadmap does not show the done item "Crash when the workspace folder is renamed"
    When I click the done chip of stage 2
    Then stage 2 offers the chip "+2 done", folded
    And stage 2 shows 0 done items

  @issue-267
  Scenario: Expanding one stage's done items leaves the other stages folded
    Given the app is open
    And stage 3 of the roadmap also has an item done tonight
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 3 offers the chip "+1 done", folded
    When I click the done chip of stage 2
    Then stage 2 shows 2 done items
    And stage 3 offers the chip "+1 done", folded
    And stage 3 shows 0 done items

  # ---- #268: date filter, Planned | All, infinite scroll, the header count -----------------------------
  # Assumption: an item's date is its run's (planned items without a run always pass the date filter);
  # stage 1's run is months old, so only Total reaches it.

  @issue-268
  Scenario: The roadmap opens on the planned work of the last 24 hours
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's date filter is "Last 24 hours"
    And the roadmap's date filter offers "Last 24 hours", "Last 2 days", "Last 3 days", "Last week", "Last 15 days", "Last month" and "Total"
    And the roadmap's item switch is on "Planned"
    And the roadmap offers no "Show all" checkbox
    And the roadmap header counts the items shown out of all, for "last 24 hours"
    And the roadmap shows the running item "Keyboard focus is lost after closing a dialog"
    And the roadmap does not show the done item "Export a run report as Markdown"

  @issue-268
  Scenario: All shows the done and skipped items, Total reaches older work, Planned hides them again
    Given the app is open
    And the roadmap item "Dark scrollbars in the terminal dock" was skipped
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap does not show the skipped item "Dark scrollbars in the terminal dock"
    When I switch the roadmap to "All"
    Then the roadmap shows the done item "Export a run report as Markdown"
    And the roadmap does not show the done item "Crash when the workspace folder is renamed"
    When I set the roadmap's date filter to "Last week"
    Then the roadmap header counts the items shown out of all, for "last week"
    When I set the roadmap's date filter to "Total"
    Then the roadmap shows the done item "Crash when the workspace folder is renamed"
    And the roadmap shows the skipped item "Dark scrollbars in the terminal dock"
    When I switch the roadmap to "Planned"
    Then the roadmap does not show the done item "Crash when the workspace folder is renamed"
    And the roadmap does not show the skipped item "Dark scrollbars in the terminal dock"

  @issue-268
  Scenario: A long roadmap loads more items as I scroll, with a "Loading…" row
    Given the app is open
    And the roadmap has a stage of 200 planned items
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows fewer than 200 items at first
    When I scroll the roadmap to its end until nothing more loads
    Then a "Loading…" row showed while more items came
    And the roadmap shows as many items as its header counts

  # ---- #272: the live run timer, a fix round ------------------------------------------------------------
  # The fix round is reached by appending a code review → develop return to the running demo run's
  # events (as the engine records it), then reloading the app.

  @issue-272
  Scenario: A running item shows a live timer under its progress ring, within its estimate
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run timer under its progress ring
    And the run timer of the roadmap item "Keyboard focus is lost after closing a dialog" reads about 52 minutes
    And the run timer of the roadmap item "Keyboard focus is lost after closing a dialog" ticks
    And the run timer of the roadmap item "Keyboard focus is lost after closing a dialog" is coloured "ok"

  @issue-272
  Scenario: A run far past its estimate shows its timer as over
    Given the app is open
    And the running demo run "run00016" started 400 minutes ago
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the run timer of the roadmap item "Keyboard focus is lost after closing a dialog" is coloured "over"

  @issue-272
  Scenario: A run sent back from review to develop shows a fix round, same run, no progress drop
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I note the progress of the roadmap item "Keyboard focus is lost after closing a dialog"
    And the running demo run "run00016" goes back from code review to develop
    And I reload the app
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows "round 2"
    And the run chip of the roadmap item "Keyboard focus is lost after closing a dialog" still opens the run "run00016"
    And the progress of the roadmap item "Keyboard focus is lost after closing a dialog" has not dropped

  # ---- #279: "Update the app after this" ----------------------------------------------------------------
  # Only offered when applying merged fixes to the app applies; the demo project is not this app's
  # repository, so no card offers it, even with Self-healing on.

  @issue-279
  Scenario: A roadmap item does not offer "Update the app after this" when no project is this app's repository
    Given the app is open
    And the roadmap has a stage of 2 planned items
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn Self-healing on
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Planned item 1001" offers no "Update the app after this" switch
    And the roadmap item "Keyboard focus is lost after closing a dialog" offers no "Update the app after this" switch
