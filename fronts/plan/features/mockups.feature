Feature: Project mockups in Plan & Design
  Plan & Design > Mockups keeps a project's screen mockups in the workspace (never in the project's
  repository). A project without mockups shows an empty state that offers to build the visual kit,
  with its cost estimate, and to start a new mockup. A mockup made from a prompt by the designer
  (simulated here) shows as a card in the gallery. A mockup opens in its own editor window: its
  canvas shows the screen, and clicking an element of it selects that element for the designer's
  chat, shown as a chip in the chat's composer.

  @issue-625
  Scenario: A project without mockups shows the empty state with the kit's cost estimate
    Given the app is open
    When I open "Mockups" in the sidebar
    Then the Mockups screen says the project has no mockups yet
    And the Mockups screen estimates building the visual kit at "$1.50" to "$4.00"
    And the Mockups screen offers "Build the visual kit" and "New mockup"

  @issue-625
  Scenario: A mockup created from a prompt shows as a card in the gallery
    Given the app is open
    When I open "Mockups" in the sidebar
    And I create the mockup "Orders dashboard" from the prompt "A table of the latest orders with an Export button"
    Then the Mockups gallery shows the mockup "Orders dashboard"

  @issue-625
  Scenario: Clicking an element of the canvas puts it in the designer chat as a selection chip
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    Then the mockup editor window shows the canvas
    When I click "Export" on the mockup's canvas
    Then the designer chat shows a selection chip for "Export"
