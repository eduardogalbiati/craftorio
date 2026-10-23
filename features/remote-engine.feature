Feature: Remote engine connection
  The engine connection page (Settings › Execution › Engine › Change…) points this window at an
  engine on another computer. Plain http carries the token and every page in clear text, so it is
  accepted only for this computer (loopback) and Tailscale addresses (100.64.0.0/10, *.ts.net);
  another http address is refused unless "Allow an insecure connection" is checked, and then the
  page warns about it every time it shows that address.

  # #480 (SEC-15). Assumes the connection page gets, under the address field:
  # - data-testid="engine-connection-allow-insecure": the checkbox "Allow an insecure connection",
  #   shown for an http address that is neither loopback nor Tailscale, never checked by default;
  # - data-testid="engine-connection-insecure-warning": the warning that the connection is not
  #   encrypted (the token and the pages can be read on the network), shown while that box is checked.
  # Save and restart refuses such an address without the box before contacting it: its result
  # (engine-connection-result, data-kind="error") names the insecure http, nothing is saved, no restart.
  # No scenario reaches an engine: no server runs.
  @issue-480
  Scenario: A plain http address on the local network is refused and nothing connects
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open the engine connection page
    And I choose the remote engine "http://192.168.1.10:7300" on the connection page
    And I save the engine connection
    Then the connection page refuses the address as insecure
    And the connection page offers to allow an insecure connection
    And the connection page says this computer runs the engine

  @issue-480
  Scenario: Allowing an insecure connection shows a warning
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open the engine connection page
    And I choose the remote engine "http://192.168.1.10:7300" on the connection page
    And I allow an insecure connection on the connection page
    Then the connection page warns that the connection is insecure

  @issue-480
  Scenario: A loopback http address needs no insecure opt-in
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I open the engine connection page
    And I choose the remote engine "http://127.0.0.1:7300" on the connection page
    Then the connection page does not offer to allow an insecure connection
    And the connection page shows no insecure connection warning
