Feature: The Planning workflows are write-doc and issue
  Write & Review and AI Arena are now the write-doc workflow of the Documents screen: "Several
  writers" (Arena mode) has up to five models draft the document. Their screens leave the menu. The
  Planning pipelines follow the new names: RFC → Issues is spec-to-issues, Enrich → Save → Develop is
  enrich-issue, and AI Arena → Write & Review is absorbed by Arena mode. The old names still run.

  @issue-648
  Scenario: Plan & Design offers Documents, without the Write & Review and AI Arena screens
    Given the app is open
    Then the sidebar offers "Documents"
    And the sidebar does not offer "Write & Review"
    And the sidebar does not offer "AI Arena"

  @issue-648
  Scenario: The Pipelines tab lists the Planning pipelines under their new names
    Given the app is open
    When I open "Pipelines" in the sidebar
    Then the Pipelines tab lists the pipeline "spec-to-issues.yaml"
    And the Pipelines tab lists the pipeline "enrich-issue.yaml"
    And the Pipelines tab does not list the pipeline "rfc-to-issues.yaml"
    And the Pipelines tab does not list the pipeline "enrich-save-develop.yaml"
    And the Pipelines tab does not list the pipeline "ai-arena-write-review.yaml"

  @issue-648
  Scenario: A new item can be drafted by several writers
    Given the app is open
    When I open "Documents" in the sidebar
    And I open the New item panel
    And I turn on "Several writers" in the New item panel
    Then the New item panel has "Several writers" turned on
