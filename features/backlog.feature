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
    Then the roadmap bar shows "Paused · stage 5 only"
    When I press Resume on the roadmap with Simulated off
    Then the confirm dialog is titled "Resume stage 5" with a "Resume" button
    And the confirm dialog says the roadmap pauses again when the stage is done
    When I press Cancel in the confirm dialog
    Then the roadmap bar shows "Paused · stage 5 only"

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
