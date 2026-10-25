Feature: The run's 3D view
  The 3D button on the Run screen opens the run in 3D, a full-window overlay. Its scene is drawn on
  demand (#388): it draws while something moves (a robot at work, the beacon of a live run) and
  stays still while nothing changes (a finished run, a run waiting); closing the view or minimising
  the window stops its drawing. The frames are counted with a spy on the WebGL draw calls of the
  overlay's canvas (features/steps/run3d.steps.js).

  # The run "-fin00388" is seeded finished (fronts/build/features/steps/turn-costs.steps.js): one developer turn
  @issue-388
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
  @issue-388
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

  @issue-388
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
