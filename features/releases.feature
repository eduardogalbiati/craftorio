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

  # #290: a release run that needed a fix gets a "Release summary" step before the Ship gate. The
  # simulated run is started with its unit suite red on the first round (the fix, then both suites
  # green): see features/steps/releases.steps.js
  @issue-290
  Scenario: The Ship gate of a release that needed a fix shows the release summary first
    Given the app is open
    And a simulated release run "v1.0" whose unit suite was red once is open
    Then a gate card waits for my approval
    And the gate card shows the release summary with "Timeline", "The fixes", "Before you ship" and "Follow-ups"
    And the release summary comes before "Not on origin yet" in the gate card
    And the gate card offers "Ship" and "Hold"

  @issue-290
  Scenario: The release summary is one of the run's reports
    Given the app is open
    And a simulated release run "v1.0" whose unit suite was red once is open
    And a gate card waits for my approval
    When I open the run's Artifacts tab
    And I filter the artifacts by "Reports"
    Then the artifacts list "release-summary.md"

  # Assumes the release history file of #260 (<workspace>/releases/<projectId>.json) and the release
  # run's folder <workspace>/runs/<runId>/release-summary.md (see features/steps/releases.steps.js)
  @issue-290
  Scenario: The Releases screen links a shipped release to its release summary
    Given the app is open
    And the project shipped the release "v0.9" whose release run wrote a release summary
    When I open "Releases" in the sidebar
    And I open the release summary of the release "v0.9"
    Then the release summary shows "Timeline", "The fixes", "Before you ship" and "Follow-ups"
