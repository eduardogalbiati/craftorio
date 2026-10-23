Feature: Importing a workflow on the Workflows screen
  The Definitions tab imports a workflow from a file, a drop or an https URL. Before anything is
  written, a dialog lists what the workflow does (its steps, its agents and their tools, the commands
  its `action:` lines run, `ship`, `requires`) and says a workflow is code that runs on this machine.
  Cancel writes nothing; Import writes it as a custom workflow under the given name. A workflow the
  loader rejects is refused with the loader's reasons and nothing is written.

  # The fixtures are features/fixtures/workflows/*.yaml, chosen through the screen's file input.
  @issue-488
  Scenario: Importing a workflow file warns that it is code, lists what it does, and adds it as a custom workflow
    Given the app is open
    When I open "Definitions" in the sidebar
    And I import the workflow file "shared-retro-notes.yaml" from the Workflows screen
    Then the import warning says a workflow is code that runs on this machine
    And the import warning lists the step "write_notes", the agent "notes_writer" with the tool "read" and the command "git tag retro-reviewed"
    When I import it under the name "team-retro-notes"
    Then the workflow file "team-retro-notes.yaml" is listed on the Workflows screen as a custom workflow
    And the workspace's workflows folder holds "team-retro-notes.yaml"

  @issue-488
  Scenario: Cancelling the import warning writes nothing
    Given the app is open
    When I open "Definitions" in the sidebar
    And I import the workflow file "shared-retro-notes.yaml" from the Workflows screen
    And I cancel the import warning
    Then no workflow file "shared-retro-notes.yaml" is listed on the Workflows screen
    And the workspace's workflows folder is unchanged

  @issue-488
  Scenario: A workflow the loader rejects is refused with the loader's reasons and nothing is written
    Given the app is open
    When I open "Definitions" in the sidebar
    And I import the workflow file "broken-workflow.yaml" from the Workflows screen
    Then the import is refused, saying the step "only_step" references an unknown agent "ghost_agent"
    And no workflow file "broken-workflow.yaml" is listed on the Workflows screen
    And the workspace's workflows folder is unchanged
