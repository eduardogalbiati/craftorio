Feature: Resuming a stopped run from its step, with its model choice
  Resume from step… opens on the step where a failed run stopped and shows the Developer model and
  the Developer effort of the run's workflow, at the values the run used. The owner changes them for
  the new run; the failed run keeps its own. A run stopped by a provider's limit says so in the
  dialog, offers its step and says what the next turn would re-read.

  # The seeded runs (features/steps/resume.steps.js) are simulated Feature runs of the demo project:
  # "Write tests (E2E)", the red check and Warm Up finished, then the run failed in Develop, so the step
  # to preselect is not the workflow's first one. The first scenario's run used values that are not
  # the workflow's defaults, so the dialog can only have read them from the run. Its model is of an
  # earlier version (#56): it keeps its name, and the workflow's current choices are offered too.
  @issue-799 @issue-56
  Scenario: The resume dialog preselects the failed step and shows the model choice
    Given the app is open
    And the demo project has a Feature run "res00799" that failed at Develop on "Fable 5.1" with the effort "High"
    When I open "Runs" in the sidebar
    And I search the runs for "res00799"
    And I open Resume from step on the run "res00799" from the list
    Then the resume dialog opens with the step "Develop" preselected
    And the resume dialog shows "Fable 5.1" for "Developer model"
    And the resume dialog shows "High" for "Developer effort"
    And the resume dialog also offers "Opus 5.5" for "Developer model"
    And the resume dialog also offers "Fable 5.2" for "Developer model"

  # #56: the model the run was saved with is no longer the workflow's choice, and the owner leaves it alone.
  @issue-56
  Scenario: A run saved on an older model is resumed on it
    Given the app is open
    And the demo project has a Feature run "old00056" that failed at Develop on "Fable 5.1" with the effort "High"
    When I open "Runs" in the sidebar
    And I search the runs for "old00056"
    And I open Resume from step on the run "old00056" from the list
    Then the resume dialog shows "Fable 5.1" for "Developer model"
    When I resume from this step
    Then a new run opens instead of the run "old00056"
    And the run shows the pill "Developer model: Fable 5.1"
    When I switch the run to its chat
    Then the run chat shows that "Develop" was answered by "claude" with the model "claude-fable-5-1"

  # The run is seeded as a provider's limit ends a run: its message is the run's error, with no event
  # of the run's own limits (cost, time, context). The developer's conversation stayed open with a
  # context of 140000 tokens, two days ago, so its prompt cache has expired.
  @issue-799
  Scenario: A run stopped by a weekly limit says so and offers its step
    Given the app is open
    And the demo project has a Feature run "lim00799" stopped at Develop by "You've hit your weekly limit" with a developer context of 140000 tokens
    When I open "Runs" in the sidebar
    And I search the runs for "lim00799"
    And I open Resume from step on the run "lim00799" from the list
    Then the resume dialog opens with the step "Develop" preselected
    And the resume dialog says the run stopped at its "weekly limit"
    And the resume dialog says the next turn would re-read about "140K" tokens

  # The new run is a simulation, as the failed run was: its Details show the inputs it recorded, its
  # chat shows the model that answered Develop. The effort, left alone, stays what the run used.
  @issue-799 @issue-56
  Scenario: The owner changes the Developer model and the new run uses it while the failed run keeps its own
    Given the app is open
    And the demo project has a Feature run "mod00799" that failed at Develop on "Opus 5.5" with the effort "High"
    When I open "Runs" in the sidebar
    And I search the runs for "mod00799"
    And I open Resume from step on the run "mod00799" from the list
    And I choose "Fable 5.2" for "Developer model" in the resume dialog
    And I resume from this step
    Then a new run opens instead of the run "mod00799"
    And the run shows the pill "Developer model: Fable 5.2"
    And the run shows the pill "Developer effort: High"
    When I switch the run to its chat
    Then the run chat shows that "Develop" was answered by "claude" with the model "claude-fable-5-2"
    When I open "Runs" in the sidebar
    And I search the runs for "mod00799"
    And I view the run "mod00799" from the list
    Then the run shows the pill "Developer model: Opus 5.5"
