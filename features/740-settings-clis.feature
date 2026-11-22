Feature: Settings › Agents & CLIs manages the CLIs, outside the first-run Setup
  The CLIs (Claude Code, Codex CLI, Grok Build, GitHub CLI, GitLab CLI, Git) are managed from
  Settings › Agents & CLIs, an engine setting: each row shows its status, version and account with
  Install / Sign in, in a page or drawer that closes, with no setup stepper. The project wizard's
  "CLI missing" warning opens that section with the missing CLI highlighted, and closing it returns
  to the wizard at the same step. Install runs on the engine's machine (the simulated one in E2E),
  its output live in a console panel, and the row is checked again when it ends. The first-run Setup
  opens by itself only on a new workspace.

  # E2E's HOME is the scenario's scratch folder (GLAB_CONFIG_DIR empty): the GitLab CLI is never
  # ready there, missing or not signed in, so its row always offers Install or Sign in.
  @issue-740
  Scenario: Agents & CLIs lists the CLIs with their status and actions, closes, and has no setup stepper
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    Then Agents & CLIs lists Claude Code, Codex CLI, Grok Build, GitHub CLI, GitLab CLI and Git, each with a status
    And the "GitLab CLI" row of Agents & CLIs offers Install or Sign in
    And Agents & CLIs has a close button
    And Agents & CLIs shows no setup stepper and no Next or Skip

  # Assumes a simulated machine can lack a CLI: CRAFTORIO_E2E_CLI_MISSING=glab (simulation only, like
  # the other CRAFTORIO_E2E_* hooks) makes the engine's probes find no glab. The GitLab URL cannot be
  # reached (the access error shows too); the CLI check runs anyway and warns that glab is missing.
  @issue-740
  Scenario: The wizard's CLI warning opens Agents & CLIs on the missing CLI, and closing it returns to the wizard's step
    Given the app is open on a machine without the "GitLab CLI"
    When I open the project wizard
    And I choose to import a repository in the wizard
    And I enter the repository "https://gitlab.com/multiagent-e2e/does-not-exist-740" and the project name "missing-740"
    And I go to the next step of the wizard
    Then the wizard warns that "glab" is not installed
    When I open the Setup from the wizard's CLI warning
    Then Agents & CLIs is open with the "GitLab CLI" row highlighted
    And the first-run Setup is not shown
    When I close Agents & CLIs
    Then the wizard is on its "repository" step
    And the wizard's project name reads "missing-740"
    And the wizard warns that "glab" is not installed

  # Assumes the simulated machine's install of a CLI the hook made missing writes its output to the
  # console panel, never installs anything, and leaves that CLI installed (not signed in: GLAB_CONFIG_DIR
  # is empty) for the re-check that follows, so the row no longer reads "Not installed".
  @issue-740
  Scenario: Install from Agents & CLIs shows its output in a console panel and checks the row again
    Given the app is open on a machine without the "GitLab CLI"
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    Then the "GitLab CLI" row of Agents & CLIs reads "Not installed"
    When I install "GitLab CLI" from Agents & CLIs
    Then the CLI console shows the install of "GitLab CLI" and that it ended
    And the "GitLab CLI" row of Agents & CLIs is checked again and no longer reads "Not installed"
