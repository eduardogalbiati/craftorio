Feature: Merging or closing a run's pull request from its PR monitor card
  The PR monitor's card offers Merge only when the pull request can be merged, and Merge makes a merge
  commit; otherwise it names what blocks the merge and offers no Merge. "Merge ignoring protection" is
  a separate button, only for a person allowed to bypass the protection. Close asks first, and the run
  then ends as failed, saying the pull request was closed from the app. A merge the platform refuses
  shows the platform's message, and nothing reads as merged.

  # What these scenarios stand on (#810), on top of #809's (fronts/build/features/run-pr-monitor-809.feature):
  # - A simulated run of Feature in "Remote (pull request)" mode reaches its PR monitor on the
  #   simulation's PR #42; the app is launched with the E2E PR file (features/support/electron-main.js)
  #   and the steps rewrite it to say what the platform says.
  # - For the developer: the merge and the close go through the service's host as the reads do
  #   (host.readPrJson), and the E2E launch fakes them in features/support/electron-main.js: each call is
  #   recorded in global.craftorioE2E.prActions ({ action: 'merge' | 'close', number, method, admin });
  #   a merge rewrites the PR file to state MERGED unless the file has `merge_fail` (then it throws that
  #   message); a close rewrites it to state CLOSED. The fake reports no bypass permission unless the
  #   file says `viewerCanBypass: true`.

  @issue-810
  Scenario: A simulated ready pull request merges from the card and the run ends
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform is ready to merge
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    And the PR monitor shows "Ready to merge" for "Result"
    And the PR monitor offers Merge
    And the PR monitor offers no Merge ignoring protection
    When I merge the pull request from the PR monitor
    Then the platform was asked to merge the pull request #42 with a merge commit
    And the PR monitor says the pull request was merged
    And the run ends successfully
    And the run offers no Approve

  @issue-810
  Scenario: A merge the platform refuses shows its message and nothing reads as merged
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform is ready to merge
    And merging the pull request #42 on the platform fails with "Base branch was modified. Review and try the merge again."
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    When I merge the pull request from the PR monitor
    Then the PR monitor says the merge failed: "Base branch was modified"
    And nothing says the pull request was merged
    And the run is running

  @issue-810
  Scenario: A blocked pull request names what blocks it with no Merge, and closing it after confirming fails the run
    Given the app is open with the pull request #42 open on the platform
    And the pull request #42 on the platform has the job "unit-tests" failed, changes requested by "maria", a conflict with the base and 2 unanswered comments
    When I open the Start panel
    And I choose the workflow "Feature" in the Start panel
    And I pick "Remote (pull request)" for "Mode"
    And I start a simulated run with the task "Add a /health endpoint"
    Then the run waits in the PR monitor of the pull request #42
    And the PR monitor says the merge is blocked by "CI failed"
    And the PR monitor says the merge is blocked by "changes requested"
    And the PR monitor says the merge is blocked by "conflict"
    And the PR monitor offers no Merge
    And the PR monitor offers no Merge ignoring protection
    When I close the pull request from the PR monitor
    Then the app asks me to confirm closing the pull request
    When I confirm closing the pull request
    Then the platform was asked to close the pull request #42
    And the run ends as failed, saying "closed from the app"
