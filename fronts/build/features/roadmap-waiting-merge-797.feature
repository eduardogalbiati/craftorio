Feature: A roadmap item waits for the merge of its PR
  A run that ended well with its PR still open is not a failure: a person merges it on the platform.
  Its roadmap item reads "Waiting for PR merge" with a link to the PR, the roadmap goes on running and
  says what it waits for, and the next stage does not start. Once the PR is merged the item is done
  and the stage ends, with no error and no skip by hand. Closed without merging, the item fails and
  says so, with Retry and Skip.

  # What these scenarios stand on (#797):
  # - The whole scenario is simulated. A simulated run counts as merged and stays so, so the run that
  #   waits is seeded with `mock: false` in workflow.started (and its summary.json): a past run on
  #   disk, nothing real starts, and the roadmap itself is set running as a simulation.
  # - The seed is written once the app is open, as every Roadmap scenario does: the dispatch at
  #   workspace open (packages/engine/service/areas/workspace.js) has found the demo roadmap paused and
  #   started nothing, and if it comes after the seed it finds the seeded roadmap: same outcome. The
  #   demo's stages are replaced, so no demo run decides what the bar or the alerts show.
  # - gh is faked at the host seam host.readPrJson, by features/support/electron-main.js, from a JSON
  #   file the steps rewrite. Each sync below reaches the real backlog:sync channel, with only the
  #   read of the issues from the platform replaced: the E2E suite otherwise answers Sync with
  #   backlog:get (scripts/screenshot/channels.js), which reads no PR and dispatches nothing.
  # - The merge is seen through Sync, the read that is always fresh. Reopening the Roadmap would not
  #   do: that read may come from the 5 minute cache.
  # - The first Sync with the PR still open dispatches the roadmap, so "has not started" means the
  #   stage really held the next one back, not that nothing asked it to go on.
  # - The next stage's item runs Feature in Validated mode: once the stage ends it starts and stops at
  #   a gate, so its simulated run cannot end in a failure that would pause the roadmap.
  # - A finished stage leaves the Planned view, so the done item is read in All.

  @issue-797
  Scenario: A run with an open PR waits for its merge, holds the next stage, and ends done once a person merges it
    Given the app is open with the pull request #321 open on the platform
    And the roadmap is running the item "Item behind a PR", whose run finished with the pull request #321, before the stage of "Item of the next stage"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Item behind a PR" waits for the merge of the pull request #321
    And the roadmap item "Item behind a PR" shows the status "Aguardando merge do PR"
    And the roadmap item "Item behind a PR" gives no reason for a failed read
    And the roadmap says it waits for the merge of the pull request #321
    And the roadmap is running with no error
    When I sync the backlog
    Then the roadmap item "Item behind a PR" waits for the merge of the pull request #321
    And the roadmap item "Item of the next stage" has not started
    And the roadmap is running with no error
    When the pull request #321 is merged on the platform
    And I sync the backlog
    And I show all the items of the roadmap
    Then the roadmap item "Item behind a PR" is done
    And the roadmap item "Item behind a PR" shows the status "Concluído"
    And the roadmap no longer waits for a merge
    And the roadmap is running with no error
    And the roadmap item "Item of the next stage" has started

  @issue-797
  Scenario: A PR closed without merging fails the item, says so, and offers Retry and Skip
    Given the app is open with the pull request #322 open on the platform
    And the roadmap is running the item "Item behind a PR", whose run finished with the pull request #322, before the stage of "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    Then the roadmap item "Item behind a PR" waits for the merge of the pull request #322
    And the roadmap item "Item behind a PR" shows the status "Waiting for PR merge"
    When the pull request #322 is closed without merging on the platform
    And I sync the backlog
    Then the roadmap item "Item behind a PR" shows the status "Failed"
    And the roadmap item "Item behind a PR" shows the error "closed without merging"
    And the roadmap item "Item behind a PR" offers Retry and Skip, enabled
    And the roadmap no longer waits for a merge
    And the roadmap item "Item of the next stage" has not started

  @issue-797
  Scenario: A PR that cannot be read keeps the item waiting and says why
    Given the app is open with the pull request #323 open on the platform
    And the roadmap is running the item "Item behind a PR", whose run finished with the pull request #323, before the stage of "Item of the next stage"
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And reading the pull request #323 fails with "could not reach the platform"
    And I sync the backlog
    Then the roadmap item "Item behind a PR" waits for the merge of the pull request #323
    And the roadmap item "Item behind a PR" shows the status "Waiting for PR merge"
    And the roadmap item "Item behind a PR" says the pull request could not be read: "could not reach the platform"
    And the roadmap says it waits for the merge of the pull request #323
    And the roadmap is running with no error
    And the roadmap item "Item of the next stage" has not started
