Feature: Pasting into a session's terminal in a browser tab
  In a browser tab against the engine server, Ctrl+V in a terminal of the dock pastes the clipboard
  through the browser's own paste (its clipboardData): no clipboard-read permission prompt and no
  error. A read-only tab still refuses the paste with its message. When a clipboard read is refused
  (the terminal's right-click Paste), the terminal bar says "Use Ctrl+V to paste" in the interface
  language, never the browser's raw "Failed to execute 'readText' on 'Clipboard': ..." message.

  # #746. The served engine and its browser UI: features/support/served.js. A writable terminal in
  # simulation is the gate card's "Terminal there" (a shell in the run's folder: the simulated run
  # works in the project's folder); a read-only one is a session's "Live terminal" on the Run screen.
  # Playwright cannot make the browser paste for real: "I press Ctrl+V" sends the key (Chromium runs
  # no paste command for it) and then dispatches the paste event the browser fires for Ctrl+V, a
  # ClipboardEvent('paste') whose clipboardData (DataTransfer) holds the text, on the terminal's input.
  # "The browser refuses to let the page read the clipboard" replaces navigator.clipboard.readText in
  # the page (before it loads) by one that counts its calls and rejects with the browser's
  # NotAllowedError, as a browser that denies the clipboard-read permission does.
  # #777: the run is a feature run (features/support/workflows.js) with Validation "Validated", so it
  # stops at a gate card.
  # Assumes the developer adds:
  # - data-testid="term-pane" on each terminal's pane in the dock (term-dock.js openTerminal);
  # - data-testid="term-dock-message" on the terminal bar's message (#term-msg), with the class
  #   "error" while it shows an error, as today.

  @issue-746
  Scenario: Ctrl+V pastes into the terminal from the browser's paste, with no clipboard read and no error
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And the browser refuses to let the page read the clipboard
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open the gate card's "Terminal there"
    And I press Ctrl+V in the terminal with "echo paste746-$((40+2))" in the clipboard
    Then the browser was free to paste for the Ctrl+V
    And the terminal shows "echo paste746-$((40+2))"
    When I press Enter in the terminal
    Then the terminal shows "paste746-42"
    And the page never asked to read the clipboard
    And the terminal bar shows no error

  @issue-746
  Scenario: A read-only terminal tab refuses a Ctrl+V paste with its message
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open the run's "Details" tab
    And I open the Live terminal of the run's first agent session
    And I press Ctrl+V in the terminal with "paste746-readonly" in the clipboard
    Then the terminal bar says "This terminal is read-only."
    And the terminal does not show "paste746-readonly"

  @issue-746
  Scenario: A refused clipboard read says "Use Ctrl+V to paste", not the browser's error
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And the browser refuses to let the page read the clipboard
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I open the gate card's "Terminal there"
    And I right-click the terminal to paste
    Then the terminal bar says "Use Ctrl+V to paste"
    And the terminal bar does not show the browser's clipboard error
