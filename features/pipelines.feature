Feature: Bundled pipelines and their workflows
  The app ships pipelines that chain its bundled workflows; they show in the Workflows screen's
  Pipelines tab. Release then refactor proposals (#378) runs a release, then the Refactor proposals
  workflow (the architecture analysis finds refactors and files them as `refactor` issues), then the
  Product Owner. The analysis is a real model call: the pipeline's description says so, with a cost
  estimate.

  @issue-378
  Scenario: The Pipelines tab lists the bundled release-then-refactors pipeline, which warns of its real model call and its cost
    Given the app is open
    When I open "Pipelines" in the sidebar
    Then the Workflows screen is on its "Pipelines" tab
    And the Pipelines tab lists the pipeline "release-then-refactors.yaml"
    And the pipeline "release-then-refactors.yaml" runs "release.yaml", then "refactor-proposals.yaml", then the Product Owner
    And the description of the pipeline "release-then-refactors.yaml" says "real model call" and gives a cost estimate

  @issue-378
  Scenario: The Start panel offers the Refactor proposals workflow with its project, since and limit inputs
    Given the app is open
    When I choose the workflow "refactor-proposals" in the Start panel
    Then the Start panel requires a project
    And the Start panel has the input "since"
    And the Start panel's input "limit" defaults to "5"
