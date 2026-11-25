Feature: First-run Setup
  On a new workspace, after the workspace dialog and sign-in, a Setup opens: a stepper (Agents, First
  project; #643 removed Workflows, #69 removed Try it safely) with Back / Next / Skip. Skip or Finish marks the
  setup as done and it never opens by itself again; Settings › Agents & CLIs can run it again. An existing
  workspace is marked as set up on upgrade, so it opens on Home. The Setup never changes the simulation
  mode (Settings › Execution › Developer mode): off on a new workspace, kept where it is on (#69).

  # Assumes a first start is a workspace folder with no settings.json, and that Skip asks the app's
  # confirm dialog before it closes the Setup.
  @issue-319 @smoke
  Scenario: A new workspace opens the Setup on its Agents step, and Skip leads to Home
    Given the app is open on a new workspace
    Then the first-run Setup is open on its "Agents" step
    And the Setup's stepper reads "Agents" and "First project"
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

  # The suite runs in simulation only, which shows the Simulation boxes whatever the setting: these
  # scenarios read the saved setting and its switch. Finish opens the Start panel, which the reload closes.
  @issue-69
  Scenario: Going through the Setup's two steps to Finish leaves the simulation mode off
    Given the app is open on a new workspace
    Then the first-run Setup is open on its "Agents" step
    And the Setup's stepper reads "Agents" and "First project"
    And the Setup's stepper has no "Try it safely" step
    When I go to the Setup's next step
    Then the project wizard is open on its first step
    When I close the project wizard
    And I finish the Setup
    Then the workspace settings record the setup as done
    And the workspace settings have developer mode "off"
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the developer mode switch is "off"

  # The demo workspace has developer mode on and a project, so First project opens no wizard.
  @issue-69
  Scenario: A workspace with the simulation mode on keeps it when the Setup is run again
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Agents & CLIs" settings tab
    And I ask to run the setup again
    Then the first-run Setup is open on its "Agents" step
    When I go to the Setup's next step
    And I finish the Setup
    Then the workspace settings record the setup as done
    And the workspace settings have developer mode "on"
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the developer mode switch is "on"
