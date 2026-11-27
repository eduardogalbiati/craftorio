Feature: The project wizard's step 3 starts an import's analyses only when asked, and fits a new project
  On step 3 of an imported repository the owner defines the workflows before going on: "Analyze with AI" ("Analisar
  com IA") is the only control that starts the analyses, "Define manually" ("Definir manualmente") picks the workflows
  by hand and runs nothing, and Continue, locked until one of the two is chosen, never starts anything (#100, which
  reversed #20's "Define manually still runs the ticked analyses" and removed "Skip, analyze later", "Pular, analisar
  depois"). After Define manually the review says the analyses were skipped ("As análises foram puladas"); going back
  and analyzing after all takes that back (#20). A new project's step 3 does not speak of analyzing a repository that
  has nothing to read yet: no "only reads" line, no workflows "suggested from the git history" but from the answers
  given, and no analysis waits there without a reason (#21).
  The app's interface is in English in these scenarios; the Portuguese texts of the issues are given in brackets.

  # #100 reversed #20 here: until then Define manually kept the ticked analyses running and the review did not say
  # they were skipped. The facts (the languages) are read by the import itself, with no model.
  @issue-20 @issue-100
  Scenario: Defining the workflows manually on an import runs no analysis, and the review says the analyses were skipped
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "manual-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard does not let me continue before the workflows are defined
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard lets me continue to the review
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review says "The analyses were skipped: you can start them later."
    And the review's "City" card says its analysis is left for later, and where to start it
    And the review's "Findings" card says its analysis is left for later, and where to start it
    And the review's project card shows the language bar led by "JavaScript", its legend ordered by share

  # "Skip, analyze later" is gone (#100): Define manually, then Continue, is the way that starts no analysis
  @issue-20 @issue-100
  Scenario: Leaving the analysis of an import for later still says on the review that the analyses were skipped
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "skip-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard offers no "Skip, analyze later" button
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review says "The analyses were skipped: you can start them later."

  @issue-20
  Scenario: Going back after leaving the analysis for later and analyzing the repository after all takes the "skipped" notice away
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "back-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review says "The analyses were skipped: you can start them later."
    When I go back to the previous step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Analyze with AI" in the wizard's suggested workflows
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review does not say "The analyses were skipped: you can start them later."
    And the review's "City" card is running or done, not left for later

  # Step 3's title is "Workflows of <name>" for a new project and for an import; a new project's has no job list
  @issue-21
  Scenario: A new project's step 3 does not speak of analyzing a repository, follows the answers, and leaves nothing waiting without a reason
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's title reads "Workflows of Garden Log"
    And the wizard has no heading that reads "Analyze Garden Log"
    And the wizard does not say "The analysis only reads: nothing is written to the repository."
    And the wizard's suggested workflows do not say "git history"
    And the wizard's suggested workflows say "answers"
    And no analysis of the wizard is left waiting without saying why

  # The "only reads" line shows while the analysis runs: the simulated ways of working analysis is held running
  # (CRAFTORIO_E2E_ONBOARDING_HOLD, see onboarding.steps.js)
  @issue-21
  Scenario: An imported repository's step 3 says its analysis only reads the repository
    Given the app is open while the "ways of working" analysis keeps running
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "import-21"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's title reads "Workflows of import-21"
    When I choose "Analyze with AI" in the wizard's suggested workflows
    Then the wizard says "The analysis only reads: nothing is written to the repository."
