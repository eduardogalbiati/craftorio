Feature: Write an item's intent and spec with the writer, change by change, up to sign-off
  Plan & Design > Documents lists the project's items with their stage, read from the repository's
  docs/work/. "New item" starts with the intent: the writer drafts it, I select a passage on the page
  and ask for a change in the writer's chat, and each request becomes its own entry in the changes
  by request, with an unreviewed queue ("Mark reviewed", "Undo this change") and its count. Only my
  "Send to review" ends the editing; "Accept intent" closes the intent. An accepted intent offers
  "Write the spec", which ends with "Sign off spec"; then "Create epic and phase issues" and
  "Start the Build" are offered, and nothing is filed or started until I click them.

  @smoke @issue-647
  Scenario: A new item's intent is drafted, changed on a selected passage, reviewed and accepted
    Given the app is open
    When I open "Documents" in the sidebar
    And I start a new item "Export runs as CSV"
    Then the writer drafts the intent with the section "Problem"
    When I select a passage of the "Problem" section
    And I ask the writer "Say who exports the runs" about the selected passage
    Then the changes by request show the change "Say who exports the runs"
    And the document has 1 unreviewed change
    When I send the document to review
    And I choose "Accept intent" at the approval gate
    Then the document is shown as "Accepted"

  @issue-647
  Scenario: The spec of an accepted intent is written and signed off, and the next steps wait for my click
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with an accepted intent
    When I open "Documents" in the sidebar
    And I choose "Write the spec" on the item "Export runs as CSV"
    Then the writer drafts the spec with the section "Requirements"
    When I send the document to review
    And I choose "Sign off spec" at the approval gate
    Then the document is shown as "Signed off"
    And the document offers "Create epic and phase issues" and "Start the Build"
    And no issue was filed and no build was started

  @issue-647
  Scenario: Undoing a change in the unreviewed queue brings the previous text back
    Given the app is open
    When I open "Documents" in the sidebar
    And I start a new item "Keyboard shortcuts"
    Then the writer drafts the intent with the section "Problem"
    When I select a passage of the "Problem" section
    And I ask the writer "Make it shorter" about the selected passage
    Then the changes by request show the change "Make it shorter"
    And the "Problem" section no longer reads as before the change
    When I undo the change "Make it shorter" in the unreviewed queue
    Then the unreviewed queue no longer shows the change "Make it shorter"
    And the "Problem" section reads as before the change

  # #671: the screens match the spec's mockups (docs/work/write-doc/images/mock-1..5.jpg, living-doc.jpg),
  # drawn in the dark theme (baselines: npm run test:e2e:update -- --grep @issue-671)
  @issue-671 @visual
  Scenario: The Documents list shows each item's stages and status, next to the New item panel
    Given the app is open in the dark theme
    And the demo project's repository has the item "Export runs as CSV" with an accepted intent
    When I open "Documents" in the sidebar
    Then the item "Export runs as CSV" shows the stages "Plan ✓"
    And the item "Export runs as CSV" shows the status of "intent.md"
    When I open the New item panel
    Then the New item panel starts with "intent.md (Plan)"
    And the New item panel asks "What it is about", "Screens to capture first" and "Several writers"
    And the New item panel offers "Start"
    And the Documents screen looks like the baseline "671-documents.png"

  @issue-671 @visual
  Scenario: The editor shows the item's six stages, the contents, the toolbar and the writer panel
    Given the app is open in the dark theme
    And the demo project's repository has the item "Export runs as CSV" with an accepted intent
    When I open "Documents" in the sidebar
    And I choose "Write the spec" on the item "Export runs as CSV"
    Then the writer drafts the spec with the section "Requirements"
    And the document's stages are "Plan, Design, Build, Test, Deploy, Maintain" with "Design" open
    And the contents list "Requirements" and "Markdown source"
    And the toolbar offers the tabs "Edit", "Diff" and "Preview"
    And the toolbar switches the language between "EN" and "PT"
    And the toolbar offers "Versions" and "Send to review"
    And the writer panel offers "Apply now", "Queue" and "Attach image"
    And the editor looks like the baseline "671-editor.png"

  @issue-671 @visual
  Scenario: After the review, the sign-off gate shows the front matter to come and the next steps
    Given the app is open in the dark theme
    And the demo project's repository has the item "Export runs as CSV" with an accepted intent
    When I open "Documents" in the sidebar
    And I choose "Write the spec" on the item "Export runs as CSV"
    Then the writer drafts the spec with the section "Requirements"
    When I send the document to review
    Then the review shows its score out of 10
    And a review note offers "Apply", "Edit" and "Dismiss"
    And the sign-off panel is headed "Sign off required"
    And the sign-off panel shows the front matter after sign-off "status: draft → signed off"
    And the sign-off panel proposes "Create epic and phase issues" and "Start the Build"
    And the sign-off panel offers "Sign off spec", "Back to editing" and "Stop"
    And the sign-off panel looks like the baseline "671-signoff.png"
