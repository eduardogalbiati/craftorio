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
  Scenario: A running item shows a live timer in its Time line, within its estimate
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run timer in its Time line
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
    And the roadmap bar draws no state dot and keeps "Roadmap" for assistive technology
    And the roadmap bar offers "Pause" with a pause icon
    And the roadmap bar's "Pause" button is amber
    And the roadmap bar offers "Stop" with a stop icon
    And the roadmap bar's "Stop" button is red
    When I click "Stop" on the roadmap bar
    Then the confirm dialog asks before it stops, with a "Stop" button
    When I press Cancel in the confirm dialog
    Then the roadmap bar's state dot is "running" and reads "Running"

  @issue-269 @quarantine
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
  Scenario: The roadmap's filters sit on one filter row under the bar
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's filter row holds the epic filter, the Planned and All switch, the date filter and "Group by epic"
    And the roadmap bar holds none of the filters
    And the filter row is under the roadmap bar

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
    Then the roadmap item "Run reports" offers Retry and Skip, and "Ask the Oracle about this failure" in its open row
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

  # ---- #282: the item card's bands, its Workflow band and pipeline, the stage actions menu -------------
  # "Dark scrollbars in the terminal dock" (#10) is planned in Validated mode on the software-development
  # workflow (its owner's gate is "Your check"); "Keyboard focus is lost after closing a dialog" (#16)
  # runs in Automatic mode, in code review. Stage 3 is "Reports and health", planned, with no cut line.

  @issue-282 @quarantine
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

  @issue-282 @quarantine
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
    And the stage actions menu offers "Release after this stage"
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

  # ---- #291: the shipped releases on the Roadmap ------------------------------------------------------
  # The demo workspace has no release history: the scenarios add shipped releases holding the runs of a
  # stage's done items (stage 1 "Stability first": #11, months old; stage 2 "Tonight": #9 and #12, a few
  # hours ago). Assumption: the Releases filter shows a release's stages whatever the date filter; the
  # scenario still sets "Total" first, since stage 1's run is months old.

  @issue-291
  Scenario: A shipped release shows as a "Release" block closed by a dashed line with its version
    Given the app is open
    And the project shipped the release "v0.9.1" with the done runs of stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows the block "Release v0.9.1" right after stage 2
    And the release block "v0.9.1" shows its release card
    And a dashed version line reads "v0.9.1"

  @issue-291
  Scenario: Choosing a release in the Releases filter shows only its stages, counted in the head
    Given the app is open
    And the project shipped the release "v0.9" with the done runs of stage 1
    And the project shipped the release "v0.9.1" with the done runs of stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I set the roadmap's date filter to "Total"
    And I choose the release "v0.9" in the Releases filter
    Then the roadmap shows only stage 1
    And the roadmap header counts 1 stage for the release "v0.9"

  # ---- #368: pause a stage after the current agent turn ---------------------------------------------
  # The roadmap is set running as a simulation (its refused item skipped). Stage 2's runs are seeded,
  # with no live agent turn to wait for, so the stage ends paused once the pause is asked.

  @issue-368
  # #391 renamed the stage menu's entry "Pause after current turn" to "Pause after current step";
  # #748 renamed it again to "Stop when finished".
  Scenario: Pausing a stage after the current step shows it paused, not failed, with no Retry or Skip on its items
    Given the app is open
    And the roadmap is running as a simulation
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 2
    Then the stage actions menu entry "Stop when finished" pauses the stage
    When I choose "Stop when finished" in the stage actions menu
    Then stage 2 is shown as paused, not failed
    And the roadmap bar shows "Paused"
    And the roadmap item "Keyboard focus is lost after closing a dialog" is not shown as failed
    And the roadmap item "Keyboard focus is lost after closing a dialog" offers neither Retry nor Skip

  # ---- #391: the bar's Pause menu: "Pause after this stage" or "Pause now" ------------------------------
  # The demo roadmap is replaced by two planned stages of simulated software-development-local-hero
  # items in Automatic mode (no gate): stage 1 holds "Pause item A" and "Pause item B", stage 2 holds
  # "Pause item C". One run at a time (Concurrent runs off), so B waits for a free slot while A runs.
  # Simulated turns of a few seconds (mock delay scale 1) keep a run going well past the clicks that
  # ask for the pause.

  @issue-391 @quarantine
  Scenario: Pause after this stage lets the waiting item of the stage start, then stops before the next stage
    Given the app is open with simulated turns of a few seconds
    And the roadmap has two planned stages, items A and B in stage 1 and item C in stage 2, one run at a time
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I resume the roadmap as a simulation
    Then the roadmap item "Pause item A" has started
    And the roadmap item "Pause item B" has not started
    When I click "Pause" on the roadmap bar
    Then the pause menu offers "Pause after this stage" first, with the hint "The items of stage 1 still start and finish; the next stage waits"
    And the pause menu offers "Pause now", with the hint "Nothing new starts; runs in progress go on"
    When I choose "Pause after this stage" in the pause menu
    Then the roadmap bar shows the badge "Pausing after stage 1" with a "Cancel pause" button
    And the roadmap item "Pause item B" has started
    And the roadmap pauses with "Stage 1 done"
    And the roadmap item "Pause item A" is done
    And the roadmap item "Pause item B" is done
    And the roadmap item "Pause item C" has not started
    And the roadmap bar shows no pausing badge

  @issue-391
  Scenario: Cancel pause takes the badge away and the roadmap goes on to the next stage
    Given the app is open with simulated turns of a few seconds
    And the roadmap has two planned stages, items A and B in stage 1 and item C in stage 2, one run at a time
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I resume the roadmap as a simulation
    Then the roadmap item "Pause item A" has started
    When I click "Pause" on the roadmap bar
    And I choose "Pause after this stage" in the pause menu
    Then the roadmap bar shows the badge "Pausing after stage 1" with a "Cancel pause" button
    When I click "Cancel pause" on the roadmap bar
    Then the roadmap bar shows no pausing badge
    And the roadmap bar's state dot is "running" and reads "Running"
    And the roadmap item "Pause item C" has started

  @issue-391
  Scenario: Pause now starts nothing new while the run in progress goes on, and Resume continues
    Given the app is open with simulated turns of a few seconds
    And the roadmap has two planned stages, items A and B in stage 1 and item C in stage 2, one run at a time
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I resume the roadmap as a simulation
    Then the roadmap item "Pause item A" has started
    And the roadmap item "Pause item B" has not started
    When I click "Pause" on the roadmap bar
    And I choose "Pause now" in the pause menu
    Then the roadmap bar's state dot is "paused" and reads "Paused"
    And the roadmap bar shows no pausing badge
    And the roadmap item "Pause item A" is done
    And the roadmap item "Pause item B" has not started
    When I resume the roadmap as a simulation
    Then the roadmap item "Pause item B" has started

  # ---- #395: move on past an item waiting at a human gate --------------------------------------------
  # The demo roadmap is replaced by two planned stages of simulated software-development-local-hero
  # items: stage 1 holds "Gate item A" in Validated mode (its run stops at the owner's "Developer
  # check" gate), stage 2 holds "Gate item C" in Automatic mode (no gate). Moving on parks A: its stage
  # counts it finished and stage 2 starts, while A's run keeps waiting at the same gate, still the
  # owner's to answer. Assumption: the parked card names the gate by its step's display name
  # ("Developer check") and its "Parked at …" line opens the run at that gate.

  @issue-395 @quarantine
  Scenario: Moving on past an item at a gate starts the next stage, the gate stays mine, and Approve ends the item done
    Given the app is open
    And the roadmap has two planned stages, item A in Validated mode in stage 1 and item C in stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I resume the roadmap as a simulation
    Then the roadmap item "Gate item A" waits at a human gate
    And the roadmap item "Gate item C" has not started
    And the roadmap item "Gate item A" offers "Move on" on its card
    When I click "Move on" on the roadmap item "Gate item A"
    Then the confirm dialog says the next stage starts without the parked change
    When I press "Move on" in the confirm dialog
    Then the roadmap item "Gate item A" is parked at "Developer check"
    And the roadmap bar counts "1 parked at a gate"
    And the roadmap item "Gate item C" has started
    When I open the gate of the parked roadmap item "Gate item A"
    Then a gate card waits for my approval
    And the gate card offers "Approve: go on to the code review" and "Stop the run (branch kept to resume)"
    When I choose "Approve: go on to the code review" on the gate card
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    Then the roadmap item "Gate item A" is done
    And the roadmap bar shows no parked count

  # #748 removed "Move on from this stage" from the stage actions menu (its #395 scenario went with it);
  # parking an item at a gate stays possible from that item's card.

  # ---- #405: main stays green: the base's known failures, the fix item of a red base ---------------------

  @issue-405
  Scenario: The Roadmap shows the base's known failures in one line, with a link to the details
    Given the app is open
    And the test "exports the monthly report" in "test/report.test.js" fails on the base of the demo project
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows one line reading "1 known failure on the base"
    When I open the base's known failures from that line
    Then the details name the test "exports the monthly report" in "test/report.test.js"

  # stage 1 is done and stage 2 ("Tonight") is the current one: the fix item's new stage takes its place
  @issue-405
  Scenario: A red test on the base puts a fix item, in Automatic mode, in a new stage before the current one
    Given the app is open
    And a base check after a merge finds the test "exports the monthly report" in "test/report.test.js" red
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 2 holds only the fix item for "exports the monthly report"
    And the roadmap item "exports the monthly report" is in "Automatic" mode
    And stage 3 shows the item "Keyboard focus is lost after closing a dialog"

  # ---- #421: the roadmap bar's summary of what is left ----------------------------------------------
  # The demo roadmap has items left in stages 2 to 5, tonight's runs already spent money, the test-batch
  # item (stage 4) has no estimate, and one cut line, "v0.10", closes stage 4 "Test batch": stage 5 is
  # after the last cut line.

  @issue-421
  Scenario: The roadmap bar sums up the planned cost and time of what is left, and what was spent
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows the planned cost and time of what is left, with its items and stages
    And the roadmap summary counts the items without an estimate
    And the roadmap summary shows what was spent next to it
    And the roadmap summary's tooltip says "work time; gates not included"

  @issue-421
  Scenario: "By release" lists the planned work of each cut line, then what comes after the last one
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the roadmap summary by release
    Then the release list has 2 rows
    And release row 1 names "v0.10" with its planned cost and time
    And release row 2 names "after the last cut line" with its planned cost and time

  @issue-421
  Scenario: Without cut lines the roadmap summary offers no "By release" toggle
    Given the app is open
    And the roadmap has no cut lines
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows the planned cost and time of what is left, with its items and stages
    And the roadmap summary offers no "By release" toggle

  # ---- #425: Planned shows the latest release, All every release -----------------------------------
  # The demo workspace has no release history: the scenarios ship "v0.9" with stage 1's runs and
  # "v0.9.1" with stage 2's (as #291), so "v0.9.1" is the release furthest down the roadmap. The date
  # filter is set to "Total" since stage 1's run is months old.

  @issue-425
  Scenario: In Planned the Roadmap shows only the most recent release
    Given the app is open
    And the project shipped the release "v0.9" with the done runs of stage 1
    And the project shipped the release "v0.9.1" with the done runs of stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I set the roadmap's date filter to "Total"
    Then the roadmap's item switch is on "Planned"
    And the roadmap shows the release block "v0.9.1"
    And the roadmap does not show the release block "v0.9"

  @issue-425
  Scenario: In All the Roadmap shows every release
    Given the app is open
    And the project shipped the release "v0.9" with the done runs of stage 1
    And the project shipped the release "v0.9.1" with the done runs of stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I set the roadmap's date filter to "Total"
    And I switch the roadmap to "All"
    Then the roadmap shows the release block "v0.9"
    And the roadmap shows the release block "v0.9.1"

  @issue-425
  Scenario: A release chosen in the Releases filter shows on its own, also in Planned
    Given the app is open
    And the project shipped the release "v0.9" with the done runs of stage 1
    And the project shipped the release "v0.9.1" with the done runs of stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I set the roadmap's date filter to "Total"
    And I choose the release "v0.9" in the Releases filter
    Then the roadmap's item switch is on "Planned"
    And the roadmap shows the release block "v0.9"
    And the roadmap does not show the release block "v0.9.1"

  # ---- #426: Run later / Run earlier pass the stages Planned hides ---------------------------------
  # #748 renamed the entries "Run later" / "Run earlier" to "Move down" / "Move up".
  # Planned hides the finished stages. The scenarios add finished stages (one item each, a copy of one
  # of tonight's done items) to the demo roadmap: stage 3 is "Reports and health", stage 5 then "Test
  # batch" and the last planned stage holds "Dark scrollbars in the terminal dock".

  @issue-426
  Scenario: Run later in Planned moves a stage past the next drawn stage, the hidden finished one keeping its order
    Given the app is open
    And the roadmap has a finished stage "Finished earlier" after stage 3
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's item switch is on "Planned"
    And stage 4 is not shown
    When I open the stage actions menu of stage 3
    And I choose "Move down" in the stage actions menu
    Then the toast says stage 3 moved down and is stage 5 now
    And stage 5 is the stage "Reports and health"
    And stage 4 sits between stage 2 and stage 5
    When I switch the roadmap to "All"
    Then stage 3 is the stage "Finished earlier"

  @issue-426
  Scenario: Run later on the lowest drawn stage, with finished stages after it, moves it to the end
    Given the app is open
    And the roadmap ends with 2 finished stages
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 6 is not shown
    When I open the stage actions menu of stage 5
    Then the stage actions menu offers "Move down", enabled
    When I choose "Move down" in the stage actions menu
    Then the toast says stage 5 moved down and is stage 7 now
    And stage 7 shows the item "Dark scrollbars in the terminal dock"

  # ---- #491: the live refresh keeps my place ----------------------------------------------------------
  # The demo run "run00016" is running, so the Roadmap refreshes while it is open. A long stage of
  # planned items (#1001…) gives the page room to scroll; an issue appended to one of them outside the
  # app (as #287) makes the screen refresh. The refreshed card is the same element on the page (updated
  # in place, not drawn again) and the page does not jump back to the top.

  @issue-491
  Scenario: While a run is active, a refresh updates a row in place and keeps my scroll position
    Given the app is open
    And the roadmap has a stage of 40 planned items
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run chip reading "Running"
    When I scroll the roadmap down to the item "Planned item 1030"
    And I note where the roadmap item "Planned item 1030" is on the screen
    And the issue "Appended from elsewhere" is added to the roadmap item "Planned item 1030" outside the app
    Then the roadmap item "Planned item 1030" shows "Appended from elsewhere"
    And the roadmap item "Planned item 1030" was updated in place
    And the roadmap item "Planned item 1030" has not moved on the screen

  # ---- #555: a planned release is an item of the Roadmap ----------------------------------------------
  # The demo roadmap plans one release, "v0.10", on a cut line after stage 4 "Test batch"; stage 5
  # waits for it. While planned, its card shows right after its dashed line: its name, the stages it
  # closes and its estimate.

  @issue-555
  Scenario: A planned release shows its card right after its dashed line, with the stages it closes and its estimate
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows the block "Release v0.10" right after stage 4
    And the release block "v0.10" shows its release card
    And the card of the planned release "v0.10" comes right after its dashed line
    And the card of the planned release "v0.10" names the stages it closes, up to stage 4
    And the card of the planned release "v0.10" shows its estimate

  @issue-555
  Scenario: Disabling the stage before a planned release leaves the release in place
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 4
    And I choose "Disable" in the stage actions menu
    Then stage 4 is shown as disabled
    And the roadmap shows the release block "v0.10"
    And the card of the planned release "v0.10" comes right after its dashed line
    When I reload the app
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 4 is shown as disabled
    And the card of the planned release "v0.10" comes right after its dashed line

  @issue-555
  Scenario: Removing a planned release can be undone from its toast
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I remove the planned release "v0.10"
    Then a toast says "Removed the release v0.10" with an "Undo" button
    And the roadmap does not show the release block "v0.10"
    When I click "Undo" in the toast
    Then the roadmap shows the release block "v0.10"
    And the card of the planned release "v0.10" comes right after its dashed line

  # ---- #552: the running stage is Current, the first open stage before it is Next --------------------
  # An open stage "Earlier work" (one planned item) is put before the demo's stage "Tonight", whose run
  # #16 is running: "Tonight" becomes stage 3 and is the current one; stage 2 is the first open stage.

  @issue-552
  Scenario: The stage with a running item is Current, an earlier open stage shows "Next"
    Given the app is open
    And the roadmap has an open stage "Earlier work" before stage 2
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 3 is the stage "Tonight"
    And stage 3 is highlighted as the current stage
    And stage 2 shows the "Next" badge
    And stage 2 is not highlighted as the current stage

  @issue-552
  Scenario: With nothing running the first open stage is Current and no stage shows "Next"
    Given the app is open
    And the roadmap has two planned stages, items A and B in stage 1 and item C in stage 2, one run at a time
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then stage 1 is highlighted as the current stage
    And no stage shows the "Next" badge

  # ---- #614: a cleanly merged item's Merge station reads done -------------------------------------------
  # "Add a /health endpoint" (#9) is one of tonight's done items: its run merged with no merge conflict to
  # resolve, so no step of the Merge station ran.

  @issue-614
  Scenario: A finished item that merged cleanly shows its Merge station as done
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I click the done chip of stage 2
    Then the pipeline of the done roadmap item "Add a /health endpoint" shows its "Merge" station as done

  # ---- #615: a running item's cost meter follows its run --------------------------------------------------
  # The demo run "run00016" (#16) is in code review; a reviewer session's cost is appended to its events
  # (as the engine records it) while the Roadmap is open, with no reload.

  @issue-615
  Scenario: A running item's cost meter shows a new session cost of its run without reloading
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I note the cost meter of the roadmap item "Keyboard focus is lost after closing a dialog"
    And the running demo run "run00016" records a session cost of 2.50 dollars
    Then the cost meter of the roadmap item "Keyboard focus is lost after closing a dialog" grows by 2.50 dollars without a reload

  # ---- #748: the stage's ⋮ menu: at once, in place, grouped, and "Remove from roadmap" -------------------
  # The demo roadmap has 5 stages; the long roadmap adds 200 planned stages of one item each (stages 6 to
  # 205). Opening a stage's menu draws nothing else again and moves nothing on the page. The entries of
  # an idle planned stage, in their groups; a refused entry is dimmed, its reason in its tooltip only.
  # Stage 2 "Tonight" holds the running #16 and #15 waiting at a gate, so it cannot be removed.
  # Assumption: the confirm dialog's button is "Remove", and the removed stage's issues stay open in the
  # Backlog (only the roadmap forgets them).

  @issue-748 @quarantine
  Scenario: On a long roadmap a stage's ⋮ menu opens at once in place, its entries grouped, "Remove from roadmap" last
    Given the app is open
    And the roadmap ends with 200 planned stages of one item each
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I scroll the roadmap down to stage 150
    And I note the roadmap's scroll position and where stage 150 is on the screen
    And I open the stage actions menu of stage 150
    Then the stage actions menu of stage 150 is open
    And stage 150 was not drawn again
    And the roadmap has not scrolled and stage 150 has not moved on the screen
    And the stage actions menu shows these groups of entries, divided by lines:
      | Disable, Run this stage      |
      | Stop when finished, Stop now |
      | Release after this stage     |
      | Move up, Move down           |
      | Add note                     |
      | Remove from roadmap          |
    And the stage actions menu shows no explanation line
    And the stage actions menu does not offer "Move on from this stage"
    And the stage actions menu ends with "Remove from roadmap", shown as a dangerous action

  @issue-748
  Scenario: Remove from roadmap asks first naming the stage and its items, then takes them off the roadmap, the issues kept
    Given the app is open
    And the backlog has the open issues "Tidy the settings page" and "Rename the export button"
    And the roadmap ends with a planned stage "Cleanup" holding the issues "Tidy the settings page" and "Rename the export button"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 6
    And I choose "Remove from roadmap" in the stage actions menu
    Then the confirm dialog asks "Remove stage 6 and its 2 items from the roadmap?"
    When I press "Remove" in the confirm dialog
    Then stage 6 is not shown
    And the roadmap no longer shows the item "Tidy the settings page"
    And the roadmap no longer shows the item "Rename the export button"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    Then the list shows the issue "Tidy the settings page"
    And the list shows the issue "Rename the export button"

  @issue-748
  Scenario: Remove from roadmap is refused on a stage whose item runs, its reason in the tooltip only
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Keyboard focus is lost after closing a dialog" shows a run chip reading "Running"
    When I open the stage actions menu of stage 2
    Then the stage actions menu entry "Remove from roadmap" is refused, with its reason in its tooltip only
    And the stage actions menu shows no explanation line
    When I try "Remove from roadmap" in the stage actions menu
    Then no confirm dialog opens
    And stage 2 is the stage "Tonight"
    And the roadmap shows the item "Keyboard focus is lost after closing a dialog"

  # ---- #750: the Roadmap header in four bands -------------------------------------------------------------
  # One card with four bands, separated by dividers: the state and the actions; the numbers (Stages, Left,
  # Forecast, Spent); the activity, only while a background task (the base check) runs; the view and its
  # filters. The demo roadmap is paused by a refused start (#14), so it offers Resume; stages 2 to 5 have
  # work left; tonight's runs already spent money; nothing runs in the background (no base check).
  # Assumptions: the pill reads the app's existing state labels ("Paused by a failure", "Running",
  # "Paused"); the Simulated switch is a checkbox entry of the ⋮ menu; the Releases filter only shows once
  # the project has shipped releases, so the view band is checked without it here; the base check runs a
  # suite of about 90 seconds (on a suite slot of the scenario's own), long enough to see it running.

  @issue-750
  Scenario: The Roadmap's header shows the state, the numbers and the view in their bands, with no activity when nothing runs
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap header shows its bands in order: state and actions, numbers, view and filters
    And the roadmap header shows no activity band
    And the roadmap's state pill reads "Paused by a failure"
    And the roadmap header's controls are "Resume", "Stop" and the ⋮ menu, in that order
    And the roadmap header offers no "Simulated" checkbox outside its ⋮ menu
    And the roadmap header's numbers are "Left", "Forecast", "Spent" and "Stages", in equal columns, each with its value
    And the "Left" number of the roadmap header says "in 4 stages"
    And the "Spent" number of the roadmap header says "so far"
    And the roadmap's view band holds the date filter, the Planned and All switch and "Group by epic" on its left, and the item count on its right
    And the roadmap's date filter is "Last 24 hours"
    And the roadmap header counts the items shown out of all, for "last 24 hours"
    When I open the roadmap's ⋮ menu
    Then the roadmap's menu offers the "Simulated" switch

  @issue-750
  Scenario: A running roadmap shows a "Running" pill with Pause, Stop and ⋮; once paused, Resume, Stop and ⋮
    Given the app is open
    And the roadmap is running as a simulation
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap's state pill reads "Running"
    And the roadmap header's controls are "Pause", "Stop" and the ⋮ menu, in that order
    When I click "Pause" on the roadmap bar
    And I choose "Pause now" in the pause menu
    Then the roadmap's state pill reads "Paused"
    And the roadmap header's controls are "Resume", "Stop" and the ⋮ menu, in that order

  @issue-750
  Scenario: While the base check runs, the activity band names it with its start and commit, and "View terminal" opens its log
    Given the app is open with the machine's suite slot free
    And the base check is set to "Issue + fix item"
    And the demo project is a git repository on the base "main" whose suite runs for a while
    When a merge into the base "main" starts the base check
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap header shows its bands in order: state and actions, numbers, activity, view and filters
    And the roadmap's activity band names "Base check", running since a time on the base's commit
    And the roadmap's activity band offers "View terminal" and no "Live terminal" or "↗" button
    When I click "View terminal" in the roadmap's activity band
    Then a read-only terminal tab opens for "Base check"
    And the terminal shows "npm test"

  # ---- #697: a stage added before the running stage waits for it ------------------------------------
  # The roadmap runs (simulated) with the demo run #16 of stage 2 "Tonight" running. A planned stage
  # "Earlier work" (one item, #5521, made up) sits after it as stage 3; Move up puts it before "Tonight".
  # It does not start in parallel: it reads that it waits for stage 3 (the running stage), shows nothing
  # running, and "Tonight" stays the only stage marked Current.

  @issue-697
  Scenario: A stage moved before the running stage waits for it, and only the running stage is Current
    Given the app is open
    And the roadmap is running as a simulation
    And the roadmap has an open stage "Earlier work" before stage 3
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    And I choose "Move up" in the stage actions menu
    Then the toast says stage 3 moved up and is stage 2 now
    And stage 2 is the stage "Earlier work"
    And stage 3 is the stage "Tonight"
    And stage 2 shows that it waits for stage 3
    And stage 2 shows nothing "Running"
    And the roadmap item "Earlier work item" has not started
    And stage 3 is highlighted as the current stage
    And stage 2 is not highlighted as the current stage
