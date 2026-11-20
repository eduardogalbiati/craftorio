Feature: The project wizard's step 3 and review say what really happens
  A new project with the Local way of working leaves the city analysis for later and says why, and its
  review shows the answer given, not "the analyses were skipped" (#850). Step 3 starts on the Light work
  model, marked Recommended, and shows where the files live only for a model that writes files; "Analyze
  the repository" is the recommended choice (#851). While the project map still runs, the review's City
  and Findings cards both say so, the city can still be opened, and the languages have a placeholder
  until the facts are read (#852).

  # A new project has no history to analyze: nothing is skipped by the owner, so no "Skip, analyze later"
  @issue-850
  Scenario: A new Local project leaves the city analysis for later with a reason, and the review shows the Local answer
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I answer "Local: merge here, push main" to "Where changes land" in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's "project map" analysis is left for later, saying why
    And the wizard offers no "Skip, analyze later" button
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's project card says "Local: merge here, push main"
    And the review does not say "The analyses were skipped: you can start them later."
    And the review does not say "Read by the Ways of working profile when it is done."

  @issue-851
  Scenario: Step 3 starts on the recommended Light work model, and where the files live shows once Standard is picked
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "light-851"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard has the "Light" work model picked
    And the "Light" work model is labelled "Recommended"
    And the wizard does not show where the files live
    When I pick the "Standard" work model in the wizard
    Then the wizard has the "Standard" work model picked
    And the wizard's work model files live "In the repository" in "docs/work/<item>/" as "intent.md", "spec.md" and "plan.md"

  @issue-851
  Scenario: Analyze the repository is the recommended choice of the suggested workflows
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "analyze-851"
    And I go to the next step of the wizard
    Then the wizard's suggested workflows offer "Analyze the repository" and "Define manually" and no workflow yet
    And the wizard's "Analyze the repository" choice is labelled "Recommended"

  # The simulated project map and facts jobs are held running (MULTIAGENT_E2E_ONBOARDING_HOLD=facts,projectMap,
  # see onboarding.steps.js), so the review is reached while they still run
  @issue-852
  Scenario: While the project map runs, the review's City and Findings cards both say so and the city can still be opened
    Given the app is open while the "project map" and "facts" analyses keep running
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "running-852"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I start the analysis in the wizard
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's "City" card shows it is still running
    And the review's "Findings" card shows it is still running
    And the review's City card still offers "Open the city"
    And the review's project card shows a placeholder for the languages
