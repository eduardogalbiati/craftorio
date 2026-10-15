Feature: AI Arena
  An AI Arena run (workflow ai-arena) opens in its own chat screen; its right column stacks the
  Documents, Peer scores and Supervisor sections.

  # #311: in a short window, with a reference document whose name is long, the side column's sections
  # drew over each other. Each section keeps its own space and heading; the column scrolls instead.
  @issue-311
  Scenario Outline: A cancelled Arena run's side column keeps its sections apart at the minimum window size in the <theme> theme
    Given the app is open at its minimum window size in the <theme> theme
    And the demo project has a cancelled AI Arena run "arn00311" whose reference document has a long name
    When I open "Runs" in the sidebar
    And I search the runs for "arn00311"
    And I open the chat of the run "arn00311" from the list
    Then the Arena side column shows the sections "Documents", "Peer scores" and "Supervisor", top to bottom, without overlapping
    And each Arena side section shows its heading
    And the Arena side column scrolls to its last section when it is taller than the window
    And the long reference document's tab stays inside the Documents section

    Examples:
      | theme |
      | light |
      | dark  |

  @issue-311
  Scenario: A cancelled Arena run's peer scores keep a visible bar beside each model at the minimum window size
    Given the app is open at its minimum window size in the light theme
    And the demo project has a cancelled AI Arena run "arb00311" whose reference document has a long name
    When I open "Runs" in the sidebar
    And I search the runs for "arb00311"
    And I open the chat of the run "arb00311" from the list
    Then the Arena peer scores list "Opus 5.5", "Sonnet 5.5" and "GPT-6 Luna"
    And each Arena peer score row shows the model's name, a bar wider than zero and its value, side by side
    And the Arena document tabs do not overlap the "Peer scores" heading
