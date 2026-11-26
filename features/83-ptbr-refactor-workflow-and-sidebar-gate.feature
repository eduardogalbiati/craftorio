Feature: The refactor workflow and the sidebar's waiting run read in Portuguese
  With the interface in Português (Brasil), the Start panel on the Refactor workflow (its description and
  its stations) and the sidebar's run waiting at a gate show no English left over (#83). In English they
  stay as they are.

  # #83: workflows/refactor.yaml's description ("One refactor, done safely, in any language…") and its
  # stations (Pin the behaviour › Green check (pinned) › Refactor › Rule checks › Run suite › Builder ›
  # Review (same behaviour, simpler?) › Merge blocked…) were shown in English in the Start panel.
  # "Refactor" itself is not listed: the Workflow select's option for the workflow may keep that name.
  @issue-83
  Scenario: In Português (Brasil), the Start panel on the Refactor workflow shows its description and its stations in Portuguese
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I click "Iniciar workflow" on the demo project's card
    And I choose the workflow "refactor" in the Start panel
    Then the Start panel shows the "Quando terminar" list
    And the Start panel shows none of these English texts:
      | One refactor, done safely, in any language                 |
      | the test writer pins the target's current behaviour first  |
      | the developer changes structure only                       |
      | No push, no PR                                             |
      | Pin the behaviour                                          |
      | Green check (pinned)                                       |
      | Rule checks                                                |
      | Run suite                                                  |
      | Review (same behaviour, simpler?)                          |
      | Merge blocked                                              |

  # #83: the sidebar's runs in progress list a run waiting at a gate as "Waiting for you · <step>"
  # (packages/ui-kit/app.js renderNavRuns). The run is simulated and starts in English (the Start
  # panel's steps read English labels); "Validated" stops it at a gate; the language is switched there.
  @issue-83
  Scenario: In Português (Brasil), the sidebar's run waiting at a gate reads "Aguardando você"
    Given the app is open
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then the run waiting at a gate in the sidebar reads "Aguardando você" and the step it waits at
    And the run waiting at a gate in the sidebar shows none of these English texts:
      | Waiting for you |
