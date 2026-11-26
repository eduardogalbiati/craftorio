Feature: A new user's path reads in Portuguese
  With the interface in Português (Brasil), what a new user meets from a first issue to a first run (the
  Product Owner's drawer in simulation, the Descoberta board, the Roadmap card, the Assign dialog and the
  Run screen) shows no English left over (#41). In English they stay as they are.

  # #41: the simulated Product Owner's draft starts "**Simulated draft** (no model was called, no code was
  # read)" and its workflow select marks the default workflow " (default)". On the Descoberta board, moving
  # an idea from Triagem straight to Definição asks "This card skips Shape: only bugs and hotfixes take the
  # fast lane."; a card below the clarity bar says "needs grilling: the bar is n%" (pt-BR "precisa de Grill
  # me…") and offers "Grill me", whose interview signs its questions "Grill me". The card in Modelagem is
  # created once the interface is in Portuguese (its gaps are written by the app); the idea in Triagem is
  # accepted from the Inbox before the switch (the step reads English labels).
  @issue-41
  Scenario: In Português (Brasil), the Product Owner's simulated draft and the Descoberta board show no English
    Given the app is open
    And I accepted the idea "Tema escuro" in the Inbox
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Registrar uma issue"
    And I ask the Product Owner "Exportar os pedidos da loja em um arquivo CSV pela tela de pedidos"
    Then the Product Owner's drawer shows a draft of the issue, in the interface language
    And no workflow in the Product Owner's drawer is marked "(default)"
    And the Product Owner's drawer shows none of these English texts:
      | Simulated draft                      |
      | no model was called                  |
      | no code was read                     |
      | Review it below, or tell me what to change |
    When I close the Product Owner
    And the idea "Exportar pedidos em CSV" was captured on the Discovery board and moved to "Shape"
    And I open "Descoberta" in the sidebar
    And I move the Discovery card "Tema escuro" to "Definição"
    Then the confirm dialog offers "Mover assim mesmo" and "Cancelar"
    And the confirm dialog shows none of these English texts:
      | This card skips Shape                    |
      | only bugs and hotfixes take the fast lane |
      | Move anyway                              |
    When I press "Cancelar" in the confirm dialog
    And I open the Discovery card "Exportar pedidos em CSV"
    And I start the interview from the card's panel
    Then the card's panel lists missing points, asks a question and shows a version of its history
    And the card's panel shows none of these English texts:
      | Grill me                |
      | needs grilling          |
      | precisa de Grill me     |
      | the bar is              |
      | at or above the bar of  |

  # #41: a Roadmap card waiting at the pull request's review gate shows "Waiting for you", and a stacked
  # stage's item its "Parent branch" (the waiting stage is roadmap-stack-on-waiting-stage-807's: a real
  # run on disk, owned by another app, nothing starts). The Assign dialog opens on Feature: its inputs
  # "Test order", "Review", "Retrospective after", the Mockup's help ("Folder of a frozen mockup
  # version…") and the developer effort's pills Default / Low / Medium / High / Extra high were in English.
  # The Roadmap comes first: the Assign dialog stays open at the end.
  @issue-41
  Scenario: In Português (Brasil), a waiting Roadmap card and the Assign dialog's inputs show no English
    Given the app is open
    And the backlog has the open issues "Exportar pedidos em CSV" and "Tema escuro"
    And the roadmap's stage "Atrás de um PR" waits for the merge of the pull request #341 of "Item atrás de um PR", made in "Remote" mode on the branch "feat/3970-atras-de-um-pr", before the stage of "Item do próximo estágio"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap card "Item atrás de um PR" shows none of these English texts:
      | Waiting for you |
      | Parent branch   |
    And the roadmap card "Item do próximo estágio" shows none of these English texts:
      | Waiting for you |
      | Parent branch   |
    When I open the Assign dialog for the backlog issue "Exportar pedidos em CSV"
    Then the Assign dialog has the "Feature" workflow chosen
    And the Assign dialog shows none of these English texts:
      | Test order                         |
      | Review                             |
      | Retrospective after                |
      | Folder of a frozen mockup version  |
      | Parent branch                      |
      | Developer effort                   |
      | Default                            |
      | Low                                |
      | Medium                             |
      | High                               |
      | Extra high                         |

  # #41: the Run screen of a simulated Feature run (Local mode, started in English, "Validated" so it
  # stops at a gate) names its steps ("Red check (TDD)"), its status ("Active"), its agents ("Test
  # writer") and its input chips ("Mode: Local", "Validation: Validated" / "Automatic") in English.
  @issue-41
  Scenario: In Português (Brasil), the Run screen names its steps, its agents and its inputs in Portuguese
    Given the app is open
    When I open the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I go back to the run waiting at a gate from the sidebar
    Then the open screen shows none of these English texts:
      | Red check (TDD)        |
      | Active                 |
      | Test writer            |
      | Mode: Local            |
      | Validation: Automatic  |
      | Validation: Validated  |
