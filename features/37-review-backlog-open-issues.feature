Feature: The wizard's review lists only the open issues of the backlog
  The onboarding wizard's step 4 ("Revisão") Backlog card lists and counts only the open issues that are not
  archived ("3 open issues"); a closed issue never appears, and with no open issue the card says "No open issues."
  even when closed ones exist (#37). A local import has no platform to read issues from: the scenario writes the
  backlog a GitHub sync leaves (open and closed issues) once the onboarding created the project.

  @issue-37
  Scenario: The review's Backlog card counts and lists only the open, non-archived issues
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "backlog-37"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    Given the backlog of "backlog-37" has the issues:
      | title                    | state  | labels   |
      | Export orders as CSV     | open   |          |
      | Fix the login redirect   | closed | bug      |
      | Add a dark theme         | open   |          |
      | Old payment provider     | open   | archived |
      | Translate the emails     | closed |          |
      | Show the order history   | open   |          |
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review's Backlog card says "3 open issues" and lists only the issues:
      | Export orders as CSV   |
      | Add a dark theme       |
      | Show the order history |

  @issue-37
  Scenario: With only closed issues the review's Backlog card says there are no open issues
    Given the app is open
    And a local git repository is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "closed-37"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    Given the backlog of "closed-37" has the issues:
      | title                  | state  | labels |
      | Fix the login redirect | closed | bug    |
      | Translate the emails   | closed |        |
    When I define the workflows manually and continue, leaving the analysis for later
    Then the wizard is on its "review" step
    And the review's Backlog card ends with "No open issues."
    And the review's Backlog card lists no issue
