Feature: A project's Architecture tab tells the owner where the code hurts and what to refactor first
  The Architecture tab of a project's page (Projects › <project> › Architecture) shows facts read
  from git (a hotspot table: file, lines, commits, rank, top co-changing file) and what those numbers
  cannot tell. One action, "Analyze this project" (#381), shows its cost estimate (≈ US$, or "no
  estimate yet" before the first real run) and starts one run with no gate: the cartographer maps
  the project into a city plan, then the Oracle analyses it and saves a report: a summary, findings
  marked new or gone since the previous report, each with "Send to Refactor". The tab follows the
  run ("Analyzing this project" with its step) and shows the report when it ends. It says when the
  folder is not a git repository, when the range has no commits, when the project was never
  analysed, how many runs finished since the analysis, and when the analysis failed. The app runs in
  simulation: the run is simulated, never a real model. The demo project "demo-app"
  (features/support/app.js) is a plain folder, not a git repository. The tab advises a refresh of
  the map, without starting one, when more than 5% of the drawn files match no district or a new
  top-level folder appears.
  A "Facts | City" switch shows the project as a 3D city instead (#373), remembered per window: a
  header with the project, files, zones and districts, "Colour by" with its legend, and without a
  city plan the folders as districts with the same "Analyze this project" action and its estimate.
  The City view shows the agents of the project's runs in progress (#374), read from their
  events.jsonl: "<agent> · <step>" on the building the agent last changed, a building two runs in
  progress change marked as a collision risk with a link to the Conflict map, and "No agent is
  working on this project" when none runs. Runs of other projects are not shown.
  Complexity (#385): JavaScript and TypeScript are measured inside the app, with no tool to install;
  other languages need lizard. Without it the tab names the languages not measured and how to
  install the tool (`pip install lizard`, which needs Python); a file not measured never shows zero.
  These scenarios are skipped on a machine where lizard is installed.
  The Facts view reads for a human (#386): a one-row summary first (a one-line verdict, up to 3 risk
  cards with a 0-100 score, the Danger Zone count, a languages bar with percentages), each finding one
  line with a score and its details behind "Read more", filters by severity, "Send all to Refactor"
  that skips findings already sent, and the caveats behind an ⓘ button.

  @issue-356
  Scenario: A project whose folder is not a git repository has no facts and nothing to analyse
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the "Architecture" project tab
    Then the project tab "Architecture" is selected
    And the Architecture tab says the project folder is not a git repository
    And the Architecture tab offers no "Analyze this project" button

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
    And the "Analyze this project" button shows a cost estimate in US$

  @issue-356 @issue-381
  Scenario: Analyzing a never-analysed project starts one run and shows its report when it ends
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab says the project was never analysed
    And the Architecture tab offers the "Analyze this project" button
    When I click "Analyze this project" on the Architecture tab
    Then a project map run has started
    And the Architecture tab shows the analysis running
    Then the Architecture tab shows a report summary
    And the Architecture tab no longer shows the analysis running

  @issue-372 @issue-381
  Scenario: "Analyze this project" shows its estimate and starts the project map run with no confirmation and no gate
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no project map
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab offers the "Analyze this project" button
    And the "Analyze this project" button shows its cost estimate or says there is none yet
    And no project map run has started
    When I click "Analyze this project" on the Architecture tab
    Then a project map run has started
    And the project map run waits at no gate

  @issue-372
  Scenario: A project with a saved map offers the same action and starts nothing on its own
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a project map that covers both files
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab offers the "Analyze this project" button
    And the Architecture tab does not advise refreshing the map
    And no project map run has started

  @issue-372
  Scenario: The tab advises refreshing the map when files match no district and a new top-level folder appears
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a project map that only covers the JavaScript file
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab advises refreshing the map
    And the Architecture tab offers the "Analyze this project" button
    And no project map run has started

  @issue-373
  Scenario: The City view draws the project as a city, its header naming files, zones and districts
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    And the city header names "billing-service" with 2 files, 2 zones and 2 districts
    When I colour the city by "Zone"
    Then the city legend lists "Backend" and "Tooling"

  @issue-373
  Scenario: The City view stays chosen after leaving the Architecture tab and coming back
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    When I open the "Overview" project tab
    And I open the "Architecture" project tab
    Then the Architecture tab shows the project city
    And the "City" view of the Architecture tab is the one selected

  @issue-373 @issue-381
  Scenario: A project without a city plan shows its folders as a city and offers to analyze it
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    And the city header counts 2 files
    And the city offers "Analyze this project" with a cost estimate in US$

  @issue-381
  Scenario: The city expands over the whole window and comes back with Esc
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    When I expand the city
    Then the city covers the whole window
    When I press Escape on the city
    Then the city is back inside the tab

  @issue-374
  Scenario: With no run in progress the city says no agent is working on the project
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    And the city says "No agent is working on this project"

  @issue-374
  Scenario: An agent of a run in progress shows on the city, and a run of another project does not
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    And a run in progress of "demo-app" where the "tester" agent of step "write_tests" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    And the city shows the agent "developer · implement"
    And the city does not show the agent "tester · write_tests"
    And the city shows no collision risk

  @issue-374
  Scenario: Two runs in progress changing the same file mark it as a collision risk that links to the Conflict map
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    And a run in progress of "billing-service" where the "refactorer" agent of step "refactor" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I switch the Architecture tab to "City"
    Then the Architecture tab shows the project city
    And the city shows the agent "developer · implement"
    And the city shows the agent "refactorer · refactor"
    And the city marks "src/billing.js" as a collision risk with a link to the Conflict map
    When I follow the city's link to the Conflict map
    Then the project tab "Conflict map" is selected

  # The demo project "demo-app" has no git repository and no city plan, so the issue's project is the
  # seeded "billing-service" (src/billing.js in the district Billing of the zone Backend,
  # tools/export.py in Export of Tooling) with its own synced backlog and roadmap.
  @issue-375
  Scenario: "Show on the map" on a Backlog issue opens the city with the issue's expected footprint
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js", "tools/export.py" and "src/refunds.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the Architecture tab shows the project city
    And the city impact header names the issue "Change the discount rule"
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city impact header gives the share of the files in the Danger Zone as a percentage
    And the city lists "src/refunds.js" apart as a new file expected in "Billing"

  @issue-375
  Scenario: "Show the stage on the map" colours the stage's items and marks a building both would change as a conflict
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "src/billing.js" and "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    And I click "Show the stage on the map" on the roadmap stage "Billing fixes"
    Then the Architecture tab shows the project city
    And the city legend lists "Change the discount rule" and "Round the export totals"
    And the city marks "src/billing.js" as a conflict of the stage
    And the city does not mark "tools/export.py" as a conflict of the stage

  @issue-427
  Scenario: Paths cited with a line range count as the files they name
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js:10-20", "tools/export.py:4–9" and "src/billing.js:30-32:4"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the Architecture tab shows the project city
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city lists no new file for the issue

  @issue-427
  Scenario: A root file name the repository lacks is not counted as an expected file
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js" and "1792597401661-0000.json"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the Architecture tab shows the project city
    And the city impact header counts 1 file, in the district "Billing" and the zone "Backend"
    And the city lists no new file for the issue
    And the city impact header does not mention "1792597401661-0000.json"

  @issue-427
  Scenario: The stage footprint marks a file two items cite with line ranges as a conflict
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js:10-20"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "src/billing.js:40–52" and "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    And I click "Show the stage on the map" on the roadmap stage "Billing fixes"
    Then the Architecture tab shows the project city
    And the city marks "src/billing.js" as a conflict of the stage
    And the city does not mark "tools/export.py" as a conflict of the stage

  @issue-429
  Scenario: The issue's Expected files section is read as its own source with its own legend colour
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body is:
      """
      The export in `tools/export.py` shows the old discount.

      ## Expected files
      - `src/billing.js`: the discount rule lives here
      - `src/refunds.js` (new): refunds get their own module
      """
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the Architecture tab shows the project city
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city lists "src/refunds.js" apart as a new file expected in "Billing"
    And the city legend lists "Expected files" and "Cited in the issue"
    And the city legend gives "Expected files" a colour of its own, apart from "Cited in the issue"

  @issue-429
  Scenario: After a run the impact card names the source of each hit and miss and compares issues with and without the section
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "tools/export.py"
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body is:
      """
      The discount is applied twice.

      ## Expected files
      - `src/billing.js`: the discount rule lives here
      - `tools/export.py`: the export repeats the rule
      """
    And a finished run of "billing-service" for the issue "Round the export totals" changed "src/billing.js"
    And a finished run of "billing-service" for the issue "Change the discount rule" changed "src/billing.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Round the export totals"
    Then the city impact card shows the hit rate of the run
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city impact card credits the hit "src/billing.js" to "Expected files"
    And the city impact card credits the miss "tools/export.py" to "Expected files"
    And the city impact card gives an average hit rate of 50% with an Expected files section and 0% without

  @issue-385
  Scenario: Without lizard the JavaScript file still has a measured complexity
    Given the complexity tool lizard is not installed on this machine
    And the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture hotspot table shows a measured complexity for "src/billing.js"

  @issue-385
  Scenario: Without lizard the tab names the language not measured and how to install the tool, never a zero
    Given the complexity tool lizard is not installed on this machine
    And the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab lists "Python" as the only language whose complexity is not measured
    And the Architecture tab says how to measure it with "pip install lizard", which needs Python
    And the Architecture hotspot table shows the complexity of "tools/export.py" as not measured, not zero

  @issue-386
  Scenario: The Facts view leads with a one-row summary and keeps its caveats behind a button
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the Architecture tab leads with a one-line verdict above the findings
    And the summary shows at most 3 risk cards, each with a score from 0 to 100
    And the summary shows how many files are in the Danger Zone
    And the summary shows a languages bar whose legend gives "JavaScript" and "Python" in percent
    And the Architecture tab keeps what the numbers cannot tell out of sight
    When I open the caveats of the Architecture tab
    Then the Architecture tab shows what the numbers cannot tell

  @issue-386
  Scenario: A finding shows one line and opens its details on demand
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    Then the finding "Discount rule duplicated in the API and the export" shows a score and a one-line summary
    And the details of the finding "Discount rule duplicated in the API and the export" are hidden
    When I click "Read more" on the finding "Discount rule duplicated in the API and the export"
    Then the details of the finding "Discount rule duplicated in the API and the export" show its evidence and its refactor
    When I filter the findings by "high" severity
    Then the Architecture tab lists only the 2 high-severity findings

  @issue-386
  Scenario: Send all to Refactor sends only the findings not sent yet
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Architecture" project tab
    And I send the finding "Billing module changes in every commit" to Refactor
    And I send all the findings to Refactor
    Then the toast says "Sent 3 findings to the Refactor tab"
    And every finding of the Architecture tab is marked sent to Refactor
    And the Refactor tab of "billing-service" has 4 proposals from the Architecture tab
