Feature: Image viewer
  An expanded image moves to the previous or next image of the place it was opened from, with arrows,
  the arrow keys and a counter. An original/modified pair counts as one image.

  # Assumes the demo workspace (scripts/screenshot.js, demoRoadmapRuns) gets a finished run (mock: false)
  # whose id ends in "-img00182": its final screenshots round has 3 screens, in this order, captioned
  # "Dashboard" (modified only), "Backlog board" (an original/modified pair) and "Run report" (modified only)
  @issue-182
  Scenario: The arrow keys move to the next image of the run
    Given the app is open
    And a finished demo run "img00182" with 3 screenshots, the second an original/modified pair
    When I open the demo run "img00182"
    And I open the run's Artifacts tab
    And I enlarge the screenshot "Backlog board"
    Then the image viewer shows "Backlog board"
    And the image viewer counter reads "2 / 3"
    And the image viewer's previous arrow is enabled
    And the image viewer's next arrow is enabled
    When I press the right arrow key
    Then the image viewer shows "Run report"
    And the image viewer counter reads "3 / 3"
    And the image viewer's next arrow is disabled

  @issue-182
  Scenario: The first image does not wrap to the last one
    Given the app is open
    And a finished demo run "img00182" with 3 screenshots, the second an original/modified pair
    When I open the demo run "img00182"
    And I open the run's Artifacts tab
    And I enlarge the screenshot "Dashboard"
    Then the image viewer counter reads "1 / 3"
    And the image viewer's previous arrow is disabled
    When I press the left arrow key
    Then the image viewer shows "Dashboard"
    And the image viewer counter reads "1 / 3"
    When I click the image viewer's next arrow
    Then the image viewer shows "Backlog board"
    And the image viewer counter reads "2 / 3"

  # Assumes the demo workspace gets a finished run (mock: false) whose id ends in "-one00182": its only
  # screenshot is the original/modified pair "Settings page"
  @issue-182
  Scenario: A run with a single image shows no arrows and no counter
    Given the app is open
    And a finished demo run "one00182" with a single screenshot pair
    When I open the demo run "one00182"
    And I open the run's Artifacts tab
    And I enlarge the screenshot "Settings page"
    Then the image viewer shows "Settings page"
    And the image viewer shows no arrows and no counter
