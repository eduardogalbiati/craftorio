Feature: A stage waiting for its merge says so and lets the next stage stack on its branch
  When a roadmap stage's run waits for its pull request to be merged (the team's review gate of the
  pull request pipeline), the Roadmap says so right under that stage, with a link to the PR, and
  offers two choices: Move on (the next stage starts from the current main, without that work) or
  Stack (the next stage starts from that stage's branch, its PR targets that branch). In Fork + PR
  mode Stack is not offered.

  # What these scenarios stand on (#807):
  # - The run that waits is seeded on disk with `mock: false` (a simulated run counts as merged): it
  #   opened its PR, its CI is green and it stops at the pr_review gate ("Team review"). It lives in
  #   "another app" (owner.json on another host, its heartbeat kept fresh by the step), so this app
  #   neither resumes nor interrupts it. Nothing real starts.
  # - The seed is written once the app is open, as the other Roadmap scenarios do; the demo's stages
  #   are replaced by two: the waiting stage, then a stage with one planned item.
  # - The next stage's item runs Feature in Validated mode, simulated: once started it stops at a gate,
  #   so its run cannot end in a failure that would pause the roadmap.
  # - "has started" after the choice shows the choice started it: before it, the waiting stage holds
  #   the next one back (#797).

  @issue-807
  Scenario: A stage waiting for its merge shows the notice, and Stack starts the next stage from its branch
    Given the app is open
    And the roadmap's stage "Behind a PR" waits for the merge of the pull request #331 of "Item behind a PR", made in "Remote" mode on the branch "feat/3970-behind-a-pr", before the stage of "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the stage "Behind a PR" says the roadmap waits for the merge of the pull request #331
    And the notice of the stage "Behind a PR" offers "Move on" and "Stack"
    And the roadmap item "Item of the next stage" has not started
    When I choose "Stack" in the notice of the stage "Behind a PR"
    Then the roadmap item "Item of the next stage" has started
    And the roadmap item "Item of the next stage" is stacked on the branch "feat/3970-behind-a-pr"

  @issue-807
  Scenario: Move on starts the next stage from main, without the waiting stage's work
    Given the app is open
    And the roadmap's stage "Behind a PR" waits for the merge of the pull request #332 of "Item behind a PR", made in "Remote" mode on the branch "feat/3970-behind-a-pr", before the stage of "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the stage "Behind a PR" says the roadmap waits for the merge of the pull request #332
    And the "Move on" choice of the stage "Behind a PR" says the next stage starts from "main"
    When I choose "Move on" in the notice of the stage "Behind a PR"
    Then the roadmap item "Item of the next stage" has started
    And the roadmap item "Item of the next stage" is not stacked on another branch

  @issue-807
  Scenario: In Fork + PR mode the notice offers Move on but not Stack
    Given the app is open
    And the roadmap's stage "Behind a PR" waits for the merge of the pull request #333 of "Item behind a PR", made in "Fork + PR" mode on the branch "feat/3970-behind-a-pr", before the stage of "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the stage "Behind a PR" says the roadmap waits for the merge of the pull request #333
    And the notice of the stage "Behind a PR" offers "Move on" but not "Stack"
    And the roadmap item "Item of the next stage" has not started
