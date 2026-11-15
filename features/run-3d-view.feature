Feature: The run's 3D view
  The 3D button on the Run screen opens the run in 3D, a full-window overlay. Its scene is drawn on
  demand (#388): it draws while something moves (a robot at work, the beacon of a live run) and
  stays still while nothing changes (a finished run, a run waiting); closing the view or minimising
  the window stops its drawing. The frames are counted with a spy on the WebGL draw calls of the
  overlay's canvas (features/steps/run3d.steps.js).

  # The run "-fin00388" is seeded finished (fronts/build/features/steps/turn-costs.steps.js): one developer turn
  @issue-388 @quarantine
  Scenario: A finished run's 3D view stays still once drawn
    Given the app is open
    And the demo project has a finished AI Development run "fin00388"
    And its "developer" turn ran on the known model "claude-opus-5-5" at 1.37
    When I open "Runs" in the sidebar
    And I search the runs for "fin00388"
    And I view the run "fin00388" from the list
    And I open the run's 3D view
    And the 3D scene has drawn
    Then the 3D view draws no frames for 2 seconds

  # Slow simulated turns (#368) keep an agent at work long enough to watch the live scene
  @issue-388 @quarantine
  Scenario: A live run's 3D view keeps drawing, and closing it stops the drawing and removes its canvas
    Given the app is open with slow simulated turns
    When I start a simulated run with the task "Add a /health endpoint"
    And an agent's turn of the run is under way
    And I open the run's 3D view
    And the 3D scene has drawn
    Then the 3D view keeps drawing frames
    When I close the 3D view
    Then no 3D canvas remains
    And the 3D view draws no frames for 2 seconds

  @issue-388 @quarantine
  Scenario: A live run's 3D view stops drawing while the window is minimised and draws again once restored
    Given the app is open with slow simulated turns
    When I start a simulated run with the task "Add a /health endpoint"
    And an agent's turn of the run is under way
    And I open the run's 3D view
    And the 3D scene has drawn
    And I minimise the app's window
    Then the 3D view draws no frames for 2 seconds
    When I restore the app's window
    Then the 3D view keeps drawing frames

  # The HUD's cards (#833): the Cost card shows the effective price per million tokens under the cost,
  # a Tokens card shows the run's total with its output and its share of cache reads under it, and
  # every kind of token in its tooltip. The seeded developer turn has 1,200 input, 3,400 output,
  # 52,000 cache read and 8,000 cache creation tokens (fronts/build/features/steps/turn-costs.steps.js),
  # so only the shapes of the figures are checked.
  @issue-833 @quarantine
  Scenario: The 3D view's HUD shows the run's tokens and the cost per million tokens
    Given the app is open
    And the demo project has a finished AI Development run "tok00833"
    And its "developer" turn ran on the known model "claude-opus-5-5" at 1.37
    When I open "Runs" in the sidebar
    And I search the runs for "tok00833"
    And I view the run "tok00833" from the list
    And I open the run's 3D view
    Then the 3D view's Cost card shows "$1.37" with a price per million tokens under it
    And the 3D view's Tokens card shows a total with its output and cache read share under it
    And the 3D view's Tokens card lists every kind of token in its tooltip

  @issue-833 @quarantine
  Scenario: The 3D view's Tokens card comes right after the Cost card and Elapsed stays last
    Given the app is open
    And the demo project has a finished AI Development run "ord00833"
    And its "developer" turn ran on the known model "claude-opus-5-5" at 1.37
    When I open "Runs" in the sidebar
    And I search the runs for "ord00833"
    And I view the run "ord00833" from the list
    And I open the run's 3D view
    Then the 3D view's HUD cards are, in order, "visits, cost, tokens, elapsed"
