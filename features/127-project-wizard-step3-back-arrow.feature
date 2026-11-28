Feature: Step 3 of the project wizard has a back arrow to the two ways of defining the workflows
  On step 3 (Analysis and workflows), once the owner has picked "Define manually" or the analysis has read the
  workflows, the two choice cards are gone. A back arrow at the top left of step 3, before its heading, takes the
  owner back to them ("Analyze with AI" and "Define manually") and starts no analysis; it is not shown while the two
  choices are on screen. The picks made by hand are kept if the owner picks "Define manually" again (#127).
  The app's interface is in English in these scenarios.

  # Back on the two choices nothing has run: Define manually then Continue still leaves every analysis for later
  @issue-127
  Scenario: The back arrow after Define manually shows the two ways again and starts no analysis
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "back-127"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    Then the wizard shows the back arrow "Back to how the workflows are defined" before the heading "Workflows of back-127"
    When I go back to how the workflows are defined with the wizard's back arrow
    Then the wizard's step 3 shows its two choices again, not an analysis running
    And the wizard's step 3 shows no back arrow
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review shows no analysis running
    And the review's "City" card says its analysis is left for later, and where to start it

  # The release row's default is "Milestone · tag + notes": the hand-made pick differs from it
  @issue-127
  Scenario: Going back from Define manually and defining manually again keeps the pick made by hand
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "keep-127"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I choose "Define manually" in the wizard's suggested workflows
    And I pick "Per merge · tag + notes" for the suggested "release" workflow
    And I go back to how the workflows are defined with the wizard's back arrow
    Then the wizard's step 3 shows its two choices again, not an analysis running
    When I choose "Define manually" in the wizard's suggested workflows
    Then the suggested "release" workflow still has "Per merge · tag + notes" picked

  @issue-127
  Scenario: The two choices show no back arrow, the workflows read by the analysis do
    Given the app is open
    And a local git repository with some code is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "analyzed-127"
    And I go to the next step of the wizard
    Then the wizard's suggested workflows offer "Analyze with AI" and "Define manually" and no workflow yet
    And the wizard's step 3 shows no back arrow
    When I choose "Analyze with AI" in the wizard's suggested workflows
    Then the wizard's suggested workflows are the ones read by the analysis
    And the wizard shows the back arrow "Back to how the workflows are defined" before the heading "Workflows of analyzed-127"
