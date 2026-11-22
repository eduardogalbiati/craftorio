Feature: The project wizard's step 3 runs the ticked analyses of an import, and fits a new project
  Importing a repository and choosing "Define manually" ("Definir manualmente") on step 3 only picks the workflows
  by hand: the analyses still ticked, such as "City and architecture" ("Cidade e arquitetura"), keep running, so the
  review does not say they were skipped ("As análises foram puladas"). Only "Skip, analyze later" ("Pular, analisar
  depois") skips them, and analyzing after all takes that back (#20). A new project's step 3 does not speak of
  analyzing a repository that has nothing to read yet: no "Analyze <name>" heading, no "Read-only" line, no workflows
  "from how <name> is worked on today" but from the answers given, and no analysis waits there without a reason (#21).
  The app's interface is in English in these scenarios; the Portuguese texts of the issues are given in brackets.

  @issue-20
  Scenario: Defining the workflows manually on an import still runs the ticked analyses, and the review does not say they were skipped
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "manual-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's "project map" analysis is ticked
    When I choose "Define manually" in the wizard's suggested workflows
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review does not say "The analyses were skipped: you can start them later."
    And the review's "City" card is running or done, not left for later
    And the review's "Findings" card is running or done, not left for later
    And the review's project card shows the language bar led by "JavaScript", its legend ordered by share

  @issue-20
  Scenario: Skipping the analysis of an import still says on the review that the analyses were skipped
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "skip-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I skip the analysis for later
    Then the wizard is on its "review" step
    And the review says "The analyses were skipped: you can start them later."

  @issue-20
  Scenario: Going back after skipping and analyzing the repository after all takes the "skipped" notice away
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "back-20"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I skip the analysis for later
    Then the wizard is on its "review" step
    And the review says "The analyses were skipped: you can start them later."
    When I go back to the previous step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Analyze the repository" in the wizard's suggested workflows
    And I go to the next step of the wizard
    Then the wizard is on its "review" step
    And the review does not say "The analyses were skipped: you can start them later."
    And the review's "City" card is running or done, not left for later

  @issue-21
  Scenario: A new project's step 3 does not speak of analyzing a repository, follows the answers, and leaves nothing waiting without a reason
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard has no heading that reads "Analyze Garden Log"
    And the wizard does not say "Read-only. Nothing is written to the repository."
    And the wizard's suggested workflows do not say "is worked on today"
    And the wizard's suggested workflows say "answers"
    And no analysis of the wizard is left waiting without saying why

  @issue-21
  Scenario: An imported repository's step 3 still says it analyzes the repository, read-only
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "import-21"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard's title reads "Analyze import-21"
    And the wizard says "Read-only. Nothing is written to the repository."
