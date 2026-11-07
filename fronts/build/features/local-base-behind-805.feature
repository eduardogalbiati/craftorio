Feature: A local run says when its base is behind origin before it starts
  A local run starts from the local base. When origin has moved on, I am told how far behind that base
  is before anything starts, and I choose: update it, or go on from it. A base that has diverged is
  never moved for me: I am told so and pointed to the Backlog.

  # What these scenarios stand on (#805):
  # - The demo project's folder is made a real repository whose origin is a bare repository of the
  #   scenario, and the commits origin is ahead by come from a second clone. Nothing fetches them
  #   into the demo folder, so only the app's own check can find them.
  # - The runs are simulated: a simulated run has no worktree, so the check happens when I start it.
  # - The demo's stages are replaced by one planned item in Local mode: the demo roadmap is paused by a
  #   refused start, which offers Resume, not Start.
  # - "has started" reads the item's run on its card, so it holds even once the short simulated run ends.

  @issue-805
  Scenario: The Start panel says the base is behind, and going on from the local base starts the run
    Given the app is open
    And the demo project's local main is 2 commits behind origin
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Local" for "Mode"
    And I start a simulated run with the task "Add a health check"
    Then the Start panel says the base is 2 commits behind origin/main
    And the Start panel offers to update the base or go on
    And no run of the task "Add a health check" has started
    When I choose to go on from the local base in the Start panel
    Then the run is running

  @issue-805
  Scenario: The Roadmap says the base is behind and stays planned, and updating the base runs it
    Given the app is open
    And the demo project's local main is 2 commits behind origin
    And the roadmap plans the item "Item on a base behind" on the workflow "feature" in "local" mode
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I click "Start" on the roadmap bar
    Then the Roadmap says the base is 2 commits behind origin/main
    And the Roadmap offers to update the base or go on
    And the roadmap bar's state dot is "planned" and reads "Planned"
    And the roadmap item "Item on a base behind" has not started
    And the roadmap file keeps the roadmap "planned" with no run on the item "Item on a base behind"
    When I choose to update the base in the Roadmap
    Then the Roadmap no longer says the base is behind
    And the roadmap item "Item on a base behind" has started

  @issue-805
  Scenario: The Start panel says a diverged base was not moved, points to the Backlog and offers no update
    Given the app is open
    And the demo project's local main is 1 commit ahead of and 2 commits behind origin
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Local" for "Mode"
    And I start a simulated run with the task "Add a health check"
    Then the Start panel says the base was not moved and points to the Backlog
    And the Start panel offers no update of the base
