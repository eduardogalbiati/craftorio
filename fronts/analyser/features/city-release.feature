Feature: A release on the project city reads the change ramp, the rename sign and an older release's plan
  "Show on the map" on a shipped release draws the city as it was at the previous release with what the
  release changed (#376). The "changed" chip and the city legend show the four-shade change ramp, from
  few lines to many with the line counts of each shade, not one dot; renamed files carry a sign on the
  map that the legend names and the "renamed" chip shows, not an orange dot; added stays green and
  removed grey (#438). On an older release, the files and districts of today's plan the old commit
  lacks are not "problems in the city plan": at most one muted line says how many did not exist yet,
  with the list behind a disclosure; closing the release view brings back today's notes (#439).
  The projects are real git repositories seeded in the scenario's scratch folder, not the simulated
  demo workspace (its demo project has no tags): see fronts/analyser/features/steps/release-city.steps.js.

  # #438: 2.0.0 → 2.0.1 changes src/a.js, b, c and d by 2, 30, 60 and 120 lines (the ramp is relative
  # to the most lines, so the four fall in four shades), renames one file unchanged, adds and removes one
  @issue-438
  Scenario: The release legend shows the change ramp in four shades with their line counts, and the rename sign
    Given the app is open
    And the workspace has a git project "studio" whose release "2.0.1" after "2.0.0" changes four files by 2, 30, 60 and 120 lines, renames "src/old-name.js" to "src/new-name.js", adds one file and removes one
    When I open "Releases" in the sidebar
    And I choose the project "studio" in the header
    And I click "Show on the map" on the release "2.0.1"
    Then the city release header compares "2.0.0" to "2.0.1"
    And the city release header counts 1 added, 4 changed and 1 removed
    And the city legend shows the change ramp in 4 shades from few lines to many, each with its line count
    And the "changed" chip of the release header shows the change ramp, not a single dot
    And the city legend's "Renamed" row shows the rename sign of the map
    And the "renamed" chip of the release header shows the rename sign, not an orange dot
    And the city legend has the "Added" row
    And the city legend has the "Removed" row

  # #439: "atlas" shipped 1.0.0 (src/keep.js) and 1.1.0 (adds src/new.js); after 1.1.0 today's plan
  # gained the districts Tools and Scripts with tools/export.js and scripts/build.js (landmarks of the
  # plan) and 10 files under lib/ that no district covers (today's city: "The plan is older than the
  # code"). The release 1.1.0 is drawn at 1.0.0, which lacks 2 files and 2 districts of today's plan.
  # Assumption: the line names the tag the city is drawn at (the earlier tag, 1.0.0).
  @issue-439
  Scenario: An older release does not report today's plan as problems, only one muted line of what did not exist yet
    Given the app is open
    And the workspace has a git project "atlas" that shipped the release "1.1.0" after "1.0.0", then added the districts "Tools" and "Scripts" of its plan with the files "tools/export.js" and "scripts/build.js", and 10 files outside the plan
    When I open "Releases" in the sidebar
    And I choose the project "atlas" in the header
    And I click "Show on the map" on the release "1.1.0"
    Then the city release header compares "1.0.0" to "1.1.0"
    And the city shows no note of problems in the city plan
    And the release view says in one muted line "At 1.0.0, 2 files and 2 districts of today's plan did not exist yet"
    When I open the list of what did not exist yet
    Then the list of what did not exist yet names "tools/export.js", "scripts/build.js", "Tools" and "Scripts"

  @issue-439
  Scenario: Closing the release view brings back today's notes of the city plan
    Given the app is open
    And the workspace has a git project "atlas" that shipped the release "1.1.0" after "1.0.0", then added the districts "Tools" and "Scripts" of its plan with the files "tools/export.js" and "scripts/build.js", and 10 files outside the plan
    When I open "Releases" in the sidebar
    And I choose the project "atlas" in the header
    And I click "Show on the map" on the release "1.1.0"
    Then the release view says in one muted line "At 1.0.0, 2 files and 2 districts of today's plan did not exist yet"
    When I close the release on the city
    Then the city's notes say "The plan is older than the code"
    And the city no longer says what did not exist yet
