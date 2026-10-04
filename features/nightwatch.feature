Feature: Night watch
  The Night watch screen on the demo workspace: the owner's permissions (what the Oracle may do
  without asking at night) are saved and stay as the owner left them.

  @issue-239
  Scenario: Ticked permissions stay ticked after Save and after coming back to the screen
    Given the app is open
    When I open "Night watch" in the sidebar
    And I tick the permission "Skip an item"
    And I tick the permission "Regroup or reorder planned items"
    And I save the permissions
    Then the permissions show when they were saved
    And the permission "Skip an item" is ticked
    And the permission "Regroup or reorder planned items" is ticked
    And the permission "Retry a failed roadmap item" is ticked
    When I open "Home" in the sidebar
    And I open "Night watch" in the sidebar
    Then the permission "Skip an item" is ticked
    And the permission "Regroup or reorder planned items" is ticked
    And the permission "Retry a failed roadmap item" is ticked

  @issue-239
  Scenario: Unticking every permission on purpose and saving keeps them all unticked
    Given the app is open
    When I open "Night watch" in the sidebar
    And I untick every permission
    And I save the permissions
    Then the permissions show when they were saved
    And no permission is ticked
    When I open "Home" in the sidebar
    And I open "Night watch" in the sidebar
    Then no permission is ticked
