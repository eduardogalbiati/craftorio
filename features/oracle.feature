Feature: The Oracle
  The Oracle's panel, docked on the Dashboard and a drawer on the other screens, fits the window:
  the app never shifts sideways and the panel's header stays readable, from a 900 px wide window up.

  @issue-208
  Scenario: Opening the Oracle in a narrow window does not shift the app sideways
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    Then the page has not scrolled sideways
    And the sidebar is visible

  @issue-208
  Scenario: The Oracle's header stays readable in a narrow window
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    Then the Oracle's title is readable, not covered by its header buttons

  @issue-208
  Scenario: Opening the Night watch form in a narrow window does not shift the app sideways
    Given the app is open in a 1069x900 window
    When I open "Dashboard" in the sidebar
    And I open the Oracle
    And I open the Oracle's "Night watch" form
    Then the page has not scrolled sideways
    And the sidebar is visible
