Feature: Start Test on a built work item of the Roadmap
  A work item whose plan is built (every row of its plan.md Progress table done) offers "Start Test" on
  its Roadmap card (#702): a click starts the sdlc-test workflow on that item, which records test.md and
  ends at the code owner's gate. The Test stage never starts by itself and is never offered on an item
  still in Build. The seeds: a stage "Work items" of two done roadmap items, each with its docs/work/<item>/
  folder (inputs.item) in the demo project's folder, a local git repository; the runs are simulated.

  @issue-702
  Scenario: A built work item offers Start Test, and a click starts its Test run
    Given the app is open
    And the roadmap has the work item "Export to CSV" with 3 of 3 Progress steps done
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I show all the items of the roadmap
    Then the roadmap item "Export to CSV" offers "Start Test" on its card
    When I click "Start Test" on the roadmap item "Export to CSV"
    Then a run of the workflow "sdlc-test" started for the work item "export-to-csv"
    And the roadmap item "Export to CSV" shows its Test run
    And the roadmap item "Export to CSV" offers no "Start Test" button

  @issue-702
  Scenario: A work item still in Build offers no Start Test, and nothing starts by itself
    Given the app is open
    And the roadmap has the work item "Export to CSV" with 3 of 3 Progress steps done
    And the roadmap has the work item "Import from CSV" with 2 of 3 Progress steps done
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I show all the items of the roadmap
    Then the roadmap item "Import from CSV" offers no "Start Test" button
    And the roadmap item "Export to CSV" offers "Start Test" on its card
    And no run of the workflow "sdlc-test" has started

  @issue-702
  Scenario: The Test run of a built work item waits at the code owner's gate
    Given the app is open
    And the roadmap has the work item "Export to CSV" with 3 of 3 Progress steps done
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I show all the items of the roadmap
    And I click "Start Test" on the roadmap item "Export to CSV"
    And I open the Test run of the roadmap item "Export to CSV"
    Then a gate card waits for my approval
    And the gate card shows its summary and its buttons
