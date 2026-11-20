Feature: The project city opens framing the whole city, and zoom out moves the camera away
  The City (the City tab of a project, the city expanded over the whole window) opens with every
  district and the top of the tallest building in sight, even when one file is far larger than the rest
  and its building towers over the city; before #849 the camera opened so close to that building that
  only its wall showed. Each click of the camera's "Zoom out" (−) moves the camera visibly away, about a
  fifth of its distance, back to a view of the whole city. The project is a seeded "billing-service"
  whose src/billing.js has about 3,000 lines next to four files of 10 to 30 lines, with a city plan of
  two districts (Billing: src/, Export: tools/); see fronts/analyser/features/steps/architecture.steps.js,
  which also names what the city's root tells about its camera.

  @issue-849
  Scenario: The City tab opens with the whole city in the frame when one file towers over the rest
    Given the app is open
    And the workspace has a git project "billing-service" with one file far larger than the others and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    And the city shows the whole city in the frame
    And the camera rests at the whole-city view

  @issue-849
  Scenario: The city expanded over the whole window shows the whole city in the frame
    Given the app is open
    And the workspace has a git project "billing-service" with one file far larger than the others and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I expand the city
    Then the city covers the whole window
    And the city shows the whole city in the frame

  @issue-849
  Scenario: Each click of Zoom out moves the camera visibly away, back to the whole city
    Given the app is open
    And the workspace has a git project "billing-service" with one file far larger than the others and a city plan
    When I open "Projects" in the sidebar
    And I open the project "billing-service" from the Projects screen
    And I open the "City" project tab
    Then the City tab shows the project city
    When I zoom in the city 3 times
    And I zoom out the city
    Then the camera is at least 15% farther than before
    When I zoom out the city
    Then the camera is at least 15% farther than before
    When I zoom out the city 10 times
    Then the city shows the whole city in the frame
