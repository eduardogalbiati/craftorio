Feature: Artifacts
  A run's artifacts, on the Run screen's Artifacts tab and on the Artifacts screen: what the run
  produced first, grouped by category and filterable; its before/after screenshots.

  # Assumes the demo workspace (scripts/screenshot.js, demoRoadmapRuns) gets a finished run (mock: false)
  # whose id ends in "-res00225", with: result.md (Result); one evidence screenshot "Dashboard after the
  # change" (Screenshots & images); test-results.json (Tests); review-report.md (Reports); handoffs/
  # developer-1.md, decisions.tsv and logs/develop-1.log (Process); internal files that are never listed:
  # owner.json, a seeded skill under scratch/ (SKILL.md) and a seeded workflow (software-development.yaml)
  @issue-225
  Scenario: The run's artifacts open on what it produced, its result summary first
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open the demo run "res00225"
    And I open the run's Artifacts tab
    Then the artifacts show "Produced"
    And the first artifact is "result.md"
    And the artifact categories are "Result, Screenshots & images, Tests, Reports"
    And the artifacts do not list "developer-1.md"
    And the artifacts do not list "develop-1.log"
    And the artifacts do not list "SKILL.md"
    And the artifacts do not list "owner.json"

  @issue-225
  Scenario: Show all adds the run's process files but never its internal files
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open the demo run "res00225"
    And I open the run's Artifacts tab
    And I choose "Show all" in the artifacts
    Then the artifacts show "Show all"
    And the artifacts list "developer-1.md"
    And the artifacts list "decisions.tsv"
    And the artifacts list "develop-1.log"
    And the artifacts do not list "SKILL.md"
    And the artifacts do not list "owner.json"
    And the artifacts do not list "software-development.yaml"

  @issue-225
  Scenario: A category chip on the Artifacts screen keeps only that category
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open the Artifacts tab of Runs
    And I find the run "res00225" on the Artifacts screen
    Then the artifacts show "Produced"
    When I filter the artifacts by "Screenshots & images"
    Then the artifact filter "Screenshots & images" is on
    And the artifacts list "Dashboard after the change"
    And the artifacts do not list "result.md"
    And the artifacts do not list "test-results.json"
    And the artifacts do not list "review-report.md"

  # Assumes the demo workspace gets a finished run (mock: false) whose id ends in "-new00185": its final
  # screenshots round has the pair "Export dialog" (original + modified), "New export button" whose
  # original side matched nothing (an element only the change adds: modified image only, recorded as a
  # new element, not as an error) and "Settings page" whose modified capture failed (a real error)
  @issue-185
  Scenario: A new element is counted apart, not as a screenshot error
    Given the app is open
    And a finished demo run "new00185" with a new-element screenshot and a failed screenshot
    When I open the demo run "new00185"
    And I open the run's Artifacts tab
    Then the run's screenshot summary mentions "1 new element (no original)"
    And no screenshot error mentions "New export button"

  @issue-185
  Scenario: A new element shows its modified image alone
    Given the app is open
    And a finished demo run "new00185" with a new-element screenshot and a failed screenshot
    When I open the demo run "new00185"
    And I open the run's Artifacts tab
    Then the screenshot "New export button" shows only its modified image
    And the screenshot "New export button" is marked "new element (no original)"
    And the screenshot "Export dialog" shows its original and modified images

  @issue-185
  Scenario: A real screenshot failure is still listed as an error
    Given the app is open
    And a finished demo run "new00185" with a new-element screenshot and a failed screenshot
    When I open the demo run "new00185"
    And I open the run's Artifacts tab
    Then a screenshot error mentions "Settings page"
