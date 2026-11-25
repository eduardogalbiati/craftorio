Feature: The welcome and a new project read in Portuguese, and the app calls itself Craftorio
  With the interface in Português (Brasil), the first-run Setup, the Oracle's panel, the new-project
  wizard's review and the project's Next steps card show no English left over (#23). The header's usage
  counter names the product, Craftorio, instead of "Orchestrator" / "Orquestrador", in both languages (#24).

  # #23: the line sized from this machine's threads and memory; in English it reads "This machine: 20 threads,
  # 32 GB → up to 5 runs at once, 2 test workers per run". #69: the Setup's Try it safely step, which showed
  # it, is gone: Settings › Execution › Concurrent runs is where it reads, in Portuguese as the step did.
  @issue-23 @issue-69
  Scenario: In Português (Brasil), Settings › Execution says what this machine can run in Portuguese
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the "Execução" settings tab
    Then the line about this machine reads in "Português (Brasil)"

  # #23: a new workspace's Oracle has no history yet, so its panel offers its suggested questions (in
  # English "What happened overnight?", "Where do my tokens go?"…) and its header its Night watch button.
  @issue-23
  Scenario: On a new workspace in Português (Brasil), the Oracle's panel shows its suggestions and its Night watch in Portuguese
    Given the app is open on a new workspace
    When I choose "Português (Brasil)" as the Setup's language
    And I skip the Setup and confirm
    And I open the Oracle
    Then the Oracle offers its suggested questions
    And the Oracle's panel shows none of these English texts:
      | Night watch                           |
      | What happened overnight?              |
      | Which runs failed this week, and why? |
      | Where do my tokens go?                |
      | What should I work on next?           |

  # #23: the review's City card counts the files and the "bairros" (not "zonas"), the language legend groups
  # the small languages under "Outras", and the idea goes to the "Caixa de entrada", in the review's help
  # line and on the Next steps card once the wizard is finished.
  @issue-23
  Scenario: In Português (Brasil), the wizard's review and the project's Next steps card show no English
    Given the app is open
    And a local git repository with some code is ready to import
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "revisao-23"
    And I go to the next step of the wizard
    And I start the analysis in the wizard
    Then the progress tray shows the project "revisao-23" as analyzed
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's project card shows the language bar led by "JavaScript", its legend ordered by share
    And the review's "City" card says "bairro"
    And the review says "Caixa de entrada"
    And the wizard's "review" shows none of these English texts:
      | Other |
      | zones |
      | zonas |
      | Inbox |
    When I type the idea "Exportar a cidade como imagem" in the review
    And I finish the wizard
    Then the project wizard closes right away
    And the project page of "revisao-23" is open
    And the project page shows the Next steps card
    And the Next steps card says "Caixa de entrada"
    And the Next steps card shows none of these English texts:
      | Inbox |

  # #24: hovering the counter shows its tooltip, "<name> usage in <month>: <tokens> tokens, <cost> — <status>"
  @issue-24
  Scenario: In Português (Brasil), the header's usage counter says "Uso Craftorio", not "Orquestrador"
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I hover over the usage counter in the header
    Then the usage counter's tooltip says "Uso Craftorio"
    And the usage counter's tooltip does not say "Orquestrador"
    And the usage counter's tooltip does not say "orquestrador"

  @issue-24
  Scenario: In English, the header's usage counter says "Craftorio usage", not "Orchestrator"
    Given the app is open
    When I hover over the usage counter in the header
    Then the usage counter's tooltip says "Craftorio usage"
    And the usage counter's tooltip does not say "Orchestrator"
