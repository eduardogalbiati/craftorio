Feature: A project's Architecture tab tells the owner where the code hurts and what to refactor first
  The Architecture tab of a project's page (Projects › <project> › Architecture) shows facts read
  from git (a hotspot table: file, lines, commits, rank, top co-changing file) and what those numbers
  cannot tell. "Analyze with the Oracle" shows its cost estimate (≈ US$) and saves a report: a
  summary, findings marked new or gone since the previous report, each with "Send to Refactor".
  The tab says when the folder is not a git repository, when the range has no commits, when the
  project was never analysed, while an analysis runs, how many runs finished since the analysis, and
  when the analysis failed. The app runs in simulation: an analysis is simulated, never a real model.
  The demo project "demo-app" (features/support/app.js) is a plain folder, not a git repository.

  @issue-356
  Scenario: A project whose folder is not a git repository has no facts and nothing to analyse
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the "Architecture" project tab
    Then the project tab "Architecture" is selected
    And the Architecture tab says the project folder is not a git repository
    And the Architecture tab offers no "Analyze with the Oracle" button

  @issue-356
  Scenario: A saved report leads the tab, its findings marked new, above the git hotspots
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab shows the report summary "Billing rules are split between the API and the export script."
    And the Architecture tab lists the finding "Discount rule duplicated in the API and the export" marked "new" with a "Send to Refactor" control
    And the Architecture hotspot table lists "src/billing.js" and "tools/export.py" below the report summary
    And the Architecture tab says what the numbers cannot tell
    And the "Analyze with the Oracle" button shows a cost estimate in US$

  @issue-356
  Scenario: Analyzing a never-analysed project with the Oracle shows a report
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab says the project was never analysed
    And the Architecture tab offers the "Analyze with the Oracle" button
    When I click "Analyze with the Oracle" on the Architecture tab
    Then the Architecture tab shows a report summary
