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

  @issue-835
  Scenario: The Kit tab lists the kit's tokens and components with a live preview
    Given the app is open
    And the project has a visual kit with the token "--color-primary" and the component "Button/primary"
    When I open "Mockups" in the sidebar
    And I open the Kit tab of the Mockups screen
    Then the Kit tab lists the token "--color-primary"
    And the Kit tab lists the component "Button/primary" with a preview

  @issue-835
  Scenario: The editor shows the screen in the Phone frame and keeps a new variant as the current one
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    And I switch the mockup editor's frame to "Phone"
    Then the mockup's canvas is 390 pixels wide
    When I create the variant "bold" of the mockup
    Then the mockup editor shows "bold" as the current variant

  @issue-835
  Scenario: Comparing the two latest versions shows them side by side with the changed nodes highlighted
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    And the mockup "Orders dashboard" has a newer version where the button reads "Download"
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    And I compare the two latest versions of the mockup
    Then the comparison shows the version with "Export" beside the version with "Download"
    And the comparison highlights the changed nodes

  @issue-836
  Scenario: Reviewing the screen shows its cost estimate first and the findings only after confirming
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    And I choose "Review this screen" in the mockup editor
    Then the mockup editor shows a cost estimate to confirm before it runs
    When I confirm the mockup editor's cost estimate
    Then the designer chat shows the review's findings on kit conformance, accessibility and layout

  @issue-836
  Scenario: Starting a development run from the editor opens the Start panel with the mockup's frozen version and starts no run
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    And I choose "Start a development run" in the mockup editor
    Then the Start panel's input "mockup" holds the current version of the mockup "Orders dashboard"
    And the run status shows "idle"

  @issue-836
  Scenario: Preparing issues from a version opens the commit dialog with the selected region cropped and files nothing before confirming
    Given the app is open
    And the project has the mockup "Orders dashboard" with a button "Export"
    And the mockup "Orders dashboard" is attached to the Discovery card "Export the orders", in Ready and 90% clear
    When I open "Mockups" in the sidebar
    And I open the mockup "Orders dashboard" in its editor window
    And I click "Export" on the mockup's canvas
    And I choose "Prepare issues" on the mockup's current version
    Then the commit dialog lists the proposed issues with 1 cropped region
    And no issue has been filed to the project's backlog
