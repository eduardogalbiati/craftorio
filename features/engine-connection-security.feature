Feature: Engine connection security
  The engine connection page (Settings › Execution › Engine › Change…) keeps the remote engine's
  token in this computer's app data, encrypted by the operating system. When the computer offers no
  encryption (e.g. Linux without a keyring) the token is stored as plain text, and the page says so.

  # "This computer cannot encrypt" stands for Electron's safeStorage being unavailable: the step
  # makes safeStorage.isEncryptionAvailable() answer false in the app's main process (no hook in the
  # app), so the page must read it when it asks for its state (engine-connection:state), not once at
  # start. The warning is data-testid="engine-token-unencrypted-warning", shown with the token field.
  @issue-479
  Scenario: Without encryption on this computer, the engine connection page warns that the token is stored unencrypted
    Given the app is open
    And this computer cannot encrypt the engine token
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open the engine connection page
    And I choose a remote engine on the engine connection page
    Then the engine connection page warns that the token is stored unencrypted
    And the engine connection page does not say the token is kept encrypted

  @issue-479 @quarantine
  Scenario: With encryption on this computer, the engine connection page shows no unencrypted-token warning
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open the engine connection page
    And I choose a remote engine on the engine connection page
    Then the engine connection page does not warn that the token is stored unencrypted
    And the engine connection page says the token is kept encrypted
