Feature: Phone gates page
  The gates page the app serves to the owner's paired phone lists the gates waiting for an answer and
  lets the owner answer one, with a note, after confirming. A note is written for one choice, and an
  error met while pairing stays on screen until the owner pairs again.

  # #819. The phone is the served engine's browser window (features/support/served.js) opened on the
  # gates page's own address (127.0.0.1:<port>), the address and a one-time pairing code coming from the
  # engine's phonegates:pair channel, as Settings › Phone gates gets them. The gate comes from a
  # simulated feature run with Validation "Validated" (#777), so it waits for an answer.
  # Assumes each choice of the phone's gate page (the links that lead to the confirmation) gets
  # data-testid="phone-gate-choice".

  @issue-819
  Scenario: A note written under one choice is not pre-filled under another, and comes back under its own choice
    Given the engine is served on this machine
    And the served engine's first-run Setup is done
    And the served engine has a project "demo-app"
    When I open the served UI in the browser
    And I choose the workflow "feature" in the Start panel
    And I pick "Validated" for "Validation"
    And I start a simulated run with the task "Add a /health endpoint"
    Then a gate card waits for my approval
    When I pair my phone with the gates page
    And I open the waiting gate on my phone
    And I pick the gate's first choice on my phone
    And I write the note "Please cover the timeout with a test" on my phone
    And I go back to the gate on my phone
    And I pick the gate's second choice on my phone
    Then the note on my phone is empty
    When I go back to the gate on my phone
    And I pick the gate's first choice on my phone
    Then the note on my phone reads "Please cover the timeout with a test"
    When I reload the page on my phone
    Then the note on my phone reads "Please cover the timeout with a test"

  @issue-819
  Scenario Outline: A pairing error stays on the phone after <interruption>, while the phone stays unpaired
    Given the engine is served on this machine
    And the gates page for phones is served
    When I open the gates page on my phone without pairing it
    And I enter <attempts> wrong pairing codes on my phone
    Then my phone says "<error>"
    When I come back to the gates page on my phone after "<interruption>"
    Then my phone still says "<error>"
    And my phone does not say it is not paired
    And my phone keeps no pairing

    # 10 wrong codes from one address in 15 minutes: the 11th is refused as too many tries (SEC-20)
    Examples:
      | attempts | error                      | interruption             |
      | 1        | This pairing code is wrong | switching to another tab |
      | 11       | Too many pairing attempts  | losing the connection    |
