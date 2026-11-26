Feature: A repository's own default workflow says it awaits the owner's acceptance
  A repository whose .craftorio/ manifest makes its own copy of a workflow the project's default (as this repository
  does with ai-development-remote-hero) cannot run it until the owner accepts it on the Definitions page. The
  wizard's step 3 ("Análise e workflows") and step 4 ("Revisão") say the default must be reviewed and accepted before
  it runs, with "Review and accept" ("Revisar e aceitar") leading to Definitions; the project page's Next steps show
  "Accept the repository's workflows" ("Aceitar os workflows do repositório") until it is accepted; Start workflow
  ("Iniciar workflow") says the default awaits acceptance, links to Definitions and opens on the project's bundled
  Feature workflow, never on the last workflow another project used; the Backlog's Assign dialog marks the workflow
  awaiting acceptance and does not open on it (#40). The interface is in English here; Portuguese in brackets.

  @issue-40
  Scenario: The wizard's analysis and review steps say the repository's default must be reviewed and accepted before it runs
    Given the app is open
    And a local git repository whose manifest declares its own workflow "ai-development-remote-hero" as its default is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "hero-40"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the wizard says the default workflow "ai-development-remote-hero" must be reviewed and accepted before it runs, offering "Review and accept"
    When I skip the analysis for later
    Then the wizard is on its "review" step
    And the wizard says the default workflow "ai-development-remote-hero" must be reviewed and accepted before it runs, offering "Review and accept"

  # The workspace's last workflow is set to test-backfill, so opening on it would be another project's choice
  @issue-40
  Scenario: Until the default is accepted, the project page asks for it and Start workflow opens on Feature with a hint linking to Definitions
    Given the app is open
    And the last workflow used is "test-backfill"
    And a local git repository whose manifest declares its own workflow "ai-development-remote-hero" as its default is ready to import
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the local repository and the project name "hero-start-40"
    And I go to the next step of the wizard
    And I skip the analysis for later
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "hero-start-40" is open
    And the Next steps card asks to accept the repository's workflows
    When I choose Start workflow on the project page
    Then the Start panel opens on the workflow "feature"
    And the Start panel says the project's default workflow awaits acceptance, with a link to Definitions
    When I follow the Start panel's link to Definitions
    Then the workflow "ai-development-remote-hero" is not accepted
    When I accept the workflow "ai-development-remote-hero"
    Then the workflow "ai-development-remote-hero" is accepted
    When I open "Projects" in the sidebar
    And I open the project "hero-start-40" from the Projects screen
    Then the Next steps card no longer asks to accept the repository's workflows

  @issue-40
  Scenario: The Backlog's Assign dialog marks the workflow awaiting acceptance and does not open on it
    Given the app is open
    And the workspace has a project "hero-shop" whose repository declares its own workflow "ai-development-remote-hero" as its default, not accepted yet
    And the backlog of "hero-shop" has the open issue "Export orders as CSV"
    When I open "Backlog" in the sidebar
    And I choose the project "hero-shop" in the header
    And I open the Assign dialog for the backlog issue "Export orders as CSV"
    Then the Assign dialog marks the workflow "ai-development-remote-hero" as awaiting acceptance
    And the Assign dialog does not have the workflow "ai-development-remote-hero" chosen
