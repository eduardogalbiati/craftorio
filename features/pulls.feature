Feature: A PRs screen lists every open pull request of the project by what it needs from me
  The "PRs" entry of the menu ("MRs" on GitLab) opens a screen with every open pull request of the
  project, grouped by what it needs: "Need you" (ready to merge, changes requested, a conflict),
  "Waiting" (CI running, someone else's review) and "Others" (Dependabot, a pull request no run
  opened). The menu entry counts the ones that need me. Each pull request is the Run screen's PR card,
  with Merge, "Merge ignoring protection" and Close; one no run opened offers no "Ask for a fix".
  Stacked pull requests sit together in their merge order, and only the bottom one offers Merge.

  # What these scenarios stand on (#812), on top of #809's, #810's and #811's:
  # - The demo project is on GitHub (https://github.com/example/demo-app), so the entry reads "PRs".
  # - The platform's open pull requests are a JSON file in the launch's scratch folder, given to the app
  #   with MULTIAGENT_E2E_PR_FILE (the E2E PR file of features/support/electron-main.js), in the shape
  #   { pulls: [ ...one gh `pr view --json` answer per pull request, with number, title, url, author,
  #   headRefName, baseRefName ] }.
  # - For the developer: the E2E launch's fake platform (features/support/electron-main.js) is extended
  #   for a file with `pulls`: `gh pr list` answers the pulls whose state is OPEN, `gh pr view <n>`
  #   answers the pull `n`, and a merge or close of `n` is recorded in global.multiagentE2E.prActions as
  #   today and rewrites that pull's state (MERGED / CLOSED).
  # - A pull request a run opened: the steps write a finished run of Feature in Remote mode whose
  #   pr_open step gave that pull request's number and URL (the shape of #797's finished run,
  #   fronts/build/features/steps/roadmap-waiting-merge.steps.js); Dependabot's pull request has no run.

  @issue-812
  Scenario: The PRs screen groups the simulated pull requests by what they need and merges a ready one
    Given the app is open with these pull requests open on the platform:
      | number | title                              | author          | state             | run |
      | 101    | Add a /health endpoint             | e2e-owner       | ready to merge    | yes |
      | 102    | Rate limit the login               | e2e-owner       | changes requested | yes |
      | 103    | Paginate the orders list           | e2e-owner       | CI running        | yes |
      | 104    | Bump express from 4.18.2 to 4.19.2 | dependabot[bot] | ready to merge    | no  |
    Then the "PRs" menu entry counts 2 pull requests that need me
    When I open "PRs" in the sidebar
    Then the PRs screen lists the pull requests #101 and #102 under "Need you"
    And the PRs screen lists the pull request #103 under "Waiting"
    And the PRs screen lists the pull request #104 under "Others"
    And the pull request #101 offers Merge and Close
    And the pull request #104 offers no "Ask for a fix"
    When I merge the pull request #101 from the PRs screen
    Then the platform was asked to merge the pull request #101 with a merge commit
    And the pull request #101 no longer waits for me on the PRs screen
    And the "PRs" menu entry counts 1 pull request that needs me

  @issue-812
  Scenario: Stacked pull requests sit together in their merge order and only the bottom one offers Merge
    Given the app is open with these pull requests open on the platform:
      | number | title              | author    | state          | run | base           | head           |
      | 201    | Orders: data model | e2e-owner | ready to merge | yes | main           | stack/orders-1 |
      | 202    | Orders: API        | e2e-owner | ready to merge | yes | stack/orders-1 | stack/orders-2 |
      | 203    | Orders: screen     | e2e-owner | ready to merge | yes | stack/orders-2 | stack/orders-3 |
    When I open "PRs" in the sidebar
    Then the PRs screen shows the pull requests #201, #202 and #203 together as a stack, in that order
    And the pull request #201 offers Merge and Close
    And the pull request #202 offers no Merge
    And the pull request #203 offers no Merge

  @issue-812
  Scenario: A project with no open pull request shows an empty PRs screen and no count in the menu
    Given the app is open with no pull request open on the platform
    Then the "PRs" menu entry shows no count
    When I open "PRs" in the sidebar
    Then the PRs screen says the project has no open pull request
    And the PRs screen lists no pull request
