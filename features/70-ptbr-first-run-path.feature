Feature: The path from a first idea to a run reads in Portuguese
  With the interface in Português (Brasil), what the owner meets between a first idea and a real run (the
  Descoberta card's rubric and interview, the commit dialog, the roadmap's start) shows no English left
  over (#70). In English they stay as they are.

  # #70: a card of the Descoberta board gets its clarity from the rubric ("Clarity rubric"), its gaps and
  # Grill me's questions from the rubric's points, and its history from its moves ("Moved to Modelagem").
  # The card is created once the interface is in Portuguese: its gaps are written by the app, not by the owner.
  @issue-70
  Scenario: In Português (Brasil), a Descoberta card's gaps, its interview and its history read in Portuguese
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And the idea "Exportar pedidos em CSV" was captured on the Discovery board and moved to "Shape"
    And I open "Descoberta" in the sidebar
    And I open the Discovery card "Exportar pedidos em CSV"
    And I start the interview from the card's panel
    Then the card's panel lists missing points, asks a question and shows a version of its history
    And the card's panel shows none of these English texts:
      | Clarity rubric                                   |
      | Problem: what is wrong or missing today          |
      | what is wrong or missing today, and for whom     |
      | Problem: What is wrong or missing today          |
      | What is wrong or missing today, and who feels it |
      | what is true when this is done                   |
      | nothing verifiable says when it is done          |
      | Moved to Modelagem                               |
      | Moved to Shape                                   |

  # #70: the commit dialog mixes Portuguese with what happens to the card ("They are filed on the project's
  # repository…", here its simulated wording) and with how the split was made.
  @issue-70
  Scenario: In Português (Brasil), committing a Descoberta card to the backlog shows no English
    Given the app is open
    And the Discovery card "Exportar pedidos em CSV" waits in "Define", 90% clear with about 3 h of work
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Descoberta" in the sidebar
    And I move the Discovery card "Exportar pedidos em CSV" to "Pronto"
    And I open the Discovery card "Exportar pedidos em CSV"
    And I open the commit dialog from the card's panel
    Then the commit dialog lists the proposed issues
    And the commit dialog mentions "quadro"
    And the commit dialog shows none of these English texts:
      | Simulation: they only join                  |
      | nothing reaches GitHub or GitLab            |
      | They are filed on the project's repository  |
      | The card then leaves the board              |
      | for the Committed list and never comes back |
      | the split by the rules                      |
      | no model was called                         |

  # #70: the demo roadmap is paused; Resume with Simulated off asks first (the app under test refuses real
  # runs, and the scenario cancels the question).
  @issue-70
  Scenario: In Português (Brasil), resuming the roadmap with real runs warns about spending in Portuguese
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    And I press Resume on the roadmap with Simulated off, in the interface language
    Then the confirm dialog warns that real runs spend money, in Portuguese
    And the confirm dialog offers "Retomar" and "Cancelar"
    And the confirm dialog shows none of these English texts:
      | Resume the roadmap               |
      | Runs in progress keep going      |
      | the next planned items           |
      | they use your CLI subscriptions  |
      | cost money                       |
      | Human gates still wait for you   |
      | Resume                           |
