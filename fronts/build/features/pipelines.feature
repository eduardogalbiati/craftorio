Feature: Bundled pipelines and their workflows
  The app ships pipelines that chain its bundled workflows; they show in the Workflows screen's
  Pipelines tab. Release then refactors (#378) runs a release, then the Analyze project workflow
  since the release's previous tag (#631: it took over Refactor proposals; the architecture analysis
  finds refactors and files them as `refactor` issues), then the Product Owner. The analysis is a real
  model call: the pipeline's description says so, with a cost estimate.
  The Code & Build set (#631): Analyze project replaces Project map and Refactor proposals, Test batch
  is now Test backfill and Run retrospective is now Retrospective; the Develop then retrospective
  pipeline is gone.

  @issue-378
  Scenario: The Pipelines tab lists the bundled release-then-refactors pipeline, which warns of its real model call and its cost
    Given the app is open
    When I open "Pipelines" in the sidebar
    Then the Workflows screen is on its "Pipelines" tab
    And the Pipelines tab lists the pipeline "release-then-refactors.yaml"
    And the pipeline "release-then-refactors.yaml" runs "release.yaml", then "analyze-project.yaml", then the Product Owner
    And the description of the pipeline "release-then-refactors.yaml" says "real model call" and gives a cost estimate

  @issue-378
  Scenario: The Start panel offers the Analyze project workflow with its project, since and limit inputs
    Given the app is open
    When I choose the workflow "analyze-project" in the Start panel
    Then the Start panel requires a project
    And the Start panel has the input "since"
    And the Start panel's input "limit" defaults to "5"

  @issue-631
  Scenario: The Workflows screen lists the reorganised Code & Build workflows and none of their old names
    Given the app is open
    When I open "Definitions" in the sidebar
    Then the workflow "analyze-project" is listed on the Workflows screen
    And the workflow "test-backfill" is listed on the Workflows screen
    And the workflow "retrospective" is listed on the Workflows screen
    And the workflow "project-map" is not listed on the Workflows screen
    And the workflow "refactor-proposals" is not listed on the Workflows screen
    And the workflow "test-batch" is not listed on the Workflows screen
    And the workflow "run-retrospective" is not listed on the Workflows screen

  @issue-631
  Scenario: The Pipelines tab chains a release into Analyze project and no longer offers Develop then retrospective
    Given the app is open
    When I open "Pipelines" in the sidebar
    Then the Workflows screen is on its "Pipelines" tab
    And the pipeline "release-then-refactors.yaml" runs "release.yaml", then "analyze-project.yaml", then the Product Owner
    And the Pipelines tab does not list the pipeline "develop-to-retrospective.yaml"
