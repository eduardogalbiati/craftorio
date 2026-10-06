Feature: Settings
  Settings save as soon as a choice is made, and the choice survives a reload.

  @issue-222 @issue-195 @smoke
  Scenario: Settings saves the default development workflow
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "software-development.yaml" as the default development workflow
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the default development workflow is "software-development.yaml"

  # Assumes Settings gets a "Phone gates" tab holding the phone gates section (#226)
  @issue-226
  Scenario: Settings shows a pairing code and a QR code for the phone gates page, with the setup steps
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Phone gates" settings tab
    And I ask for a code to pair a phone
    Then the phone gates section shows a pairing code
    And the phone gates section shows a QR code to pair a phone
    And the phone gates section lists the steps to reach the gates page from the phone
    And the steps give the gates page's address

  @issue-226
  Scenario: The paired devices list says when no phone is paired yet
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Phone gates" settings tab
    Then the phone gates section lists the paired devices
    And the paired devices list says no phone is paired yet

  # Assumes Settings › Execution gets a "Memory guard" group under "Concurrent runs" (#276)
  @issue-276
  Scenario: The memory guard is on by default, with its limit in GB for this machine
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard is on
    And the memory guard's limit is 25
    And the memory guard's floor is 10
    And the memory guard's hint gives its limit in GB for this machine

  @issue-276
  Scenario: A new memory guard limit is kept after the app reloads
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I set the memory guard's limit to 30
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard's limit is 30

  @issue-276
  Scenario: A memory guard limit out of range shows an error and is not saved
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I set the memory guard's limit to 95
    Then the memory guard's limit field shows an error
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard's limit is 25
