Feature: Live updates from the engine
  A window onto an engine (the browser UI, the desktop app on a remote engine) gets the runs' live
  updates over a pushed channel (a WebSocket). When that channel is down or silent the window does
  not keep a stale state: a gate it answered shows answered as soon as the answer is accepted, a
  gate answered elsewhere says so, and a dropped channel shows a small "reconnecting" indicator
  until the window has reconnected on its own.

  # #603. The served engine (packages/engine/bin/multiagent-engine.js on a scratch workspace, its UI in
  # an Electron window with no preload: features/support/served.js) is the only public surface where
  # the pushed channel can be held back or cut: the desktop app's own engine pushes over IPC. The
  # browser's WebSocket (/ws) goes through a Playwright relay (page.routeWebSocket): it forwards both
  # ways, can hold back what the engine pushes while the socket stays open (a silent channel), or can
  # close the socket and refuse new ones (a dropped channel). "Another client" is a POST to the
  # engine's HTTP API with the server token (approval:resolve), as a second window or a phone would.
  # Assumes:
  # - the gate card (data-testid="run-gate", data-approval, data-run) stays in view once answered and
  #   says "Answered …" with no enabled choice; a gate answered elsewhere says "already answered at
  #   <HH:MM>" on the card, with no error toast or alert;
  # - the sidebar's waiting-gates badge (today #nav-run-gates) gets data-testid="nav-run-gates";
  # - the shell's connection indicator is data-testid="connection-status", reading
  #   "Disconnected, reconnecting…" while the pushed channel is down, hidden otherwise (no dialog).
  # #777: the run is a feature run (features/support/workflows.js) with Validation "Validated", so it
  # stops at a gate card.

  @issue-603
  Scenario: A gate I answer shows answered at once, even when no live update arrives
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the browser's live updates from the engine go through a relay I control
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When the browser stops receiving live updates from the engine
    And I answer the gate card with its first choice
    Then the gate card shows the gate answered
    And the sidebar's waiting-gates badge counts one gate less
    And the run's entry in the sidebar is no longer waiting at a gate

  @issue-603
  Scenario: Answering a gate already answered elsewhere says when it was answered, not an error
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the browser's live updates from the engine go through a relay I control
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When the browser stops receiving live updates from the engine
    And another client answers the gate with its first choice
    And I answer the gate card with its first choice
    Then the gate card says it was already answered at a time
    And no error is shown

  @issue-603
  Scenario: A dropped live connection shows a reconnecting indicator that clears once the window reconnects
    Given the engine is served on this machine
    And the browser's live updates from the engine go through a relay I control
    When I open the served UI in the browser
    And the browser's live connection to the engine drops
    Then the shell shows that it is reconnecting, without a dialog
    When the browser's live connection to the engine comes back
    Then the reconnecting indicator clears within 30 seconds
