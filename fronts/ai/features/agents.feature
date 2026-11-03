Feature: Agents, how the agents look
  The Agents screen (AI › Agents) lists the user's agents, the built-in ones and, one section per
  workflow, the workflows' own agents. A workflow's agent is read-only there except for its look:
  its card's "Customize look" opens the agent editor with a large robot preview. An agent whose
  look was never customised draws its provider's robot painted in its role's colour (the agent's
  `color` in the workflow YAML), so two agents of the same provider tell apart.

  # Assumes the demo workspace has the bundled workflow feature (#777: features/support/workflows.js), whose agents
  # "Developer" (developer, #4C7DFF) and "Reviewer" (reviewer, #A06BFF) both run on claude and
  # were never customised.
  @issue-297
  Scenario: "Customize look" opens a workflow agent's editor with a full-size robot preview
    Given the app is open in a 1400x900 window
    When I open "Agents" in the sidebar
    Then the workflow agent "developer" of "feature.yaml" offers "Customize look" and not "View"
    When I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    Then the agent editor is titled "Developer · feature"
    And the agent editor's robot preview is 280x280 pixels
    And the agent editor's prompt is read-only

  # The Analytics Agents tab's cards and the agent editor once shared a CSS class: the editor's
  # 280 px preview must not grow the cards' small robots
  @issue-297
  Scenario: The Analytics Agents tab keeps its small robots on the cards
    Given the app is open in a 1400x900 window
    When I open "Agents" in the sidebar
    And I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    And I close the agent editor
    And I open the "Analytics" tab of Home
    And I open the "Agents" Analytics tab
    Then the robots of the Analytics agent cards "Oracle", "Product Owner" and "Supervisor" are 44x44 pixels

  @issue-297
  Scenario: Two uncustomised workflow agents of the same provider are painted in their role colours
    Given the app is open
    When I open "Agents" in the sidebar
    Then the card robot of the workflow agent "developer" of "feature.yaml" is painted "#4C7DFF"
    And the card robot of the workflow agent "reviewer" of "feature.yaml" is painted "#A06BFF"
    And the card robots of the workflow agents "developer" and "reviewer" of "feature.yaml" look different

  # #309: each colour row of the editor (Main color, Shell, Visor, Glow) takes any colour typed as a
  # hex (#RRGGBB) in its field, next to the preset swatches and the "+" picker: the custom swatch is
  # selected, the field shows the hex in upper case, the preview is painted with it, and Save keeps
  # it. Assumes the uncustomised "Developer" of feature (role colour #4C7DFF).
  @issue-309
  Scenario: A hex typed in the Main color field paints the preview and survives Save
    Given the app is open in a 1400x900 window
    When I open "Agents" in the sidebar
    And I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    And I type "#1a2b3c" in the "Main color" colour field
    Then the "Main color" colour field shows "#1A2B3C"
    And the "Main color" custom colour swatch is selected
    And the agent editor's robot preview is painted "#1A2B3C"
    When I save the agent editor
    And I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    Then the "Main color" colour field shows "#1A2B3C"
    And the "Main color" custom colour swatch is selected

  @issue-309
  Scenario: An invalid hex warns and keeps the previous colour
    Given the app is open in a 1400x900 window
    When I open "Agents" in the sidebar
    And I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    Then the agent editor's robot preview is painted "#4C7DFF"
    When I type "#GG00ZZ" in the "Main color" colour field
    Then the "Main color" colour field warns
    And the agent editor's robot preview is painted "#4C7DFF"

  # The look modal with a custom colour, in both themes (features/__screenshots__, created on purpose
  # with npm run test:e2e:update -- --grep @visual)
  @issue-309 @visual
  Scenario Outline: The look modal with a custom colour looks like its baseline in the <theme> theme
    Given the app is open in the <theme> theme
    When I open "Agents" in the sidebar
    And I click "Customize look" on the workflow agent "developer" of "feature.yaml"
    And I type "#1A2B3C" in the "Main color" colour field
    Then the "Main color" custom colour swatch is selected
    And the look modal looks like the baseline "agent-look-modal-custom-<theme>.png"

    Examples:
      | theme |
      | light |
      | dark  |
