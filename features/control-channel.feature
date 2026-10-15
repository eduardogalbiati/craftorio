Feature: Control channel
  An outside session (a terminal, another agent) can drive this app through a local control
  channel, only when the user turns it on; human gates stay closed to it either way.

  # Assumes Settings › Execution gets the switch "Allow outside sessions to control this app"
  # (checkbox, data-testid="setting-control-channel", data-setting="controlChannel"), its one-line
  # description, and data-testid="control-channel-status" (address and endpoint file) (#336)
  @issue-336
  Scenario: The control channel is off by default and says human gates stay closed
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the "Allow outside sessions to control this app" switch is turned off
    And the "Allow outside sessions to control this app" switch's description mentions "human gates"
    And the workspace has no control endpoint file

  @issue-336
  Scenario: Turning the control channel on shows its port and writes the endpoint file
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the "Allow outside sessions to control this app" switch
    Then the workspace's control endpoint file gives a 127.0.0.1 address and a token
    And the control channel status shows the endpoint file's port and path

  @issue-336
  Scenario: Turning the control channel off again removes the endpoint file
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the "Allow outside sessions to control this app" switch
    Then the workspace's control endpoint file gives a 127.0.0.1 address and a token
    When I turn off the "Allow outside sessions to control this app" switch
    Then the "Allow outside sessions to control this app" switch is turned off
    And the workspace has no control endpoint file
    And the control channel status shows no port

  # Assumes the switch's row shows, while the channel is on, the path of the multiagent-ctl binary
  # (data-testid="control-ctl-path": resources/bin in the packaged app, native/target/... in a dev
  # checkout) and a "Copy" button for it (data-testid="control-ctl-copy") that puts that path on the
  # clipboard; both are gone while the channel is off (#342)
  @issue-342
  Scenario: With the control channel on, Settings shows the multiagent-ctl path to copy
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the "Allow outside sessions to control this app" switch
    Then the control channel shows the path of "multiagent-ctl"
    When I copy the control channel's "multiagent-ctl" path
    Then the clipboard holds the "multiagent-ctl" path shown

  @issue-342
  Scenario: With the control channel off, Settings offers no multiagent-ctl path
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I turn on the "Allow outside sessions to control this app" switch
    Then the control channel shows the path of "multiagent-ctl"
    When I turn off the "Allow outside sessions to control this app" switch
    Then the control channel offers no "multiagent-ctl" path to copy
