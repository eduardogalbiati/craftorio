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

  # ---- #269: the bar's state dot, Pause and Stop icons, the ⋮ menu, the filter row -------------------
  # The demo roadmap is paused by a refused start (a failure); the running one is set simulated, its
  # refused item skipped, so nothing real starts.

  @issue-269
  Scenario: A running roadmap shows a pulsing "Running" dot before its name, with Pause and Stop
    Given the app is open
    And the roadmap is running as a simulation
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar's state dot is "running" and reads "Running"
    And the roadmap bar's state dot pulses
    And the roadmap bar's state dot comes before "Roadmap"
    And the roadmap bar offers "Pause" with a pause icon
    And the roadmap bar's "Pause" button is amber
    And the roadmap bar offers "Stop" with a stop icon
    And the roadmap bar's "Stop" button is red
    When I click "Stop" on the roadmap bar
    Then the confirm dialog asks before it stops, with a "Stop" button
    When I press Cancel in the confirm dialog
    Then the roadmap bar's state dot is "running" and reads "Running"

  @issue-269
  Scenario: Clear lives in the roadmap's ⋮ menu, which the keyboard opens and Escape closes
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar's state dot is "paused-failed" and reads "Paused"
    And the roadmap bar offers no "Clear" button of its own
    And the roadmap's ⋮ menu button ends the roadmap bar
    When I open the roadmap's ⋮ menu with the keyboard
    Then the roadmap's menu offers "Clear", focused
    When I press Escape
    Then the roadmap's menu is closed, its ⋮ button focused
    When I open the roadmap's ⋮ menu
    And I choose "Clear" in the roadmap's menu
    Then the confirm dialog is titled "Clear the roadmap" with a "Clear" button
    When I press Cancel in the confirm dialog
    Then the roadmap shows at least 2 stages

  @issue-269
  Scenario: The roadmap's filters sit on one filter row above the bar
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's filter row holds the epic filter, the Planned and All switch, the date filter and "Group by epic"
    And the roadmap bar holds none of the filters
    And the filter row is above the roadmap bar

  # ---- #270: the alerts at the top of the page ------------------------------------------------------
  # The demo workspace has an error (the roadmap paused: "Could not start #14: …") and an info (2 commits
  # merged locally, not pushed); errors come first.

  @issue-270
  Scenario: With several alerts the roadmap's error shows first, the arrows go to the next one
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the alerts are at the top of the page, above the filter row
    And the alerts show alert 1 of at least 2
    And the shown alert is at level "error" and says "Could not start #14"
    And the shown alert offers "Retry" and "Skip"
    When I show the next alert
    Then the alerts show alert 2 of at least 2
    And the shown alert is not at level "error"
    When I show the previous alert
    Then the alerts show alert 1 of at least 2
    And the shown alert is at level "error" and says "Could not start #14"

  @issue-270
  Scenario: The Board's "Not pushed" info alert opens the push dialog
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    Then the alerts are at the top of the page, above the filter row
    When I show the alert "Not pushed"
    Then the shown alert is at level "info" and says "Not pushed"
    When I click "Push…" in the shown alert
    Then the push dialog opens, titled "Push 2 commits to origin/main"

  # ---- #271: Ask the Oracle about a failed item ------------------------------------------------------
  # Simulation only: the scenario checks the drawer, its context chip and the prefilled question, never
  # an answer (nothing is sent).

  @issue-271
  Scenario: A failed roadmap item asks the Oracle about its run, with the question prefilled
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Run reports" offers "Ask the Oracle about this failure" beside Retry and Skip
    When I click "Ask the Oracle about this failure" on the roadmap item "Run reports"
    Then the Oracle drawer opens
    And the Oracle's context chip names the run of the roadmap item "Run reports"
    And the Oracle is asked "What happened to this run, and what should I do: retry, resume from a step, skip or fix something first?"

  @issue-271
  Scenario: A running roadmap item does not offer to ask the Oracle about a failure
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run chip reading "Running"
    And the roadmap item "Keyboard focus is lost after closing a dialog" offers no "Ask the Oracle about this failure" button

  # ---- #281: Undo a removal, earlier versions ---------------------------------------------------------
  # "Dark scrollbars in the terminal dock" (#10) is the planned item of the demo roadmap's last stage.

  @issue-281
  Scenario: Removing a roadmap item can be undone from its toast
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I remove the roadmap item "Dark scrollbars in the terminal dock"
    Then a toast says "Removed #10 from the roadmap" with an "Undo" button
    And the roadmap no longer shows the item "Dark scrollbars in the terminal dock"
    When I click "Undo" in the toast
    Then the toast says "Restored"
    And the roadmap shows the item "Dark scrollbars in the terminal dock"

  @issue-281
  Scenario: The roadmap's ⋮ menu restores an earlier version
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I remove the roadmap item "Dark scrollbars in the terminal dock"
    Then the roadmap no longer shows the item "Dark scrollbars in the terminal dock"
    When I open the roadmap's ⋮ menu
    And I choose "Restore an earlier version…" in the roadmap's menu
    Then the earlier versions of the roadmap are listed, at least 1
    When I restore the most recent earlier version
    Then the roadmap shows the item "Dark scrollbars in the terminal dock"

  # ---- #286: the developer's effort in a roadmap item's Edit and on its card -------------------------
  # A planned item of a new stage is switched to the ai-development-local-hero workflow; Save writes
  # every field of the form, so an untouched effort is saved as 'default' and left off the card.

  @issue-286
  Scenario: A roadmap item's developer effort set to High in Edit shows on its card
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    Then the field "Developer effort" comes right after "Developer model"
    And "Default" is selected for "Developer effort"
    When I pick "High" for "Developer effort"
    And I save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap item "Planned item 1001" shows the input "Developer effort: High"

  @issue-286
  Scenario: A roadmap item left at the default developer effort shows no effort on its card
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "ai-development-local-hero"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Planned item 1001"
    And I save the inputs of the roadmap item "Planned item 1001"
    Then the roadmap item "Planned item 1001" shows no "Developer effort" input

  # ---- #282: the item card's bands, its Workflow band and pipeline, the stage actions menu -------------
  # "Dark scrollbars in the terminal dock" (#10) is planned in Validated mode on the software-development
  # workflow (its owner's gate is "Your check"); "Keyboard focus is lost after closing a dialog" (#16)
  # runs in Automatic mode, in code review. Stage 3 is "Reports and health", planned, with no cut line.

  @issue-282
  Scenario: A running item shows its issues, its cost and time meters, one status block and its pipeline
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows its issues, its cost and time meters and one status block
    And the issues footer of the roadmap item "Keyboard focus is lost after closing a dialog" counts "1 issue"
    And the Workflow band of the roadmap item "Keyboard focus is lost after closing a dialog" names the workflow "Software development local hero"
    And the roadmap item "Keyboard focus is lost after closing a dialog" is in "Automatic" mode
    And the pipeline of the roadmap item "Keyboard focus is lost after closing a dialog" shows done stations, then one running station
    And the pipeline of the roadmap item "Keyboard focus is lost after closing a dialog" shows no "Your check" station

  @issue-282
  Scenario: Switching a planned item between Validated and Automatic adds and removes "Your check", saved at once
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Dark scrollbars in the terminal dock" is in "Validated" mode
    And the pipeline of the roadmap item "Dark scrollbars in the terminal dock" shows the "Your check" station, waiting for me
    When I switch the roadmap item "Dark scrollbars in the terminal dock" to "Automatic" mode
    Then the pipeline of the roadmap item "Dark scrollbars in the terminal dock" shows no "Your check" station
    When I reload the app
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Dark scrollbars in the terminal dock" is in "Automatic" mode
    And the pipeline of the roadmap item "Dark scrollbars in the terminal dock" shows no "Your check" station
    When I switch the roadmap item "Dark scrollbars in the terminal dock" to "Validated" mode
    Then the pipeline of the roadmap item "Dark scrollbars in the terminal dock" shows the "Your check" station, waiting for me

  @issue-282
  Scenario: A stage's actions live in its ⋮ menu, which the keyboard opens and Escape closes
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 3 offers no "Run this stage" button outside its stage actions menu
    When I open the stage actions menu of stage 3 with the keyboard
    Then the stage actions menu's first entry is focused
    And the stage actions menu offers "Release here"
    And the stage actions menu offers "Run this stage"
    And the stage actions menu offers "Disable"
    When I press Escape
    Then the stage actions menu of stage 3 is closed, its ⋮ button focused

  # ---- #284: disable a stage ----------------------------------------------------------------------------

  @issue-284
  Scenario: Disabling a stage keeps it in place with a "Disabled" badge, and Enable brings it back
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    Then the stage actions menu entry "Disable" is the stage toggle
    When I choose "Disable" in the stage actions menu
    Then stage 3 is shown as disabled
    When I open the stage actions menu of stage 3
    Then the stage actions menu offers "Run this stage", disabled
    And the stage actions menu offers "Enable"
    And the stage actions menu entry "Enable" is the stage toggle
    When I choose "Enable" in the stage actions menu
    Then stage 3 is not shown as disabled

  @issue-284
  Scenario: A disabled stage keeps its place, its number and its cards, also after a reload
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    And I choose "Disable" in the stage actions menu
    Then stage 3 is shown as disabled
    And stage 3 shows 1 item card
    And stage 3 sits between stage 2 and stage 4
    When I reload the app
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 3 is shown as disabled
    And stage 3 shows 1 item card
    And stage 3 sits between stage 2 and stage 4

  # ---- #285: no "Update the app after this" switch ------------------------------------------------------

  @issue-285
  Scenario: No roadmap item shows an "Update the app after this" control, even with Self-healing on
    Given the app is open
    And the roadmap has a stage of 2 planned items
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn Self-healing on
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then no roadmap item shows an "Update the app after this" control
