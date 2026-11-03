Feature: Findings against a remote engine
  The Findings overlay freezes the view and keeps its picture in the finding also when the app runs
  against an engine on another computer: in a browser tab on the engine server and in the desktop app
  in remote mode (window title "... engine on 127.0.0.1:<port>"), whose window has no preload and uses
  the HTTP api (apps/web/renderer/api-http.js). There api.captureWindow returns a picture of the page
  instead of refusing as "only available in the desktop app". When the capture really fails, the
  overlay says so in the interface language and the finding can still be saved on a blank picture.
  The overlay's labels (the marking tools, the empty marks list) follow the interface language.

  # #751. The served engine and its browser UI: features/support/served.js. The desktop app in remote
  # mode: the same engine server, and the app launched with a user data folder whose
  # engine-connection.json points at it (mode "remote", its 127.0.0.1 address, the served token in
  # plain form): simulation only accepts a loopback remote engine. The served workspace is new: its
  # first-run Setup is marked done and its "Findings button" setting turned on through the engine's
  # HTTP API (POST /api/settings:set), so the button shows whatever the build reports as packaged.
  # "The browser cannot capture the page" replaces, before the page loads, window.api's
  # captureWindow by one that rejects (an init script wrapping the api the page assigns to window.api).
  # "Shows the captured page" reads the frozen picture's pixels: a loaded image of more than one
  # colour, never the blank picture (a single dark #111827 fill). The saved finding's screenshot.png is
  # read from the engine's findings folder (findings:list gives its dir) and checked the same way.
  # Assumes the developer adds:
  # - data-testid="findings-frozen-image" on the overlay's frozen picture (the <img class="fd-img">),
  #   shown only when a capture was taken;
  # - data-testid="findings-capture-error" on the overlay's message that the capture failed (in the
  #   interface language, e.g. "Não foi possível capturar a tela; as marcas vão numa imagem em
  #   branco"), present only when the capture failed;
  # - data-testid="findings-frame-label" on the frame's label ("Frozen view · WxH" /
  #   "Visão congelada · WxH").
  # The tool buttons keep data-testid="findings-tool-<pin|circle|box|arrow|freehand>"; the marks list
  # keeps data-testid="findings-marks" with its empty text in data-empty.

  @issue-751
  Scenario: In a browser tab on the engine server, Findings freezes the captured page and saves it
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And the served engine shows the Findings button
    When I open the served UI in the browser
    And I open the findings view
    Then the frozen view shows the captured page
    And the findings view shows no capture error
    When I choose the "Pin" marking tool
    And I place 1 pin on the frozen view
    And I write the finding note "Captured from a browser tab"
    And I save the finding
    Then the findings view says "Saved"
    And the saved finding "Captured from a browser tab" carries the captured page

  @issue-751
  Scenario: The desktop app in remote mode freezes the captured window and saves it with the finding
    Given the desktop app is open in remote mode on an engine served on this machine
    And the window title says it runs on the remote engine
    When I open the findings view
    Then the frozen view shows the captured page
    And the findings view shows no capture error
    When I choose the "Pin" marking tool
    And I place 2 pins on the frozen view
    Then the frozen view shows the pins numbered "1, 2"
    When I write the finding note "Captured from the remote desktop window"
    And I save the finding
    Then the findings view says "Saved"
    And the saved finding "Captured from the remote desktop window" carries the captured page

  @issue-751
  Scenario: A failed capture is told in Portuguese, the labels are Portuguese and the finding is still saved
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And the served engine shows the Findings button
    And the served engine's interface language is "Português (Brasil)"
    And the browser cannot capture the page
    When I open the served UI in the browser
    And I open the findings view
    Then the findings view says the capture failed with "Não foi possível capturar a tela"
    And the frozen view's label reads "Visão congelada"
    And the findings view shows none of the English labels "Pin, Circle, Box, Arrow, Freehand, No marks yet."
    When I choose the "Pin" marking tool
    And I place 1 pin on the frozen view
    And I write the finding note "Captura falhou"
    And I save the finding
    Then the findings view says "Salvo"
    And the findings view shows no English capture error
