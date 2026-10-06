Feature: Releases
  The owner decides where a release ends: a cut line drawn on the Roadmap between two stages
  ("Release here", with a name) holds the stages after it until the release run ships. The Releases
  screen lists what was shipped and what the next release holds, with notes editable before Ship,
  and the release run waits at a human-only Ship gate (Ship or Hold).

  @issue-260 @smoke
  Scenario: Drawing a cut line on the Roadmap shows "Release here" with its name between two stages
    Given the app is open
    When I open the Roadmap
    And I draw a cut line "v1.0" after stage 1
    Then the roadmap shows a cut line "v1.0" between stage 1 and stage 2

  # Assumes the release history is stored in <workspace>/releases/<projectId>.json (see
  # features/steps/releases.steps.js); the demo's next release is what is merged locally: #11
  @issue-260
  Scenario: The Releases screen lists the shipped releases and the next release, with editable notes
    Given the app is open
    And the project shipped the release "v0.9" with the issue "Export a run report as Markdown"
    When I open "Releases" in the sidebar
    Then the sidebar reads, top to bottom:
      | entry        | items                                |
      | Code & Build | Backlog, Roadmap, Releases, Sessions |
    And "Releases" comes right after "Roadmap" in the sidebar
    And the Releases list shows the release "v0.9" with its issues, cost and test results
    And the next release lists the issue "Crash when the workspace folder is renamed"
    When I write "Fixes the rename crash." in the next release's notes
    And I reload the app
    And I open "Releases" in the sidebar
    Then the next release's notes read "Fixes the rename crash."

  @issue-260
  Scenario: A release run waits at the Ship gate offering Ship and Hold
    Given the app is open
    When I start a simulated run of the workflow "release.yaml"
    Then the run is running
    And a gate card waits for my approval
    And the gate card offers "Ship" and "Hold"
