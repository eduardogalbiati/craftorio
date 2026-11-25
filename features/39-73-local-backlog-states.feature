Feature: The local backlog of a project with no repository shows no part of a platform-synced backlog
  A project with no repository keeps its issues in the workspace (#35). Its Backlog and its Roadmap say so: no sync
  date, no "{value}", no platform to pick, and the issue run names no platform (#39). A run merged locally has no
  push waiting there: the Backlog shows no push status, and a closed local issue is listed as closed (#73).

  # Until #39 both pages said "Sincronizado 31/12/1969, 21:00 de {value}" under "As issues de um projeto,
  # sincronizadas da plataforma git", with a GitHub / GitLab / Bitbucket select, and the empty Roadmap ended with the
  # line "Proposta do Product Owner…".
  @issue-39
  Scenario: In Português (Brasil), the Backlog and the Roadmap of a project with no repository are a local backlog
    Given the app is open
    And the workspace has a project "diario-da-horta" with no repository and the open local issue "Anotar a colheita"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I choose the project "diario-da-horta" in the header
    Then the local backlog lists the issue "Anotar a colheita"
    And the page is described as kept in the workspace
    And the page shows no sync date and no unfilled placeholder
    And the page offers no git platform
    When I open "Roadmap" in the sidebar
    Then the open screen says "Nenhum roadmap ainda"
    And the page is described as kept in the workspace
    And the page shows no sync date and no unfilled placeholder
    And the page offers no git platform
    And the open screen does not say "Proposta do Product Owner…"

  @issue-39
  Scenario: In English, the Backlog of a project with no repository is a local backlog
    Given the app is open
    And the workspace has a project "garden-log" with no repository and the open local issue "Export the harvest"
    When I open "Backlog" in the sidebar
    And I choose the project "garden-log" in the header
    Then the local backlog lists the issue "Export the harvest"
    And the page is described as kept in the workspace
    And the page shows no sync date and no unfilled placeholder
    And the page offers no git platform

  # Until #39 the run's inputs recorded git_platform "gh" and its Details showed "Platform: GitHub"
  @issue-39
  Scenario: The issue run of a project with no repository names no platform
    Given the app is open
    And the workspace has a project "garden-log" with no repository and the open local issue "Export the harvest"
    When I open "Backlog" in the sidebar
    And I choose the project "garden-log" in the header
    And I choose "New issue…" on the Backlog
    Then the Start panel opens on the workflow "issue"
    When I start the issue run in simulation with the request "Let gardeners export their planting log as a CSV file"
    Then the run is running
    And the run shows the pill "Mode: Validated"
    And the run shows no input pill "Platform"

  # The merge itself and the issue it closes are not simulable (a simulated run merges nothing): the unit tests cover
  # them. The workspace is as a merged run left it: one issue closed, one open again after its run merged, and the
  # push status the old version cached ("origin/main not found").
  @issue-73
  Scenario: A project with no repository lists its closed local issue as closed, and shows no push status after a local merge
    Given the app is open
    And the workspace has a project "garden-log" with no repository, the closed local issue "Add a contribution guide" and the open local issue "Export the harvest" whose run merged locally
    When I open "Backlog" in the sidebar
    And I choose the project "garden-log" in the header
    Then the local backlog lists the issue "Export the harvest"
    And the local backlog counts 1 open issue and 1 closed issue
    And the open screen does not say "Push status unknown"
    And the open screen does not say "origin/main"
    When I show the closed issues of the local backlog
    Then the local backlog lists the issue "Add a contribution guide"

  @issue-73
  Scenario: In Português (Brasil), a local merge of a project with no repository leaves no push status on the Backlog
    Given the app is open
    And the workspace has a project "diario-da-horta" with no repository, the closed local issue "Guia de contribuição" and the open local issue "Anotar a colheita" whose run merged locally
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I choose the project "diario-da-horta" in the header
    Then the local backlog lists the issue "Anotar a colheita"
    And the open screen does not say "Status do push desconhecido"
    And the open screen does not say "origin/main"
