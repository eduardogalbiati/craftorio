Feature: A project created without a remote goes to its first issue as one with a repository does
  A project created in the wizard without a remote ("Also create a private repository" left unticked, as it is
  in the simulated app, with no gh / glab signed in) has no repository. Since #35 it keeps a local backlog, so
  nothing tells it to add a repository first: its project page's Next steps card starts with "Create an issue
  with the PO", the Product Owner's drawer takes its questions, and the wizard's step 2 no longer warns that the
  Backlog and the Roadmap are not available (#25, changed by #35).

  # Until #35 (since #25) the first Next steps card was "Add a repository to create issues", opening the
  # project's settings; the drawer said "Este projeto não tem repositório: …" before anything was typed and did
  # not send; the wizard warned next to the remote option that the Backlog and the Roadmap were not available.
  @issue-25
  Scenario: A project created without a remote starts its Next steps with the Product Owner, not with a repository
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    Then the private repository option cannot be ticked
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Garden Log" is open
    And the first step of the Next steps card is "Create an issue with the PO" with the button "Open the PO"

  @issue-25
  Scenario: In Português (Brasil), the Product Owner's drawer on a project without a repository does not refuse it, and takes a question
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Diario da Horta"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Diario da Horta" is open
    When I open "Backlog" in the sidebar
    And I choose the project "Diario da Horta" in the header
    And I open the Product Owner
    Then the Product Owner's drawer does not say the project has no repository
    And the Product Owner's drawer shows none of these English texts:
      | Sync the backlog first |
      | has no repository      |
    And the Product Owner can be sent a question

  @issue-25
  Scenario: The wizard's step 2 for a new project no longer warns that without a repository there is no Backlog and no Roadmap
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    Then the wizard does not say that without a repository the Backlog and the Roadmap are not available
