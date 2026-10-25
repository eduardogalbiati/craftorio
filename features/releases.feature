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

  # #376: a release on the project city. A real git repository tagged 1.1.0, 1.1.1 and 1.1.2: 1.1.2
  # adds one file (#12), removes one and changes one (#13); see fronts/analyser/features/steps/release-city.steps.js
  # @fixme until #556 (release 1.3.0): since #430 the city opens in a modal the step does not look in
  @issue-376 @fixme
  Scenario: "Show on the map" on a release shows the city with what the release changed
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    Then the Architecture tab shows the project city
    And the city release header compares "1.1.1" to "1.1.2"
    And the city release header counts 1 added, 1 changed and 1 removed
    And the city release counts are given by the zone "Core" and the district "Sources"
    And the city offers "Save image" for the release

  @issue-376
  Scenario: Filtering a release by issue counts only that issue's files
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    And I pick the issue "#12" in the release's issue filter
    Then the city release header compares "1.1.1" to "1.1.2"
    And the city release header counts 1 added, 0 changed and 0 removed

  @issue-376
  Scenario: Picking an earlier tag compares any two releases on the city
    Given the app is open
    And the workspace has a git project "shop" tagged "1.1.0", "1.1.1" and "1.1.2" that shipped the release "1.1.2" with the issues "#12" and "#13"
    When I open "Releases" in the sidebar
    And I choose the project "shop" in the header
    And I click "Show on the map" on the release "1.1.2"
    And I pick "1.1.0" as the earlier tag of the release comparison
    Then the city release header compares "1.1.0" to "1.1.2"
    And the city release header counts 2 added, 0 changed and 0 removed

  # #436: the release name is picked with the recent releases in view and a suggested version. The
  # demo project gets four shipped releases (see features/steps/releases.steps.js); stage 3 of the demo
  # roadmap ("Reports and health") has no cut line yet. The suggestion depends on what the next release
  # holds, so the scenarios check it is one bump of 1.1.2 whose reason names that bump.

  @issue-436
  Scenario: The cut line dialog shows the last three releases, and Suggest version fills the name without closing it
    Given the app is open
    And the project shipped these releases:
      | version | date       | issues |
      | 1.0.0   | 2026-09-01 | 2      |
      | 1.1.0   | 2026-09-20 | 5      |
      | 1.1.1   | 2026-10-02 | 3      |
      | 1.1.2   | 2026-10-13 | 4      |
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    And I choose "Release here" in the stage actions menu
    Then the cut line dialog shows the recent releases "1.1.2 · 2026-10-13 · 4 issues", "1.1.1 · 2026-10-02 · 3 issues" and "1.1.0 · 2026-09-20 · 5 issues" above the "Release name" field
    And the cut line dialog does not list the release "1.0.0"
    When I click "Suggest version" in the cut line dialog
    Then the "Release name" field holds the version suggested after "1.1.2", with the reason
    And the cut line dialog is still open

  @issue-436
  Scenario: Suggest version on the Releases screen fills the version field, saying why
    Given the app is open
    And the project shipped these releases:
      | version | date       | issues |
      | 1.1.1   | 2026-10-02 | 3      |
      | 1.1.2   | 2026-10-13 | 4      |
    When I open "Releases" in the sidebar
    And I click "Suggest version" next to the release version
    Then the release version holds the version suggested after "1.1.2", with the reason

  # #454: saving the cut line dialog ("Release here"). Stage 3 of the demo roadmap ("Reports and
  # health") has no cut line. A saved cut line shows a toast with Undo. A refused save (the roadmap
  # changed elsewhere: here the same stage got another cut line outside the app while the dialog was
  # open, which the service refuses as "changed elsewhere too") reopens the dialog with the typed name
  # and the reason in the dialog's error; Cancel then closes it with nothing saved.

  @issue-454
  Scenario: Saving a cut line shows "Set the cut line" with Undo and draws the line after its stage
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    And I choose "Release here" in the stage actions menu
    And I type "1.3.0" as the release name in the cut line dialog
    And I click "Add cut line" in the cut line dialog
    Then the cut line dialog is closed
    And a toast says "Set the cut line 1.3.0" with an "Undo" button
    And the roadmap shows the cut line "1.3.0" right after stage 3
    When I click "Undo" in the toast
    Then the roadmap does not show the cut line "1.3.0"

  @issue-454
  Scenario: A cut line refused because the roadmap changed elsewhere reopens the dialog with the name and the reason, and Cancel saves nothing
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Roadmap
    And I open the stage actions menu of stage 3
    And I choose "Release here" in the stage actions menu
    And I type "1.3.0" as the release name in the cut line dialog
    And the cut line "1.2.9" is drawn after stage 3 outside the app
    Then the roadmap shows the cut line "1.2.9" right after stage 3
    When I click "Add cut line" in the cut line dialog
    Then the cut line dialog is still open
    And the cut line dialog's "Release name" field holds "1.3.0"
    And the cut line dialog's error says "changed elsewhere"
    When I click "Cancel" in the cut line dialog
    Then the cut line dialog is closed
    And the roadmap does not show the cut line "1.3.0"
    And the roadmap shows the cut line "1.2.9" right after stage 3

  # #489: every merge into main becomes a release candidate vX.Y.Z-rc.N (with its run and its issues);
  # the owner promotes one to stable, the stable version suggested from the issues' labels and
  # editable, or holds one so the night train never promotes it. The candidates are seeded in the
  # release history file of #260 (<workspace>/releases/<projectId>.json, a `candidates` list): see
  # features/steps/releases-489.steps.js. The last stable release is 1.2.0; rc.2 adds an enhancement.

  @issue-489
  Scenario: Promoting the last release candidate suggests its stable version and makes it the latest stable release
    Given the app is open
    And the project has the release candidates "v1.3.0-rc.1" and "v1.3.0-rc.2" since the stable release "1.2.0"
    When I open "Releases" in the sidebar
    Then the Releases screen lists the candidates "v1.3.0-rc.2" and "v1.3.0-rc.1", newest first, each with its run and issues
    When I click "Promote to stable" on the candidate "v1.3.0-rc.2"
    Then the stable version suggested for the promotion is "1.3.0", and I can edit it
    When I confirm the promotion
    Then the candidate "v1.3.0-rc.2" shows as the stable release "1.3.0", marked latest

  @issue-489
  Scenario: Holding a release candidate marks it held, so the night train does not promote it
    Given the app is open
    And the project has the release candidates "v1.3.0-rc.1" and "v1.3.0-rc.2" since the stable release "1.2.0"
    When I open "Releases" in the sidebar
    And I click "Hold" on the candidate "v1.3.0-rc.2"
    Then the candidate "v1.3.0-rc.2" is marked held
    And the candidate "v1.3.0-rc.1" is not marked held

  # The candidate's rc disappears outside the app (another window, a script) while the screen is open:
  # its commit has no rc any more, so the promotion is refused with the reason and nothing is stable.
  @issue-489
  Scenario: Promoting a commit that no longer has a release candidate is refused with the reason
    Given the app is open
    And the project has the release candidates "v1.3.0-rc.1" and "v1.3.0-rc.2" since the stable release "1.2.0"
    When I open "Releases" in the sidebar
    And I click "Promote to stable" on the candidate "v1.3.0-rc.2"
    And the release candidate "v1.3.0-rc.2" is removed outside the app
    And I confirm the promotion
    Then the promotion is refused with a reason saying the commit has no release candidate
    And no release "1.3.0" is shown as stable
