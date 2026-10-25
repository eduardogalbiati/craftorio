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

  # #466: agent-written markdown is untrusted. Its raw HTML keeps no form, button, input, textarea,
  # select or style, and the window never navigates (a link opens nothing but http(s) pages, in the
  # browser). The steps add a markdown report to the demo run "-res00225"; its form and link point
  # at a local HTML page outside the app.
  @issue-466
  Scenario: A form in an agent's report shows its text but no button that leaves the app
    Given the app is open
    And the demo run "res00225" has a report "audit-report.md" reading "The audit found no issue." with a form button "Open the report" to a local page
    When I open the demo run "res00225"
    And I open the run's Artifacts tab
    And I open the artifact "audit-report.md"
    Then the artifact shows "The audit found no issue."
    And the artifact shows no "Open the report" button
    And the app is still on its own page

  # @fixme until #556 (release 1.3.0): never passed: #466's sanitizer drops the file: href the step clicks
  @issue-466 @fixme
  Scenario: A link to a local page in an agent's report keeps the app on its page
    Given the app is open
    And the demo run "res00225" has a report "audit-report.md" reading "The audit found no issue." with a link "the full log" to a local page
    When I open the demo run "res00225"
    And I open the run's Artifacts tab
    And I open the artifact "audit-report.md"
    And I click the link "the full log" in the artifact
    Then the app is still on its own page
    And the artifact shows "The audit found no issue."

  # #477 (SEC-12): a file of a kind the app does not know (an agent-written summary.cmd) is never
  # opened with the system's default program from the Artifacts screen (on Windows a .cmd would run):
  # its only action is "Show in folder"; documents keep "Open". Assumes the Artifacts screen's viewer
  # (the selected file's toolbar and preview) gets data-testid="artifact-viewer". The step writes the
  # file into the demo run "-res00225"'s folder; Show in folder is never clicked (it opens the file manager).
  @issue-477
  Scenario: A document on the Artifacts screen keeps its Open action
    Given the app is open
    And a finished demo run "res00225" with a result summary, screenshots, tests, reports, process and internal files
    When I open the Artifacts tab of Runs
    And I find the run "res00225" on the Artifacts screen
    And I open the artifact "result.md"
    Then the artifact viewer offers "Open"
    And the artifact viewer offers "Show in folder"

  @issue-477
  Scenario: A file of unknown kind is only shown in its folder, never opened
    Given the app is open
    And the demo run "res00225" has an agent-written file "summary.cmd" reading "@echo off"
    When I open the Artifacts tab of Runs
    And I find the run "res00225" on the Artifacts screen
    And I choose "Show all" in the artifacts
    And I select the artifact "summary.cmd"
    Then the artifact viewer offers "Show in folder"
    And the artifact viewer offers no "Open"
