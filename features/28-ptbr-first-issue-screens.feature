Feature: The screens of the first issue read in Portuguese
  With the interface in Português (Brasil), the screens a new user goes through to capture, shape, file
  and plan a first issue (the Caixa de entrada, the Descoberta board, the Backlog, the Product Owner's
  drawer and the Start panel) show no English left over (#28).

  # #28: an idea captured in the Caixa de entrada is a card of kind "idea" aged "now"; accepted, it goes to
  # the Descoberta board's first column. The board's columns are written "Triage", "Shape", "Define",
  # "Ready" (drawn in capitals), its filters "All tags" / "All authors", the Shape column's automation
  # "Automação: Ask me". The fresh simulated workspace starts with an empty Inbox and Discovery board.
  @issue-28
  Scenario: In Português (Brasil), the Caixa de entrada and the Descoberta board show no English
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Caixa de entrada" in the sidebar
    And I capture the idea "Exportar pedidos em CSV" with the text "Os clientes querem baixar os pedidos"
    Then the open screen's title is "Caixa de entrada"
    And the open screen shows none of these English texts:
      | Inbox    |
      | idea     |
      | now      |
      | just now |
    When I open the Inbox card "Exportar pedidos em CSV"
    And I accept the opened card
    And I open "Descoberta" in the sidebar
    Then the open screen's title is "Descoberta"
    And the open screen shows none of these English texts:
      | Discovery         |
      | All tags          |
      | All authors       |
      | Triage            |
      | Shape             |
      | Define            |
      | Ready             |
      | Automação: Ask me |
      | now               |
      | idea              |

  # #28: the Backlog's platform select offers Bitbucket as coming soon; the select shows only for a
  # repository on a host the app cannot tell (#745: GitHub and GitLab get a badge, a local project
  # nothing, #39), so the scenario picks such a project. The Product Owner's "Registrar uma issue"
  # suggestion switches its drawer to registering an issue, whose empty state, footer (a simulated
  # workspace) and text box (with the shared paste hint) were in English.
  @issue-28
  Scenario: In Português (Brasil), the Backlog and the Product Owner's drawer for registering an issue show no English
    Given the app is open
    And the workspace has a project "intranet-app" whose repository is on a host the app cannot tell
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I choose the project "intranet-app" in the header
    And I open "Backlog" in the sidebar
    Then the Backlog screen is shown
    And the open screen offers the option "Bitbucket (em breve)"
    And the open screen shows none of these English texts:
      | Bitbucket (soon) |
    When I open the Product Owner
    And I click the suggested question "Registrar uma issue"
    Then the Product Owner's text box hints "Colar uma imagem (Ctrl+V)"
    And the Product Owner's drawer shows none of these English texts:
      | Describe the issue in a few words                       |
      | Simulated: no model is called                           |
      | nothing is spent                                        |
      | Filing only previews                                    |
      | Paste an image (Ctrl+V)                                 |
      | Nothing is filed until you click Create or Add to       |

  # #28: the Start panel on the Issue workflow (workflows/issue.yaml): its description, its stations
  # (Analyze › Write › Review › File), its inputs' help, its Mode pills (Automatic / Validated) and the
  # chain picker's "Quando terminar" options (Nothing / Start a workflow with it / Ask the Product Owner
  # to place it in the roadmap / Plan the issues (Roadmap)) were in English.
  @issue-28
  Scenario: In Português (Brasil), the Start panel on the Issue workflow shows no English
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Projetos" in the sidebar
    And I click "Iniciar workflow" on the demo project's card
    And I choose the workflow "issue" in the Start panel
    Then the Start panel shows the "Quando terminar" list
    And the Start panel shows none of these English texts:
      | Turns a request in a few words into a triaged |
      | Analyze                                       |
      | Write                                         |
      | Review                                        |
      | File                                          |
      | The problem or the idea, in a few words       |
      | Automatic                                     |
      | Validated                                     |
      | Nothing                                       |
      | Start a workflow with it                      |
      | Ask the Product Owner to place it in the roadmap |
      | Plan the issues (Roadmap)                     |
