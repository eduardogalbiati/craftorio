Feature: The wizard's local repository card takes any folder on this computer
  "Use a local repository" (step 1's third card) no longer needs a folder that is already a git repository with a
  commit (#98). Right after a folder is picked, step 2 says what the engine read in it: a git repository is cloned
  as before; a plain folder gets a new git repository, made from a copy of its files in the workspace with a first
  commit, and the original folder is never changed; a folder that does not exist says so and Next stays off.

  # The native folder picker is answered by the scenario (dialog.showOpenDialog replaced in the main process, as
  # settings-workspace-folder.steps.js does). The folders live under the scenario's scratch folder.
  @issue-98
  Scenario: A plain folder with files and no git gets a new repository from a copy of its files, and goes on to the analysis
    Given the app is open
    And a local folder that is not a git repository is ready to import
    When I open the project wizard
    And I pick the local repository with the wizard's local repository card
    And I name the project "pasta-98" on the wizard's folder step
    Then the wizard's folder state is "plain"
    And the wizard's folder state says a new git repository will be created and the original folder is not changed
    And the wizard's Next does not say "clone"
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the picked folder is unchanged and still has no git repository

  @issue-98
  Scenario: A folder that is already a git repository with a commit is still cloned
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I pick the local repository with the wizard's local repository card
    Then the wizard's folder state is "repository"
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step

  @issue-98
  Scenario: A folder that does not exist says so and keeps Next off
    Given the app is open
    And a local folder that does not exist is ready to import
    When I open the project wizard
    And I pick the local repository with the wizard's local repository card
    And I name the project "sumiu-98" on the wizard's folder step
    Then the wizard's folder state is "missing"
    And the next step of the wizard is unavailable
