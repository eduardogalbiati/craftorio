Feature: The project wizard's step 2 says why an import failed, and where a new project will really go
  On step 2 of the project wizard, "Import a repository" ("Importar um repositório") that fails says why in the
  interface's language, naming its real cause: a repository that does not exist, a private repository the owner has
  no access to; never "credentials" for a cause that is not one. A
  failed import leaves no project in the Projects list (#107). "Create new project" ("Criar novo projeto") says under
  the name that a name is required when it is empty, and shows the folder the project will really get before Next:
  the name made a folder name, and with a number after it when a project already has that folder (#108).

  # GitHub's answer for the URL is simulated (an E2E hook, see onboarding.steps.js): the scenario does not depend on
  # the network. Portuguese wording expected: "não existe"; never "credenciais" for this cause.
  @issue-107
  Scenario: In Português (Brasil), importing a repository that does not exist says so in Portuguese and leaves no project
    Given the app is open where GitHub says the repository I import does not exist
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the repository "https://github.com/nao-existe/xyz" and the project name "xyz-107"
    And I go to the next step of the wizard
    Then the wizard says the import failed because "the repository does not exist"
    And the wizard's import error reads "não existe"
    And the wizard's import error does not read "credenciais"
    When I close the project wizard
    And I open "Projetos" in the sidebar
    Then the Projects screen does not list the project "xyz-107"

  @issue-107
  Scenario: Importing a private repository I have no access to says I have no access, and leaves no project
    Given the app is open where GitHub says the repository I import is private and I have no access to it
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the repository "https://github.com/acme-private/segredo" and the project name "segredo-107"
    And I go to the next step of the wizard
    Then the wizard says the import failed because "I have no access to the repository"
    And the wizard's import error reads "access"
    And the wizard's import error does not read "does not exist"
    When I close the project wizard
    And I open "Projects" in the sidebar
    Then the Projects screen does not list the project "segredo-107"

  # #98 retired the scenario of a local folder that is not a git repository: such a folder now becomes a project
  # (a new repository from its files), see 98-local-folder-any-folder.feature.

  @issue-108
  Scenario: Creating a new project with an empty name says under the name that it is required
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "rascunho"
    And I clear the new project's name
    Then the wizard says under the project name that a name is required
    And the next step of the wizard is unavailable
    When I name the new project "rascunho"
    Then the wizard no longer says that a project name is required

  # The existing project "lista-tarefas" holds <workspace>/projects/lista-tarefas
  @issue-108
  Scenario: A name already taken by a project shows, before Next, the numbered folder the new project really gets
    Given the app is open
    And the workspace has a project "lista-tarefas"
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "lista-tarefas"
    Then the new project will be created in "projects/lista-tarefas-2" of the workspace
    When I go to the next step of the wizard
    Then the wizard is on its "analysis" step
    And the workspace's "projects/lista-tarefas-2" is a git repository with "README.md" and ".gitignore" committed on main

  @issue-108
  Scenario: A name that is not a folder name as typed shows the folder name it becomes
    Given the app is open
    When I open the project wizard
    And I choose to create a new project in the wizard
    And I name the new project "Lista de Compras!"
    Then the new project will be created in "projects/lista-de-compras" of the workspace
