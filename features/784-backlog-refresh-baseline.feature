Feature: A just-onboarded project's Backlog does not ask for a Backlog Refresh
  A project with no Backlog Refresh run counts from when it was added (#784): right after the onboarding
  its issues cannot cite files moved or tasks done since, so the Backlog shows no refresh banner. Once the
  interval passed since the project was added and merges landed on its base, the banner comes back and says
  so, instead of "never refreshed". The import is simulated (CRAFTORIO_SIMULATION_ONLY=1, a local git
  repository in the scenario's scratch folder); the Backlog Refresh interval is the default, 24 hours.

  @issue-784
  Scenario: Right after the onboarding, the project's Backlog shows no refresh banner
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "fresh-784"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "fresh-784" is open
    When I open "Backlog" in the sidebar
    And I choose the project "fresh-784" in the header
    Then the Backlog shows no Backlog Refresh banner

  # The project is written as the onboarding leaves it, added 3 days ago; its base got 2 commits since.
  @issue-784
  Scenario: A project added days ago whose base got merges since shows the banner, counted since it was added
    Given the app is open
    And the workspace has a project "older-784" added 3 days ago whose base branch got 2 merges since
    And the backlog of "older-784" has the open issue "Keep the city in sync"
    When I open "Backlog" in the sidebar
    And I choose the project "older-784" in the header
    Then the Backlog Refresh banner counts "2 merges since" the project was added, without saying "never refreshed"
    And the Backlog Refresh banner offers "Refresh now" and "Dismiss for today"
