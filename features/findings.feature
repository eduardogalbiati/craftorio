Feature: Findings
  While developing, the owner freezes the app's view, marks what is wrong on it with numbered pins
  and a note, and saves it as a finding or files it as an issue for the Product Owner, without
  leaving the app. The E2E app runs from source, so the Findings button shows without turning on
  Settings › General › "Findings button".

  # Assumes the frozen picture is a [data-testid="findings-canvas"] inside the overlay (the pins land
  # where it is clicked) and the Settings › General findings list holds one list item per finding,
  # naming its note and its status ("Saved", "Filed")
  @issue-361
  Scenario: A finding marked with three numbered pins and a note is saved and listed in Settings
    Given the app is open
    When I open the findings view
    Then the findings toolbar offers the tools "Pin, Circle, Box, Arrow, Freehand"
    When I choose the "Pin" marking tool
    And I place 3 pins on the frozen view
    Then the frozen view shows the pins numbered "1, 2, 3"
    When I write the finding note "The run card's status pill overlaps its title"
    And I save the finding
    Then the findings view says "Saved"
    And the findings view offers "Open folder"
    When I close the findings view
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the findings list shows the finding "The run card's status pill overlaps its title" as "Saved"

  @issue-361
  Scenario: Escape cancels a finding and nothing is saved
    Given the app is open
    When I open the findings view
    And I choose the "Pin" marking tool
    And I place 1 pin on the frozen view
    And I press Escape
    Then the findings view is closed
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the findings list has no finding

  # "File as issue" sends the finding to the Product Owner (simulated in the E2E app): its request
  # shows in the Product Owner's drawer with the finding's note
  @issue-361
  Scenario: A finding filed as an issue reaches the Product Owner's inbox
    Given the app is open
    When I open the findings view
    And I choose the "Pin" marking tool
    And I place 1 pin on the frozen view
    And I write the finding note "The Backlog's empty state has no call to action"
    And I file the finding as an issue
    Then the findings view says "Filed"
    When I close the findings view
    And I open "Backlog" in the sidebar
    And I open the Product Owner
    Then the request in the Product Owner's drawer shows "The Backlog's empty state has no call to action"
    When I press Escape
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the findings list shows the finding "The Backlog's empty state has no call to action" as "Filed"
