Feature: A simulated run spends nothing
  A simulated run makes no model call, as the Assign dialog says: it shows no spend on its roadmap
  card nor in its run chat, and it adds nothing to what the roadmap says was spent.

  # What these scenarios stand on (#31):
  # - The runs are simulated (CRAFTORIO_SIMULATION_ONLY=1, the Start panel's "Simulation mode", the
  #   roadmap's simulated switch). Their simulated turns used to record a cost ("COST $0.20 so far" on
  #   the card, "$0.56" in the run chat, the roadmap's Spent growing by it).
  # - "No spend" reads a zero amount ("$0.00", "US$ 0,00") or the word "Simulated" / "simulado".
  # - The demo roadmap already spent money on real runs: the Spent number is noted before the
  #   simulated run starts and must not grow. The demo's stages are replaced by one planned item on
  #   the Feature workflow in Local mode (validation automatic, so the run ends without a gate).

  @issue-31
  Scenario: A simulated run waiting at its gate shows no spend in its run chat
    Given the app is open
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    And a gate card waits for my approval
    And the run chat's header shows that the run spent nothing

  @issue-31
  Scenario: A simulated roadmap run shows no spend on its card, adds nothing to Spent and shows no spend in its chat
    Given the app is open
    And the roadmap plans the item "Simulated item spends nothing" on the workflow "feature" in "local" mode
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I note the "Spent" number of the roadmap header
    And I click "Start" on the roadmap bar
    Then the roadmap item "Simulated item spends nothing" has started
    And the roadmap item "Simulated item spends nothing" is done
    And the cost meter of the roadmap item "Simulated item spends nothing" shows that its run spent nothing
    And the "Spent" number of the roadmap header has not grown since I noted it
    When I click the run chip of the roadmap item "Simulated item spends nothing"
    And I open the run's Chat tab
    Then the run chat's header shows that the run spent nothing
