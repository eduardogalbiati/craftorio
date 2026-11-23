Feature: A project created without a remote is told to add a repository on its way to a first issue
  A project created in the wizard without a remote ("Also create a private repository" left unticked, as it is
  in the simulated app, with no gh / glab signed in) has no repository: its Backlog and Roadmap say so, and the
  Product Owner cannot file an issue for it. Its project page's Next steps card starts with "a repository is
  needed", whose action opens the project's settings (Projects › Edit) where the repository can be added,
  instead of "Create an issue with the PO"; the Product Owner's drawer says so before anything is typed, in the
  interface language, and does not send; the wizard's step 2 warns next to the remote option (#25).

  # Until #25 the first Next steps card was "Create an issue with the PO › Open the PO", and the drawer refused
  # after Send with the engine's English "Sync the backlog first…".
  @issue-25
  Scenario: A project created without a remote starts its Next steps by asking for a repository, which opens its settings
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
    And the first step of the Next steps card says the project needs a repository, without "Open the PO"
    When I choose to add a repository from the Next steps card
    Then the settings of the project "Garden Log" are open

  @issue-25
  Scenario: In Português (Brasil), the Product Owner's drawer on a project without a repository says so before I type, and does not send
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
    Then the Product Owner's drawer says the project has no repository, in "Português (Brasil)"
    And the Product Owner's drawer shows none of these English texts:
      | Sync the backlog first |
      | has no repository      |
    And the Product Owner cannot be sent a question

  @issue-25
  Scenario: The wizard's step 2 for a new project warns next to the remote option that without a repository there is no Backlog and no Roadmap
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    Then the wizard says next to the private repository option that without a repository the Backlog and the Roadmap are not available
