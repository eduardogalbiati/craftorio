Feature: Skip says what starts next and can leave the roadmap paused
  Skipping the item that paused the roadmap resumes it and starts the next work. Now the Skip action
  names what would start before it happens, and I can skip and leave the roadmap paused: nothing starts
  until I resume. When nothing would start, Skip works as before, with no extra step.

  # What these scenarios stand on (#804):
  # - The item that pauses the roadmap is a refused start (an error and no run), so Skip is on its card
  #   and no run of the seed decides what the bar shows. The demo's stages are replaced.
  # - The roadmap is simulated, and the next stage's item runs Feature in Validated mode: once resumed it
  #   starts and stops at a gate, so its simulated run cannot end in a failure that would pause the roadmap.
  # - "has started" at the end shows the seed could start that item: it was the choice to stay paused
  #   that held it back, not a seed that never starts anything.
  # - Once skipped, the item no longer pauses the roadmap: the bar reads plain "Paused", not "Paused by a
  #   failure".
  # - With nothing after the skipped item, the skip resumes the roadmap, which has no work left and ends.
  # - A finished stage leaves the Planned view, so the skipped item is read in All.

  @issue-804
  Scenario: The Skip action names the next stage, and choosing to stay paused starts no run
    Given the app is open
    And the roadmap is paused by the item "Item that could not start", before the stage "After the skip" of the item "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I click "Skip" on the roadmap item "Item that could not start"
    Then the skip dialog names "After the skip"
    And the skip dialog offers to go on or to stay paused
    And the roadmap bar's state dot is "paused-failed" and reads "Paused"
    When I choose to stay paused in the skip dialog
    Then the roadmap shows the skipped item "Item that could not start"
    And the roadmap bar's state dot is "paused" and reads "Paused"
    And the roadmap item "Item of the next stage" has not started
    And the roadmap file keeps the roadmap "paused" with no run on the item "Item of the next stage"
    When I resume the roadmap as a simulation
    Then the roadmap item "Item of the next stage" has started

  @issue-804
  Scenario: Skipping when nothing would start asks nothing and works as before
    Given the app is open
    And the roadmap is paused by the item "Last item left", with nothing planned after it
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I switch the roadmap to "All"
    And I click "Skip" on the roadmap item "Last item left"
    Then the roadmap shows the skipped item "Last item left"
    And the roadmap asked nothing before the skip
    And the roadmap bar's state dot is "done" and reads "Done"
