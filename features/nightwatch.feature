Feature: Night watch
  The Night watch screen on the demo workspace: the owner's permissions (what the Oracle may do
  without asking at night) are saved and stay as the owner left them.

  @issue-239
  Scenario: Ticked permissions stay ticked after Save and after coming back to the screen
    Given the app is open
    When I open "Night watch" in the sidebar
    And I tick the permission "Skip an item"
    And I tick the permission "Regroup or reorder planned items"
    And I save the permissions
    Then the permissions show when they were saved
    And the permission "Skip an item" is ticked
    And the permission "Regroup or reorder planned items" is ticked
    And the permission "Retry a failed roadmap item" is ticked
    When I open "Home" in the sidebar
    And I open "Night watch" in the sidebar
    Then the permission "Skip an item" is ticked
    And the permission "Regroup or reorder planned items" is ticked
    And the permission "Retry a failed roadmap item" is ticked

  @issue-239
  Scenario: Unticking every permission on purpose and saving keeps them all unticked
    Given the app is open
    When I open "Night watch" in the sidebar
    And I untick every permission
    And I save the permissions
    Then the permissions show when they were saved
    And no permission is ticked
    When I open "Home" in the sidebar
    And I open "Night watch" in the sidebar
    Then no permission is ticked

  # #278: Self-healing (Settings › Execution › Oracle, off by default) keeps the Oracle watching with
  # no end time; it saves like the rest of the Execution tab. The demo workspace can start the
  # Oracle (simulated answers), so the row is enabled here.
  @issue-278
  Scenario: With Self-healing on, the Night watch shows it in place of an end time
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then Self-healing is off
    When I turn Self-healing on
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then Self-healing is on
    When I open "Night watch" in the sidebar
    Then the Night watch says "Self-healing is on"
    And the Night watch shows no end time

  @issue-278
  Scenario: Self-healing's permissions link opens the Night watch checklist with the never-allowed items locked
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open what Self-healing may do alone
    Then the permissions checklist is shown
    And the permission "Retry a failed roadmap item" is ticked
    And the never-allowed item "Answer a human gate" is shown locked
    And the never-allowed item "Push" is shown locked
    And the never-allowed item "Close issues" is shown locked
    And the never-allowed item "Delete data" is shown locked

  @issue-278
  Scenario: Turning Self-healing off ends the watch at once
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn Self-healing on
    And I open "Night watch" in the sidebar
    Then the Night watch says "Self-healing is on"
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn Self-healing off
    And I open "Night watch" in the sidebar
    Then the Night watch is off
    And the Night watch does not say "Self-healing is on"

  # #279: "Apply merged fixes to this app", under Self-healing, only applies when the app runs from
  # source and a project of the workspace is this app's repository. The E2E app runs from source, but
  # the demo project (github.com/example/demo-app, no clone) is not this app's repository.
  @issue-279
  Scenario: Applying merged fixes to the app is unavailable when no project is this app's repository
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn Self-healing on
    Then the "Apply merged fixes to this app" switch is disabled
    And applying merged fixes to the app says "no project of this workspace is this app's repository"
    And applying merged fixes to the app names no source

  # #335: the morning summary flags a step whose cost or minutes regress against its own history:
  # baseline = median of its older successful real runs (same workflow, step, provider/model/effort),
  # regression = median of its last 3 runs above the baseline by more than 30%; fewer than 5 runs of a
  # class cannot be measured and simulated runs never count. It only reports.
  @issue-335
  Scenario: A step whose cost rose over its last 3 runs is flagged in the morning summary with links to those runs
    Given the app is open
    And the Night watch ended 2 hours ago
    And the step "test" cost US$ 1.00 in each of 6 finished runs on "claude-sonnet-5-5", then US$ 1.50 in each of the last 3 on "claude-sonnet-5-5"
    When I reload the app
    And I open "Home" in the sidebar
    Then the morning summary flags "test: +50% cost over 3 runs"
    And the regression of "test" links to its last 3 runs
    When I open the newest run behind the regression of "test"
    Then the run screen shows the run "rg-test-9"

  @issue-335
  Scenario: Simulated runs never count, so a rise in simulated runs is not flagged
    Given the app is open
    And the Night watch ended 2 hours ago
    And the step "test" cost US$ 1.00 in each of 6 simulated runs on "claude-sonnet-5-5", then US$ 1.50 in each of the last 3 on "claude-sonnet-5-5"
    When I reload the app
    And I open "Home" in the sidebar
    Then the morning summary is shown
    And the morning summary flags no regression

  @issue-335
  Scenario: A step that moved to another model is not flagged while the new model has too few runs to measure
    Given the app is open
    And the Night watch ended 2 hours ago
    And the step "test" cost US$ 1.00 in each of 6 finished runs on "claude-sonnet-5-5", then US$ 1.50 in each of the last 3 on "claude-opus-5-5"
    When I reload the app
    And I open "Home" in the sidebar
    Then the morning summary is shown
    And the morning summary flags no regression
