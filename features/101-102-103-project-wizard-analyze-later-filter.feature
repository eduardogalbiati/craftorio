Feature: The project wizard says plainly when an analysis did not start, and finds a repository from its pasted URL
  On step 3 of an import, when the engine refuses "Analyze with AI" ("Analisar com IA"), the step goes back to its two
  choices with Continue still locked and says why, instead of staying on an analysis that never runs (#101). Defining
  the workflows manually and going on while the clone still runs leaves the analyses for later: the review's City and
  Findings cards say they are not analysed yet, with no "running" badge (#102). Pasting a repository's GitHub URL in
  the list's filter box ("Filter by name") lists that repository, and leaves the URL field as it was (#103).
  The app's interface is in English in these scenarios.

  # The engine's refusal is simulated (an E2E hook to add, CRAFTORIO_E2E_ONBOARDING_ANALYZE_REFUSE, see
  # project-wizard-101-102-103.steps.js): onboarding:analyze throws, nothing starts
  @issue-101
  Scenario: When the engine refuses "Analyze with AI", step 3 shows its two choices again, Continue stays locked, and the app says why
    Given the app is open where the engine refuses to start the analysis
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "refused-101"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Analyze with AI" in the wizard's suggested workflows
    Then the app says why the analysis could not start
    And the wizard's step 3 shows its two choices again, not an analysis running
    And the wizard does not let me continue before the workflows are defined

  # The simulated clone is held running (CRAFTORIO_E2E_ONBOARDING_HOLD=clone, see onboarding.steps.js)
  @issue-102
  Scenario: Defining the workflows manually and continuing while the clone still runs leaves the City and Findings for later, nothing running
    Given the app is open while the clone of an import keeps running
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "later-102"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's "City" card says its analysis is left for later, and where to start it
    And the review's "Findings" card says its analysis is left for later, and where to start it
    And the review shows no analysis running

  # The account's repositories are simulated (CRAFTORIO_E2E_GITHUB_REPOS, see onboarding.steps.js)
  # @serial: the paste goes through the machine's clipboard, shared with every other scenario running at once
  @issue-103 @serial
  Scenario Outline: Pasting a repository's GitHub URL in the repositories filter lists it, and the URL field stays empty
    Given the app is open where my GitHub account has the repositories:
      | repository             | updated    |
      | e2e-owner/shop-api     | 2026-11-19 |
      | e2e-owner/field-notes  | 2026-11-18 |
      | acme-labs/billing      | 2026-11-16 |
      | e2e-owner/legacy-shop  | 2026-11-13 |
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I paste "<url>" in the wizard's repository filter
    Then the wizard's repository list shows, in order:
      | e2e-owner/legacy-shop |
    And the wizard's repository URL field is still empty

    Examples:
      | url                                          |
      | https://github.com/e2e-owner/legacy-shop     |
      | https://github.com/e2e-owner/legacy-shop.git |
      | https://github.com/e2e-owner/legacy-shop/    |
