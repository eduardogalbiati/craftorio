Feature: The Usage screen
  The Usage screen shows tokens and cost per provider, budgets, model prices and the month's GitHub
  Actions minutes. When gh cannot read GitHub's billing usage (it lacks the "user" scope), the GitHub
  Actions card says so and suggests `gh auth refresh -s user` with a ▶. In a browser tab against the
  engine server, the ▶ asks for confirmation, then opens a terminal tab in the dock running that
  exact command on the engine, as the desktop app does; declining opens nothing.

  # #783. The served engine and its browser UI: features/support/served.js (simulation, a fresh HOME:
  # gh is never signed in there). "gh lacks the user scope" is faked at the HTTP surface the browser
  # sees, as engine-version.feature fakes /api/version: a page route answers POST /api/usage:actions
  # with what packages/engine/domains/usage/actions-usage.js getActionsUsage returns without the scope
  # ({ error: 'GitHub billing usage needs the gh "user" scope', hint: 'gh auth refresh -s user' }).
  # The terminal is the engine's: the browser's POST /api/term:open { kind: 'command', command } is
  # answered (in simulation the engine simulates the command's terminal instead of refusing it).
  # Locators: the ▶ is button "Run in a terminal: <command>" (packages/ui-kit/command-hint.js), the
  # confirmation the app's confirm dialog (data-testid="confirm-modal"), the dock region "Terminals".

  @issue-783
  Scenario: In a browser tab, the ▶ of gh's billing scope runs it in a terminal of the dock after confirmation
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And gh on the served engine lacks the "user" scope for GitHub's billing usage
    When I open the served UI in the browser
    And I open "Usage" in the sidebar
    Then the GitHub Actions card says 'Actions minutes unavailable: GitHub billing usage needs the gh "user" scope' and suggests "gh auth refresh -s user"
    When I click the ▶ of "gh auth refresh -s user"
    Then the confirm dialog asks "Run this command?"
    When I click "▶ Run" in the confirm dialog
    Then a terminal tab opens in the dock running "gh auth refresh -s user"
    And no toast says "Run this on the computer where the app runs"

  @issue-783
  Scenario: In a browser tab, declining the confirmation of the ▶ opens no terminal
    Given the engine is served on this machine
    And the served engine has a project "demo-app"
    And the served engine's first-run Setup is done
    And gh on the served engine lacks the "user" scope for GitHub's billing usage
    When I open the served UI in the browser
    And I open "Usage" in the sidebar
    And I click the ▶ of "gh auth refresh -s user"
    Then the confirm dialog asks "Run this command?"
    When I click "Cancel" in the confirm dialog
    Then no terminal tab opens in the dock
    And no toast says "Run this on the computer where the app runs"
