Feature: The project wizard's step 3 and review say what really happens
  A new project with the Local way of working leaves the city analysis for later and says why (on the review's
  City card: its step 3 lists the workflows, no analysis), and its review shows the answer given, not "the
  analyses were skipped" (#850). Step 3's workflows come with the Light work model, picked and marked
  Recommended; Standard and Full are shown as "Coming soon" and cannot be picked yet (owner's decision,
  2026-11-26), so where the files live is not shown; "Analyze with AI" is the recommended choice (#851). While
  the project map still runs, the review's City
  and Findings cards both say so, the city can still be opened, and the languages have a placeholder
  until the facts are read (#852). A new project has no files to detect its kind from: its review asks the kind
  (Frontend, Full-stack or Backend) with no "Detect from the files", an import keeps that option, and the kind
  picked for a new project is the one its project page goes by (#57).

  # A new project has no history to analyze: nothing is skipped by the owner, so no "Skip, analyze later"
  @issue-850
  Scenario: A new Local project leaves the city analysis for later with a reason, and the review shows the Local answer
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I answer "Local merge, then push main" to "How changes reach main" in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's step 3 lists the workflows and no analysis
    And the wizard offers no "Skip, analyze later" button
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's "City" card says its analysis is left for later, and where to start it
    And the review's project card says "Local merge, then push main"
    And the review does not say "The analyses were skipped: you can start them later."
    And the review does not say "Read by the Ways of working profile when it is done."

  # The work model shows with the workflows' rows (here defined manually). Standard and Full are "Coming soon"
  # (owner's decision, 2026-11-26): they cannot be picked, so "where the files live" never shows.
  @issue-851
  Scenario: Step 3's workflows come with the recommended Light work model picked, Standard and Full coming soon, and no files block
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "light-851"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard has the "Light" work model picked
    And the "Light" work model is labelled "Recommended"
    And the wizard does not show where the files live
    And the "Standard" work model cannot be picked yet, marked "Coming soon"
    And the "Full" work model cannot be picked yet, marked "Coming soon"
    And the wizard has the "Light" work model picked
    And the wizard does not show where the files live

  @issue-851
  Scenario: Analyze with AI is the recommended choice of the suggested workflows
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "analyze-851"
    And I go to the next step of the wizard
    Then the wizard's suggested workflows offer "Analyze with AI" and "Define manually" and no workflow yet
    And the wizard's "Analyze with AI" choice is labelled "Recommended"

  # The simulated project map and facts jobs are held running (CRAFTORIO_E2E_ONBOARDING_HOLD=facts,projectMap,
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
    And the review's City card still offers "Finish and open the city"
    And the review's project card shows a placeholder for the languages

  # A new project has no files yet: the review's Project kind (wizard-kind-select) asks, it does not detect
  @issue-57
  Scenario: Creating a new project asks its kind instead of offering to detect it from the files
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "kind-57"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review's Project type offers "Frontend", "Full-stack" and "Backend (no UI)"
    And the review's Project type does not offer "Detect from the files"

  # Skipped analysis: no kind is known yet, so the import still offers to detect it from the repository's files
  @issue-57
  Scenario: Importing a repository keeps "Detect from the files" as its kind
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "import-57"
    And I go to the next step of the wizard
    And I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review's Project type has "Detect from the files" picked

  # A new project with no code has no screenshots step (#75) unless the kind picked says it has an interface (#22)
  @issue-57
  Scenario: The kind picked for a new project is saved, and its project page goes by it
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "front-57"
    And I go to the next step of the wizard
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I pick "Frontend" as the review's Project type
    And I finish the wizard
    Then the project page of "front-57" is open
    And the project page shows the Next steps card
    And the Next steps card still lists the screenshots step
