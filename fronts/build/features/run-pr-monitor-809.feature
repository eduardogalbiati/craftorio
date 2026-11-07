Feature: A run that opened a PR waits in a PR monitor and ends on the merge
  The last step of a run that opens a pull request is a PR monitor, with no agent and no Approve: it
  shows the PR's CI, review, conflicts, unanswered comments and what still blocks the merge, with a link
  to the PR. The run ends well once the PR is merged, and fails, saying so, when it is closed without
  merging. A read of the PR that fails keeps the last state shown and says when it was read.

  # What these scenarios stand on (#809):
  # - A simulated run of Feature in "Remote (pull request)" mode, Validation left Automatic, so nothing
  #   stops it at a gate before the PR monitor. The simulated run's PR is the simulation's own,
  #   https://github.com/acme/app/pull/42 (pr_number 42), hence #42 below.
  # - The platform is faked as in fronts/build/features/roadmap-waiting-merge-797.feature: the app is
  #   launched with an E2E PR file (features/support/electron-main.js), and every read of a PR goes to
  #   the service's host.readPrJson, which answers from that file (gh's `pr view --json` answer, or
  #   { fail: message }). The steps rewrite the file to say what the platform says.
  # - Assumption for the developer: when host.readPrJson stands in for gh/glab (as run-meta.js already
  #   does for a simulated run's PR), the simulated run's PR monitor reads the PR through it instead of
  #   a simulated sequence, so the merge and the close below are seen by the monitor. Without it, the
  #   simulated monitor keeps its own simulated answers.
  # - The app has no "merge this PR" action yet: the merge and the close happen on the (fake) platform.

  @issue-809
  Scenario: The run waits in the PR monitor with no Approve, then ends successfully once the PR is merged
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform is ready to merge
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    And the PR monitor shows "passed" for "CI"
    And the PR monitor shows "approved" for "Review"
    And the PR monitor shows "none" for "Conflicts"
    And the PR monitor shows "0" for "Comments"
    And the PR monitor shows "Ready to merge" for "Result"
    And the run offers no Approve
    When the pull request #42 is merged on the platform
    Then the run ends successfully
    And the run offers no Approve

  @issue-809
  Scenario: The PR monitor says what blocks the merge, and a PR closed without merging fails the run, saying so
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform has the job "unit-tests" failed, changes requested by "maria", a conflict with the base and 2 unanswered comments
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    And the PR monitor shows "unit-tests" for "CI"
    And the PR monitor shows "maria" for "Review"
    And the PR monitor shows "base" for "Conflicts"
    And the PR monitor shows "2" for "Comments"
    And the PR monitor's result is not "Ready to merge"
    And the run offers no Approve
    When the pull request #42 is closed without merging on the platform
    Then the run ends as failed, saying "closed without merging"

  @issue-809
  Scenario: A read of the PR that fails keeps the last state and says when it was read
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform is ready to merge
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    And the PR monitor shows "Ready to merge" for "Result"
    When reading the pull request #42 fails with "could not reach the platform"
    Then the PR monitor says the pull request could not be read: "could not reach the platform"
    And the PR monitor says when it last read the pull request
    And the PR monitor shows "passed" for "CI"
    And the PR monitor shows "Ready to merge" for "Result"
    And the run is running
