Feature: Engine version check
  The browser UI asks the engine it connects to for its version (GET /api/version: app version and
  interface contract) on connect and on every reconnect. Another interface than the one the UI was
  built for: a banner tells to reload to get the engine's interface. Same interface, or the
  desktop app: nothing shows.

  # Assumes the banner is data-testid="version-skew-banner", reading "This engine runs another
  # version (engine X, interface Y): reload to get its interface", with a "Reload" button (#339).
  # The served engine is packages/engine/bin/craftorio-engine.js on a scratch workspace; its UI opens in an Electron window
  # with no preload (features/support/served.js). "Another version" is a page route on /api/version.
  @issue-339
  Scenario: The desktop app shows no engine version banner
    Given the app is open
    Then no engine version banner shows

  @issue-339
  Scenario: The browser UI served by its own engine shows no engine version banner
    Given the engine is served on this machine
    When I open the served UI in the browser
    Then no engine version banner shows

  @issue-339
  Scenario: An engine with another interface shows a banner with a Reload button
    Given the engine is served on this machine
    And the served engine reports version "9.9.9" with interface "99"
    When I open the served UI in the browser
    Then a banner says the engine runs another version, engine "9.9.9" and interface "99"
    And the version banner offers a Reload button
    When the served engine reports its own version again
    And I press the version banner's Reload button
    Then no engine version banner shows
