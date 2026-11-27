Feature: A project's City and Health tabs tell the owner where the code hurts and what to refactor first
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
  #730: the Architecture tab and its "Facts | City" switch are gone. The City tab holds the city with its
  "Analyze this project" (a refresh once there is a plan, with the refresh advice and the estimate); the
  Health tab holds the facts, the Oracle's report and its findings, each with "Create issue" and "Create
  issue and prioritize" instead of "Send to Refactor", and "Create issues" instead of "Send all to Refactor".

  @issue-356
  Scenario: A project whose folder is not a git repository has no facts and nothing to analyse
    Given the app is open
    When I open "Projects" in the sidebar
    And I open the project "demo-app" from the Projects screen
    And I open the "Health" project tab
    Then the project tab "Health" is selected
    And the Health tab says the project folder is not a git repository
    And the Health tab offers no "Analyze this project" button

  @issue-356
  Scenario: A saved report leads the tab, its findings marked new, above the git hotspots
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the Health tab shows the report summary "Billing rules are split between the API and the export script."
    And the Health tab lists the finding "Discount rule duplicated in the API and the export" marked "new" with a "Create issue" control
    And the Health hotspot table lists "src/billing.js" and "tools/export.py" above the report summary
    And the Health tab says what the numbers cannot tell

  # #730: the run starts on the City; the Health tab reads the saved report the first time it is opened.
  @issue-356 @issue-381 @issue-730
  Scenario: Analyzing a never-analysed project from its City starts one run, and Health shows its report when it ends
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab offers the "Analyze this project" button
    When I click "Analyze this project" on the city
    Then a project map run has started
    And the City tab shows the analysis running
    And the project map run waits at no gate
    And the City tab no longer shows the analysis running
    When I open the "Health" project tab
    Then the Health tab shows a report summary

  @issue-372 @issue-381
  Scenario: "Analyze this project" shows its estimate and starts the project map run with no confirmation and no gate
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no project map
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab offers the "Analyze this project" button
    And the "Analyze this project" button shows its cost estimate or says there is none yet
    And no project map run has started
    When I click "Analyze this project" on the city
    Then a project map run has started
    And the project map run waits at no gate

  @issue-372 @issue-730
  Scenario: A project with a saved map offers the action as a refresh and starts nothing on its own
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a project map that covers both files
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab offers the "Analyze again" button
    And the City tab does not advise refreshing the map
    And no project map run has started

  @issue-372
  Scenario: The City advises refreshing the map when files match no district and a new top-level folder appears
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a project map that only covers the JavaScript file
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab advises refreshing the map
    And the City tab offers the "Analyze this project" button
    And no project map run has started

  @issue-373 @quarantine
  Scenario: The City view draws the project as a city, its header naming files, zones and districts
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city header names "billing-service" with 2 files, 2 zones and 2 districts
    When I colour the city by "Zone"
    Then the city legend lists "Backend" and "Tooling"

  @issue-373 @issue-381 @quarantine
  Scenario: A project without a city plan shows its folders as a city and offers to analyze it
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city header counts 2 files
    And the city offers "Analyze this project" with a cost estimate in US$

  @issue-381 @quarantine
  Scenario: The city expands over the whole window and comes back with Esc
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I expand the city
    Then the city covers the whole window
    When I press Escape on the city
    Then the city is back inside the tab

  @issue-374 @quarantine
  Scenario: With no run in progress the city says no agent is working on the project
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I turn the city's Live switch on
    Then the city says "No agent is working on this project"

  @issue-374 @quarantine
  Scenario: An agent of a run in progress shows on the city, and a run of another project does not
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    And a run in progress of "demo-app" where the "tester" agent of step "write_tests" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I turn the city's Live switch on
    Then the city shows the agent "developer · implement"
    And the city does not show the agent "tester · write_tests"
    And the city shows no collision risk

  @issue-374 @quarantine
  Scenario: Two runs in progress changing the same file mark it as a collision risk that links to the Conflict map
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    And a run in progress of "billing-service" where the "refactorer" agent of step "refactor" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I turn the city's Live switch on
    Then the city shows the agent "developer · implement"
    And the city shows the agent "refactorer · refactor"
    And the city marks "src/billing.js" as a collision risk with a link to the Conflict map
    When I follow the city's link to the Conflict map
    Then the project tab "Conflict map" is selected

  # The demo project "demo-app" has no git repository and no city plan, so the issue's project is the
  # seeded "billing-service" (src/billing.js in the district Billing of the zone Backend,
  # tools/export.py in Export of Tooling) with its own synced backlog and roadmap.
  # Since #430 "Show on the map" opens the city in a modal over the screen it was asked from (#556).
  @issue-375 @issue-556 @quarantine
  Scenario: "Show on the map" on a Backlog issue opens the city with the issue's expected footprint
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js", "tools/export.py" and "src/refunds.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city opens in a modal over the "Backlog" screen
    And the city impact header names the issue "Change the discount rule"
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city impact header gives the share of the files in the Danger Zone as a percentage
    And the city lists "src/refunds.js" apart as a new file expected in "Billing"

  @issue-375 @issue-556 @quarantine
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
    Then the city opens in a modal over the "Roadmap" screen
    And the city legend lists "Change the discount rule" and "Round the export totals"
    And the city marks "src/billing.js" as a conflict of the stage
    And the city does not mark "tools/export.py" as a conflict of the stage

  @issue-427 @issue-556 @quarantine
  Scenario: Paths cited with a line range count as the files they name
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js:10-20", "tools/export.py:4–9" and "src/billing.js:30-32:4"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city opens in a modal over the "Backlog" screen
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city lists no new file for the issue

  @issue-427 @issue-556 @quarantine
  Scenario: A root file name the repository lacks is not counted as an expected file
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js" and "1792597401661-0000.json"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city opens in a modal over the "Backlog" screen
    And the city impact header counts 1 file, in the district "Billing" and the zone "Backend"
    And the city lists no new file for the issue
    And the city impact header does not mention "1792597401661-0000.json"

  @issue-427 @issue-556 @quarantine
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
    Then the city opens in a modal over the "Roadmap" screen
    And the city marks "src/billing.js" as a conflict of the stage
    And the city does not mark "tools/export.py" as a conflict of the stage

  @issue-429 @issue-556 @quarantine
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
    Then the city opens in a modal over the "Backlog" screen
    And the city impact header counts 2 files, in the districts "Billing" and "Export" and the zones "Backend" and "Tooling"
    And the city lists "src/refunds.js" apart as a new file expected in "Billing"
    And the city legend lists "Expected files" and "Cited in the issue"
    And the city legend gives "Expected files" a colour of its own, apart from "Cited in the issue"

  @issue-429 @issue-556
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
    When I close the city modal
    And I open "Backlog" in the sidebar
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
    And I open the "Health" project tab
    Then the Health hotspot table shows a measured complexity for "src/billing.js"

  @issue-385
  Scenario: Without lizard the tab names the language not measured and how to install the tool, never a zero
    Given the complexity tool lizard is not installed on this machine
    And the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the Health tab lists "Python" as the only language whose complexity is not measured
    And the Health tab says how to measure it with "pip install lizard", which needs Python
    And the Health hotspot table shows the complexity of "tools/export.py" as not measured, not zero

  @issue-386
  Scenario: The Health tab leads with a one-row summary and keeps its caveats behind a button
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the Health tab leads with a one-line verdict above the findings
    And the summary shows at most 3 risk cards, each with a score from 0 to 100
    And the summary shows how many files are in the Danger Zone
    And the summary shows a languages bar whose legend gives "JavaScript" and "Python" in percent
    And the Health tab keeps what the numbers cannot tell out of sight
    When I open the caveats of the Health tab
    Then the Health tab shows what the numbers cannot tell

  @issue-386
  Scenario: A finding shows one line and opens its details on demand
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the finding "Discount rule duplicated in the API and the export" shows a score and a one-line summary
    And the details of the finding "Discount rule duplicated in the API and the export" are hidden
    When I click "Read more" on the finding "Discount rule duplicated in the API and the export"
    Then the details of the finding "Discount rule duplicated in the API and the export" show its evidence and its refactor
    When I filter the findings by "high" severity
    Then the Health tab lists only the 2 high-severity findings

  # #730: "Create issues" replaces "Send all to Refactor": it files the findings shown that have no issue
  # yet, into the project's synced backlog in simulation (the backlog issue gives it one), never with gh/glab.
  @issue-386 @issue-730
  Scenario: Create issues files only the findings that have no issue yet
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    And I click "Create issue" on the Health finding "Billing module changes in every commit"
    Then the Health finding "Billing module changes in every commit" shows the link to its issue instead of its buttons
    When I create the issues of all the findings of the Health tab
    Then the toast says "Created 3 issues"
    And every finding of the Health tab shows the link to its own issue
    And the synced backlog of "billing-service" has the open issue of "Discount rule duplicated in the API and the export" labelled "refactor"

  # City v2 (#449): each file is a building of one of six kinds (shed, pavilion, hall, block, tower,
  # complex) instead of a plain box; its cards and the overlays behave as before.
  @issue-449 @quarantine
  Scenario: The city draws each file as a new building whose cards still open on search and on hover
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city header names "billing-service" with 2 files, 2 zones and 2 districts
    And the city draws its 2 files as buildings of the new kinds
    When I search the city for "src/billing.js"
    Then the city card of "src/billing.js" names its district "Billing" and its zone "Backend" and offers "Open in Facts"
    When I close the city card
    Then pointing at the middle of the city shows the hover card of "src/billing.js"

  @issue-449 @issue-556 @quarantine
  Scenario: "Show on the map" still highlights the issue's building and greys the others
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city opens in a modal over the "Backlog" screen
    And the city impact header names the issue "Change the discount rule"
    And the city highlights the building "src/billing.js" and greys "tools/export.py"

  @issue-449 @quarantine
  Scenario: An agent at work still lights up the building it changes
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I turn the city's Live switch on
    Then the city shows the agent "developer · implement"
    And the city highlights the building "src/billing.js" and greys "tools/export.py"

  # City life (#450): a "City life" switch in the city header (a tree and a lamp) shows or hides the
  # trees, benches, lamps, cars and lamp pools without rebuilding the city, on by default in the
  # City tab; a "Glow" switch turns the bloom off.
  @issue-450 @quarantine
  Scenario: City life is on by default and turning it off hides the trees and cars without rebuilding the city
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the "City life" switch of the city is on
    And the city shows its trees, benches, lamps and cars
    When I turn the "City life" switch of the city off
    Then the "City life" switch of the city is off
    And the city shows no trees, benches, lamps or cars
    And the city on screen is the same one, not rebuilt, with its 2 buildings

  @issue-450 @quarantine
  Scenario: Turning City life back on brings the trees and cars back
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I turn the "City life" switch of the city off
    Then the city shows no trees, benches, lamps or cars
    When I turn the "City life" switch of the city on
    Then the "City life" switch of the city is on
    And the city shows its trees, benches, lamps and cars
    And the city on screen is the same one, not rebuilt, with its 2 buildings

  @issue-450 @quarantine
  Scenario: The city's Glow can be turned off
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the "Glow" switch of the city is on
    When I turn the "Glow" switch of the city off
    Then the "Glow" switch of the city is off
    And the city on screen is the same one, not rebuilt, with its 2 buildings

  # City modes (#440): the city is in one mode at a time (Explore by default, Live, Run replay, Issue
  # impact, Stage, Release); opening one replaces the previous one's layers, panels and legend rows; the
  # title names the mode; Close goes back to where it was opened from (in Architecture: Explore). The
  # release project "shop" is the tagged repository of fronts/analyser/features/steps/release-city.steps.js.
  @issue-440 @quarantine
  Scenario: The city opens in Explore titled with the project, and shows the agents at work only in Live
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And a run in progress of "billing-service" where the "developer" agent of step "implement" edits "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city is in the "Explore" mode titled "billing-service"
    And the city shows the "Most connected" panel
    And the city shows no "Agents at work" panel
    And the city's Live switch is off
    When I turn the city's Live switch on
    Then the city is in the "Live" mode titled "Live"
    And the city shows the "Agents at work" panel
    And the city shows the agent "developer · implement"
    And the city shows no "Most connected" panel

  # The city modal covers the side bar (#430): it is closed before the Releases screen opens (#556).
  @issue-440 @issue-556 @quarantine
  Scenario: A release opened on the map shows the release mode alone, nothing left of an earlier impact preview
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    And the backlog of "shop" has the open issue "Add the new module" whose body cites "src/new.js"
    And a run in progress of "shop" where the "developer" agent of step "implement" edits "src/edit.js"
    When I open "Backlog" in the sidebar
    And I choose the project "shop" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Add the new module"
    Then the city is in the "Issue impact" mode titled "Issue #1"
    And the city legend has the "Cited in the issue" row
    When I close the city modal
    And I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    Then the city opens in a modal over the "Releases" screen
    And the city is in the "Release" mode titled "Release 1.1.1 → 1.1.2"
    And the city release header compares "1.1.1" to "1.1.2"
    And the city shows no "Agents at work" panel
    And the city shows no "Most connected" panel
    And the city shows no "Impact preview" panel
    And the city legend has the "Added" row
    And the city legend has no "Cited in the issue" row

  # In the city modal (#430) the mode's Close closes the modal, back to the Backlog under it (#556).
  @issue-440 @issue-556
  Scenario: Closing an issue's impact preview goes back to the Backlog and leaves no impact behind on the city
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Board as a list
    And I click "Show on the map" on the Backlog issue "Change the discount rule"
    Then the city is in the "Issue impact" mode titled "Issue #1"
    And the city impact header names the issue "Change the discount rule"
    And the city legend has the "Cited in the issue" row
    When I close the city's mode
    Then no city modal is open
    And the Backlog screen is shown
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the city is in the "Explore" mode titled "billing-service"
    And the city shows no "Impact preview" panel
    And the city shows the "Most connected" panel
    And the city legend has no "Cited in the issue" row

  # City panels (#441): every panel has a chevron that minimizes it to its title row and expands it with
  # its content as it was; the legend closes and a small "Legend" button brings it back; what is
  # minimized is remembered per mode.
  @issue-441
  Scenario: A minimized panel keeps only its title row and expands with its content as it was
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    And I pick the issue "#12" in the release's issue filter
    Then the city release header counts 1 added, 0 changed and 0 removed
    When I minimize the city's "Release" panel
    Then the city's "Release" panel shows only its title row
    When I expand the city's "Release" panel
    Then the city's "Release" panel is expanded
    And the release's issue filter still shows "#12"
    And the city release header counts 1 added, 0 changed and 0 removed

  @issue-441 @quarantine
  Scenario: The legend closes and the "Legend" button brings it back
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I colour the city by "Zone"
    Then the city legend has the "Backend" row
    When I close the city legend
    Then the city shows no legend but a "Legend" button
    When I bring the city legend back with its "Legend" button
    Then the city legend has the "Backend" row
    And the city legend has the "Tooling" row
    And the city shows no "Legend" button for the legend

  # In the city modal (#430) the mode's Close closes the modal, so the side bar is reachable again (#556).
  @issue-441 @issue-556
  Scenario: A panel minimized in the release mode is still minimized when a release opens again, not in Explore
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    And I minimize the city's "Release" panel
    And I close the city's mode
    Then no city modal is open
    When I open "Projects" in the sidebar
    And I open the project "shop" from the Projects screen
    And I open the "City" project tab
    Then the city is in the "Explore" mode titled "shop"
    And the city's "Most connected" panel is expanded
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    Then the city is in the "Release" mode titled "Release 1.1.1 → 1.1.2"
    And the city's "Release" panel shows only its title row

  # "Create issue and prioritize" waits for the owner's OK (#435, #730, which replaced Send to Refactor): the
  # click files a `refactor` issue and plans it in a disabled stage at the end of the roadmap, named like
  # "Refactor (waiting for your OK)". The finding then shows its issue's link and a badge naming the issue
  # and the stage ("#432 · stage 117, waiting for your OK") where its buttons were. The backlog issues give
  # the project a synced GitHub backlog; in simulation the issue is never filed with gh. The new/kept
  # badges follow the interface language (#447).
  @issue-435 @issue-730
  Scenario: "Create issue and prioritize" files the finding and plans it in a disabled refactor stage at the end of the roadmap
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    And the backlog of "billing-service" has the open issue "Round the export totals" whose body cites "tools/export.py"
    And the roadmap of "billing-service" has the planned stage "Billing fixes" with the items "Change the discount rule" and "Round the export totals"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    And I click "Create issue and prioritize" on the Health finding "Billing module changes in every commit"
    Then the Health finding "Billing module changes in every commit" shows the link to its issue instead of its buttons
    And the Health finding "Billing module changes in every commit" names its issue and a stage waiting for your OK
    When I open "Backlog" in the sidebar
    And I choose the project "billing-service" in the header
    And I open the Roadmap
    Then the roadmap's last stage comes after "Billing fixes", is disabled, is named like "Refactor (waiting for your OK)" and holds "Billing module changes in every commit"

  @issue-447
  Scenario: In Português (Brasil) the findings' new and kept badges read "novo" and "mantido"
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and two saved architecture reports, the later one keeping "Discount rule duplicated in the API and the export" and adding "Billing module changes in every commit"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Saúde" project tab
    Then the status badge of the finding "Billing module changes in every commit" reads "novo"
    And the status badge of the finding "Discount rule duplicated in the API and the export" reads "mantido"

  # #732: "Analyze this project" on the City reads the project's own folder, not the window's cached
  # project list. A project the wizard just imported (a local git repository with some code, its file://
  # URL; the clone done, the analysis skipped, no reload) analyses at once instead of failing with "The
  # project has no folder". The steps of the wizard are features/steps/onboarding.steps.js's.
  @issue-732 @quarantine
  Scenario: A project the wizard just imported is analysed from its City without a "no folder" error
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "city-732"
    And I go to the next step of the wizard
    Then the progress tray shows the project "city-732" as ready
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "city-732" is open
    When I open the "City" project tab
    Then the City tab shows the project city
    And no project map run has started
    When I click "Analyze this project" on the city
    Then the city shows no analysis error
    And a project map run has started

  # #732: a project whose folder is gone from this machine (moved aside while its City is on screen,
  # no reload) says why in the interface language and what to do, with no cost estimate on a retry that
  # cannot work. The saved report gives the action a real estimate (≈ US$ 0.42) before the click.
  @issue-732 @quarantine
  Scenario: In Português (Brasil) a project with no folder on this machine says so on its City, with what to do and no estimate
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Cidade" project tab
    Then the City tab shows the project city
    And the city offers "Analisar este projeto" with a cost estimate in US$
    When the folder of the project "billing-service" is gone from this machine
    And I click "Analisar este projeto" on the city
    Then the city says the analysis failed with "O projeto não tem pasta nesta máquina", to clone the project again or to point its folder from the "Visão geral" tab
    And the city's retry shows no cost estimate in US$

  # #730: the Health tab (Saúde) takes over the Architecture tab's facts and the Refactor tab: the git facts on
  # top, then the Oracle's latest report (its summary, a verdict per area) and its findings. A finding's "Create
  # issue" files it as a `refactor` issue and nothing more; afterwards the finding shows the issue's link where its
  # buttons were. In simulation the issue is filed into the project's synced backlog with the next free number,
  # never with gh/glab (packages/engine/fronts/analyser/channels/refactor.js simulatedFiler): the backlog issue below gives
  # the project its synced GitHub backlog (#1), so the finding's issue is #2.
  @issue-730
  Scenario: Health shows the git facts above the Oracle's report, and a finding's "Create issue" turns into its issue's link
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a saved architecture report with high, medium and low findings
    And the backlog of "billing-service" has the open issue "Change the discount rule" whose body cites "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Health" project tab
    Then the project tab "Health" is selected
    And the Health tab shows the git facts of "src/billing.js" and "tools/export.py" above the Oracle's report
    And the Health tab shows the report summary "Billing rules are split between the API and the export script." with a verdict for the areas "src" and "tools"
    And the Health finding "Billing module changes in every commit" offers "Create issue" and "Create issue and prioritize"
    When I click "Create issue" on the Health finding "Billing module changes in every commit"
    Then the Health finding "Billing module changes in every commit" shows the link to its issue instead of its buttons
    And the synced backlog of "billing-service" has the open issue of "Billing module changes in every commit" labelled "refactor"
    And the roadmap of "billing-service" does not plan the issue of "Billing module changes in every commit"
    And the Health finding "Discount rule duplicated in the API and the export" offers "Create issue" and "Create issue and prioritize"

  # #782: a project with more than half of its files not measured has no useful Quadrant, so it opens in Churn
  # and the legend says what is missing and why. 5 of the 6 files are Rust: 83%. With lizard on the machine the
  # Rust files are measured, so the scenario skips itself there, as the #385 ones do. The reload makes sure the
  # owner's choice is kept, not just still in the open window.
  @issue-782 @quarantine
  Scenario: A mostly unmeasured project opens in Churn, says what is not measured, and going back to Quadrant is kept
    Given the complexity tool lizard is not installed on this machine
    And the app is open
    And the workspace has a git project "engine-782" with mostly Rust files, a city plan and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "engine-782" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city is coloured by "Churn"
    And the city legend says "83% not measured: Rust needs clippy or rust-code-analysis"
    And the city legend says it opened in Churn because most files are not measured
    And the city legend says how to get "clippy"
    And the city offers to colour by "Quadrant"
    When I accept the city's offer to colour by "Quadrant"
    Then the city is coloured by "Quadrant"
    And the city legend says "83% not measured: Rust needs clippy or rust-code-analysis"
    And the city offers to colour by "Churn"
    When I reload the app
    And I open "Projects" in the sidebar
    And I open the project "engine-782" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city is coloured by "Quadrant"

  # #782: the city draws its labels only for what is pointed at. The window.ProjectCity.stats() of the city gives no
  # building's position on screen, so the search flies to the building first (its label must show), then the
  # pointer goes to the middle of the city, where the flight left it (as the #449 hover card scenario does).
  # Leaving the city takes the label away again. Zone labels stay: they are not building or district labels.
  @issue-782 @quarantine
  Scenario: The city shows no building or district labels until a building is pointed at
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan with the landmark "The till" on "src/billing.js"
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city shows no building or district labels
    When I search the city for "src/billing.js"
    Then the city labels "src/billing.js" as "The till" in the district "Billing"
    When I close the city card
    Then pointing at the middle of the city shows the hover card of "src/billing.js"
    And the city labels "src/billing.js" as "The till" in the district "Billing"
    When I move the pointer off the city
    Then the city shows no building or district labels

  # #782: a plan that matches the code and its commit is current: the action is a quiet "Analyze again" with the
  # analysis's date and commit. A commit landed since then brings back the primary action with the reason.
  @issue-782
  Scenario: A current plan offers "Analyze again" as secondary with its date, and a new commit brings back the primary action
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file, a city plan and a saved architecture report
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab offers the "Analyze again" button
    And the City tab's analysis button is secondary
    And the "Analyze again" button shows its cost estimate or says there is none yet
    And the city says when "billing-service" was analyzed and at which commit
    When a new commit lands on "billing-service"
    And I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the city says "1 commit since the last analysis" with the analysis button next to it
    And the City tab offers the "Analyze this project" button
    And the City tab's analysis button is primary

  # #847: with the interface in Português (Brasil) the Health tab's facts read in Portuguese: the excluded files'
  # line (nothing excluded in this project), the complexity line (JavaScript measured inside the app, Python not
  # without lizard, as in the #385 scenarios: skipped on a machine with lizard) and the quality gate's chips (no
  # gate configured). The texts below are the English ones the owner found left on the tab.
  @issue-847
  Scenario: With the interface in Português (Brasil), the Health tab's excluded files, complexity and quality gate read in Portuguese
    Given the complexity tool lizard is not installed on this machine
    And the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and no architecture report
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Saúde" project tab
    Then the Health tab shows none of these English texts:
      | Excluídos: nothing                                           |
      | Complexity: measured for JavaScript; not measured for Python |
      | Complexity · missing                                         |
      | Coverage · missing                                           |
      | Duplication · missing                                        |

  # #847: the "Most connected" panel ("Mais conectados") of a city whose drawn files import nothing from each other
  # (a JavaScript and a Python file) says so in one Portuguese sentence, not a Portuguese start with the English
  # reason glued after it.
  @issue-847
  Scenario: With the interface in Português (Brasil), the city's "Most connected" panel says in one Portuguese sentence that it has nothing to list
    Given the app is open
    And the workspace has a git project "billing-service" with a JavaScript and a Python file and a city plan
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "Cidade" project tab
    Then the city shows the "Most connected" panel
    And the city's "Most connected" panel says in one sentence that it has nothing to list, with none of these English texts:
      | import between the drawn files was found |
      | No connections to list                   |
