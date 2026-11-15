@issue-315
Feature: The account
  The app asks for a free account only to count the people using it: no trial, no plan, and nothing
  about the account stops a run.

  # The E2E app runs with sign-in off (MULTIAGENT_AUTH=off): the steps push the account state the
  # main process would send (auth:changed) to show the sign-in screen or a signed-in user.
  Scenario: The sign-in screen says the account only counts the people using the app
    Given the app is open
    When the app asks me to sign in
    Then the sign-in screen says the account only tells how many people use the app
    And the sign-in screen does not mention a trial, a plan or a credit card

  # The pushed state still carries an old server's active trial (5 days left): the UI ignores it
  Scenario: The account chip shows only my name and no screen mentions a trial or a plan
    Given the app is open
    When I am signed in as "Ada Lovelace" with the email "ada@example.com"
    Then the account chip shows "Ada Lovelace" and nothing else
    When I open the account chip
    Then the account panel shows "Ada Lovelace" and "ada@example.com" without a trial or a plan
    And no screen of the menu mentions a trial or a plan

  @quarantine
  Scenario: An account whose old trial has ended does not stop a run
    Given the app is open
    And I am signed in as "Ada Lovelace" with the email "ada@example.com" and an ended trial
    Then the Start a workflow button is enabled
    When I start a simulated run with the task "Add a /health endpoint"
    Then the run is running
    And a gate card waits for my approval
