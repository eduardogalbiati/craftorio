@issue-222 @visual
Feature: Visual baselines
  Key screens compared pixel by pixel with their committed baselines (features/__screenshots__), in
  both themes, at a fixed window size with simulated data and animations off. A difference over the
  config's maxDiffPixelRatio fails with the diff image attached. Update a baseline on purpose:
  npm run test:e2e:update -- --grep @visual

  Scenario Outline: The Backlog Board looks like its baseline in the <theme> theme
    Given the app is open in the <theme> theme
    When I open "Backlog" in the sidebar
    And I open the Board as a kanban
    Then the board looks like the baseline "backlog-board-<theme>.png"

    Examples:
      | theme |
      | light |
      | dark  |
