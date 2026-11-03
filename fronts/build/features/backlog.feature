Feature: Backlog Board and Roadmap
  The demo project's backlog (scripts/screenshot.js demo data): its issues on the Board and its
  roadmap with tonight's runs.

  @issue-222 @issue-207 @smoke
  Scenario: The Backlog Board renders as a kanban with the issues and their labels
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    Then the board shows the column "To do"
    And the board shows the column "Done"
    And the board shows the issue "Add a /health endpoint"
    And the board shows the issue "Crash when the workspace folder is renamed"
    And the board shows the label "bug"
    And the board shows the label "enhancement"

  @issue-222 @issue-193 @issue-194 @smoke
  Scenario: The Roadmap renders its stages and items
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap shows at least 2 stages
    And the roadmap shows the item "Add a /health endpoint"

  @issue-196
  Scenario: A refused roadmap start offers Retry and Skip, and the roadmap bar points to it
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then a refused item offers Retry and Skip, enabled
    And the roadmap bar says why the start was refused and offers "Show the item"
    When I click "Show the item" in the roadmap bar
    Then the refused item is in view

  @issue-236
  Scenario: Hovering a running item's progress ring shows the run summary in the steps popover
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I hover the progress ring of the roadmap item "Keyboard focus is lost after closing a dialog"
    Then the run's steps popover shows the run summary
    And the progress ring has no native tooltip

  @issue-236
  Scenario: The agent card of a running item stays inside a narrow window
    Given the app is open in a 900x800 window
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I hover an agent in the pipeline of the roadmap item "Keyboard focus is lost after closing a dialog"
    Then the agent card is shown inside the window

  # The demo roadmap is paused (a refused start); its stage 5 is the unnamed stage with one planned item
  @issue-243
  Scenario: Resume on a paused roadmap asks to resume it, not to start it
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows "Paused"
    When I press Resume on the roadmap with Simulated off
    Then the confirm dialog is titled "Resume the roadmap" with a "Resume" button
    When I press Cancel in the confirm dialog
    Then the roadmap bar shows "Paused"

  @issue-243
  Scenario: Resume on a stage run on its own asks to resume that stage
    Given the app is open
    And the roadmap was paused while stage 5 ran on its own
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar shows "Paused"
    And the roadmap bar shows "stage 5 only"
    When I press Resume on the roadmap with Simulated off
    Then the confirm dialog is titled "Resume stage 5" with a "Resume" button
    And the confirm dialog says the roadmap pauses again when the stage is done
    When I press Cancel in the confirm dialog
    Then the roadmap bar shows "stage 5 only"

  @issue-237
  Scenario: A stage run on its own that finished while paused no longer holds the roadmap
    Given the app is open
    And the roadmap was paused while stage 5 ran on its own
    And every item of stage 5 is done
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap bar does not show "stage 5 only"
    And the roadmap bar shows "Stage 5 done"
    When I resume the roadmap as a simulation
    Then the roadmap bar does not show "Stage 5 done"
    And the Backlog shows no error "Every item of this stage is done or skipped."

  # Archive (#238): in simulation the close, label and reopen are recorded in the synced backlog
  # (no gh call). Every demo issue is planned, running or merged locally, hence the added ones.
  @issue-238
  Scenario: Archiving two selected issues closes them as not planned and moves them to Archived
    Given the app is open
    And the backlog has the open issues "Old idea: a splash screen" and "Old idea: export the queue as CSV"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I select the issue "Old idea: a splash screen"
    And I select the issue "Old idea: export the queue as CSV"
    And I click "Archive (2)" in the selection bar
    Then the archive confirm names "#17" and "#18", closed as not planned on GitHub and labelled archived
    When I confirm the archive
    Then the Open view does not show "Old idea: a splash screen"
    And the Open view does not show "Old idea: export the queue as CSV"
    When I show the "Archived" issues
    Then the list shows the issue "Old idea: a splash screen"
    And the list shows the issue "Old idea: export the queue as CSV"

  @issue-238
  Scenario: Restoring an archived issue brings it back to the Open view
    Given the app is open
    And the backlog has the archived issue "Old idea: a splash screen"
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I show the "Archived" issues
    And I restore the issue "Old idea: a splash screen"
    Then the list does not show the issue "Old idea: a splash screen"
    When I show the "Open" issues
    Then the list shows the issue "Old idea: a splash screen"

  # The demo roadmap's stage 5 (the unnamed stage) plans #10 alone
  # The demo backlog has two epics: "Workspace safety and recovery" (#14, members #11 and #8) and
  # "Run reports" (#13, member #12)
  @issue-253
  Scenario: The Board kanban shows no epic, the Epics view lists them with their members
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    Then the board shows the issue "Add a /health endpoint"
    And the board does not show the issue "Workspace safety and recovery"
    And the board does not show the issue "Run reports"
    When I open the Epics view
    Then the Epics view lists the epic "Workspace safety and recovery" with its member "Crash when the workspace folder is renamed"
    And the Epics view lists the epic "Run reports" with its member "Export a run report as Markdown"
    And the Epics view shows the progress of the epic "Run reports"

  @issue-253
  Scenario: The Board list and its count leave the epics out, and an epic cannot be picked for a workflow
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    Then the list shows the issue "Add a /health endpoint"
    And the list does not show the issue "Workspace safety and recovery"
    And the list does not show the issue "Run reports"
    And the Board's issue count leaves out the epics
    When I open the Epics view
    Then the epic "Run reports" cannot be selected for a workflow

  @issue-238
  Scenario: An issue planned in the roadmap cannot be archived and says why
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a list
    And I open the menu of the issue "Dark scrollbars in the terminal dock"
    Then its Archive action is disabled with the reason "Planned in stage 5: remove it from the roadmap first"

  # ---- #422: the "Queue" error alert offers Resume, never a dismiss × ---------------------------------
  # The demo workspace has no issue queue: the Given queues one open issue and pauses the queue the way
  # the service does when a queued run failed ("#13 failed: resume to start the next issues."); an
  # issue still waits, so the pause is not stale (#445). The roadmap's own error ("Could not
  # start #14") is another alert, so the scenarios bring the queue's alert into view first.

  @issue-422 @issue-556
  Scenario: The Queue error alert offers Resume and no close button
    Given the app is open
    And a queued run failed and paused the issue queue
    When I open "Backlog" in the sidebar
    And I show the alert "failed: resume to start the next issues"
    Then the shown alert is at level "error" and says "Queue"
    And the shown alert offers "Resume"
    And the shown alert has no "Dismiss" button

  @issue-422 @issue-556
  Scenario: Resume in the Queue error alert resumes the queue and the alert goes away
    Given the app is open
    And a queued run failed and paused the issue queue
    When I open "Backlog" in the sidebar
    And I show the alert "failed: resume to start the next issues"
    And I click "Resume" in the shown alert
    Then the alerts no longer show "failed: resume to start the next issues"

  # ---- #445: a failed roadmap run leaves the plain queue alone ----------------------------------------
  # The demo workspace's plain queue is empty and not paused; its roadmap's run of #13 ("Run reports")
  # failed. That failure is the roadmap's, not the queue's: no "Queue: #13 failed" alert, no queue bar.

  @issue-445
  Scenario: A failed roadmap run does not pause the empty plain queue, and the Backlog shows no queue bar
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Run reports" shows a run chip reading "Failed"
    And the alerts no longer show "failed: resume to start the next issues"
    And the Backlog shows no queue bar

  # ---- #630: no project auto-push, old workflow names read as the new ones -----------------------------
  # The demo workspace has 2 commits merged locally, not pushed: the "Not pushed" alert still offers Push…,
  # but no longer the project's auto-push switch.

  @issue-630
  Scenario: The Backlog's "Not pushed" alert no longer offers the project auto-push switch
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    And I show the alert "Not pushed"
    Then the shown alert is at level "info" and says "Not pushed"
    And the Backlog does not offer to push the project automatically

  @issue-630
  Scenario: A roadmap item saved with the old workflow software-development shows the workflow feature
    Given the app is open
    And the roadmap has a stage of 2 planned items
    And the roadmap item "Planned item 1001" runs the workflow "software-development"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the Workflow band of the roadmap item "Planned item 1001" names the workflow "feature"
