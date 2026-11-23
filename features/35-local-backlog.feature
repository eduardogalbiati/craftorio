Feature: A project with no remote keeps a local backlog, so its first issue needs no repository
  A project created in the wizard with "Create a new project" and "Also create a private repository" left
  unticked (the default; the simulated app has no gh / glab signed in) has a local backlog: its issues live in
  the workspace, so the Backlog's "New issue…", the Product Owner and the Roadmap work as they do for a project
  with a repository, and nothing is sent to a platform (#35). The wizard no longer warns that the Backlog and the
  Roadmap are not available, and the project's Next steps start with "Create an issue with the PO".

  # Until #35 (since #25) such a project was refused: "This project has no repository" on the Backlog and the
  # Roadmap with Sync and New issue… disabled, "Add a repository to create issues" first on Next steps, and the
  # Product Owner's drawer saying "This project has no repository: …". A request of eight words or more gets a
  # simulated draft at once; in simulation Create only previews the filing.
  @issue-35
  Scenario: A new project created without a repository starts its Next steps with the Product Owner, who drafts its first issue
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    Then the private repository option cannot be ticked
    And the wizard does not say that without a repository the Backlog and the Roadmap are not available
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Garden Log" is open
    And the first step of the Next steps card is "Create an issue with the PO" with the button "Open the PO"
    When I click "Open the PO" in the Next steps card
    Then the Product Owner's chat is open on "Register an issue" for the project "Garden Log"
    When I ask the Product Owner "Let gardeners export their planting log as a CSV file from the log screen"
    Then the Product Owner answers
    And the Product Owner's drawer shows a draft of the issue, ready to create
    And the Product Owner's drawer does not say the project has no repository

  @issue-35
  Scenario: The Backlog of a project with no repository offers New issue…, which opens the Start panel on the issue workflow, and no Sync
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Garden Log"
    And I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Garden Log" is open
    When I open "Backlog" in the sidebar
    And I choose the project "Garden Log" in the header
    Then the open screen does not say "This project has no repository"
    And the Backlog does not offer "Sync"
    And the Backlog offers "New issue…", enabled
    When I choose "New issue…" on the Backlog
    Then the Start panel opens on the workflow "issue"

  @issue-35
  Scenario: In Português (Brasil), the Backlog and the Roadmap of a project with no repository no longer say it has none
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Diario da Horta"
    Then the wizard does not say that without a repository the Backlog and the Roadmap are not available
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    When I go to the next step of the wizard
    Then the wizard is on its "review" step
    When I finish the wizard
    Then the project page of "Diario da Horta" is open
    When I open "Backlog" in the sidebar
    And I choose the project "Diario da Horta" in the header
    Then the open screen does not say "Este projeto não tem repositório"
    And the Backlog does not offer "Sincronizar"
    And the Backlog offers "Nova issue…", enabled
    When I open "Roadmap" in the sidebar
    Then the open screen does not say "Este projeto não tem repositório"
