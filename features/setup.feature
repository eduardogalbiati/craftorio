Feature: First-run Setup
  On a new workspace, after the workspace dialog and sign-in, a Setup opens: a stepper (Agents, Try
  it safely, First project; #643 removed Workflows) with Back / Next / Skip. Skip or Finish marks the setup as done
  and it never opens by itself again; Settings › Agents & CLIs can run it again. An existing
  workspace is marked as set up on upgrade, so it opens on Home.

  # Assumes a first start is a workspace folder with no settings.json, and that Skip asks the app's
  # confirm dialog before it closes the Setup.
  @issue-319 @smoke
  Scenario: A new workspace opens the Setup on its Agents step, and Skip leads to Home
    Given the app is open on a new workspace
    Then the first-run Setup is open on its "Agents" step
    And the Setup's stepper reads "Agents", "Try it safely" and "First project"
    And the Setup lists Claude Code, Codex CLI, Grok Build, GitHub CLI, GitLab CLI and Git, each with a status
    And the Setup marks "Claude Code" as required
    And the Setup marks "Git" as required
    When I skip the Setup and confirm
    Then the first-run Setup is not shown
    And Home is on its "Overview" tab

  # Assumes the renderer reads setupDone when its window loads (so a reload stands for the next start).
  @issue-319
  Scenario: A skipped Setup does not open again by itself
    Given the app is open on a new workspace
    When I skip the Setup and confirm
    Then the workspace settings record the setup as done
    When I reload the app
    Then Home is on its "Overview" tab
    And the first-run Setup is not shown

  # The demo workspace has settings.json without setupDone and a project: an upgraded workspace.
  @issue-319
  Scenario: An existing workspace opens on Home, and Settings can run the setup again
    Given the app is open
    Then Home is on its "Overview" tab
    And the first-run Setup is not shown
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Agents" step
