Feature: The Roadmap card, the Assign dialog and the Descoberta board read in Portuguese
  With the interface in Português (Brasil), the screens left in English after #28 (a Roadmap card, the
  Backlog's Assign dialog and the Descoberta board's description) show no English left over (#36).
  In English they stay as they are.

  # #36: a planned Feature item (feature.yaml, Local mode, Automatic validation by default) on the Roadmap.
  # Its card shows two meters labelled "Cost" and "Time" (drawn in capitals, "COST" / "TIME"), the note
  # "no estimate yet" when there is no estimate, its mode chips "Automatic" / "Validated" and its stations
  # Tests › Develop › Review › Validate › Merge, all written in English today.
  @issue-36
  Scenario: In Português (Brasil), a Roadmap card shows its meters, its mode and its stations in Portuguese
    Given the app is open
    And the roadmap plans the item "Exportar pedidos em CSV" on the workflow "Feature" in "local" mode
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap card "Exportar pedidos em CSV" shows these texts:
      | Custo       |
      | Tempo       |
      | Automático  |
      | Validado    |
      | Desenvolver |
    And the roadmap card "Exportar pedidos em CSV" shows none of these English texts:
      | Cost            |
      | Time            |
      | COST            |
      | TIME            |
      | no estimate yet |
      | Automatic       |
      | Validated       |
      | Develop         |
      | Review          |
      | Validate        |

  # #36: the Assign dialog opens on the project's default workflow (Feature); its inputs' labels ("Language",
  # "Base branch", "Mode", "Validation", "Unit tests", "E2E tests") and options ("Write and run", "Off",
  # "Automatic", "Validated") come from workflows/feature.yaml and were shown in English.
  @issue-36
  Scenario: In Português (Brasil), the Assign dialog shows its workflow's settings in Portuguese
    Given the app is open
    And the backlog has the open issues "Exportar pedidos em CSV" and "Tema escuro"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Assign dialog for the backlog issue "Exportar pedidos em CSV"
    Then the Assign dialog has the "Feature" workflow chosen
    And the Assign dialog shows these texts:
      | Branch base      |
      | Modo             |
      | Testes unitários |
      | Testes E2E       |
      | Escrever e rodar |
    And the Assign dialog shows none of these English texts:
      | Language      |
      | Base branch   |
      | Mode          |
      | Validation    |
      | Unit tests    |
      | E2E tests     |
      | Write and run |
      | Off           |
      | Automatic     |
      | Validated     |

  # #36: the Descoberta board's description under its title names the columns' path "Triage → Shape →
  # Define → Ready" in English, though #28 translated the columns themselves.
  @issue-36
  Scenario: In Português (Brasil), the Descoberta board's description names its columns in Portuguese
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Descoberta" in the sidebar
    Then the open screen's title is "Descoberta"
    And the open screen shows none of these English texts:
      | Triage → Shape → Define → Ready |
