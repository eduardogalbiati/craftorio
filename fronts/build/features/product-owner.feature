Feature: Backlog Product Owner
  The Product Owner's drawer (Backlog › Product Owner) on the demo project, answered by the
  simulated Product Owner (no model call). The simulated answer comes fast, so the steps watch the
  drawer while it works and check what it showed then.

  @issue-234
  Scenario: A suggested question locks the pills and Ask until the answer, the text field stays free
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I watch the Product Owner's drawer
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the suggested questions, "Register an issue" and Ask were disabled while the Product Owner worked
    And the text field stayed enabled while the Product Owner worked
    And the working line reading the "open issues" with its timer showed while the Product Owner worked
    And the suggested questions, "Register an issue" and Ask are enabled again
    And the working line is gone

  @issue-234
  Scenario: Asking a typed question shows it in view and locks Ask until the answer
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I watch the Product Owner's drawer
    And I ask the Product Owner "Which issues should go first?"
    Then the Product Owner answers
    And my question "Which issues should go first?" was in view in the conversation as soon as I asked
    And the suggested questions, "Register an issue" and Ask were disabled while the Product Owner worked
    And the suggested questions, "Register an issue" and Ask are enabled again

  # The simulated plan answer proposes to split the demo's big issue #15 (a long title, 12 tasks whose
  # text has `code` spans): its split card is the one checked
  @issue-242
  Scenario Outline: A split proposal fits in the Product Owner's drawer in a <window> window
    Given the app is open in a <size> window
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    And the split card of "Run safety: one app per workspace" fits within the drawer
    And the conversation does not scroll sideways
    And the task lines of the split card of "Run safety: one app per workspace" show no Markdown marks
    And the split card of "Run safety: one app per workspace" shows "Split" and "Edit…" inside it

    Examples:
      | window  | size     |
      | default | 1400x900 |
      | narrow  | 900x800  |

  # #609: the simulated plan answer proposes to split #15, to place #9 in the epic "Run reports" and to
  # create the epic "Ui" (#16, #10). Only the clicked proposal's button works (busy, disabled) while
  # its request is in flight; the other proposals stay clickable. The requests are held so they stay
  # in flight while the scenario checks.
  @issue-609
  Scenario: Placing issues in an epic leaves the other proposals clickable
    Given the app is open
    And applying the Product Owner's proposals takes a while
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    When I click "Place in epic" on the Product Owner's proposal for the epic "Run reports"
    Then "Place in epic" on the proposal for the epic "Run reports" shows it is working and cannot be clicked again
    And "Create epic" on the proposal for the new epic "Ui" can still be clicked
    And "Split" on the split card of "Run safety: one app per workspace" can still be clicked

  @issue-609
  Scenario: Splitting an issue leaves the epic proposals clickable
    Given the app is open
    And applying the Product Owner's proposals takes a while
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    When I click "Split" on the split card of "Run safety: one app per workspace"
    Then "Split" on the split card of "Run safety: one app per workspace" shows it is working and cannot be clicked again
    And "Place in epic" on the proposal for the epic "Run reports" can still be clicked
    And "Create epic" on the proposal for the new epic "Ui" can still be clicked

  @issue-609
  Scenario: While the Product Owner answers, its earlier proposals cannot be applied
    Given the app is open
    When I open "Backlog" in the sidebar
    And I open the Product Owner
    And I click the suggested question "Build a roadmap"
    Then the Product Owner answers
    And the Product Owner proposes to split "Run safety: one app per workspace"
    Given the Product Owner's next answer takes a while
    When I ask the Product Owner "Which issues should go first?"
    Then every split and epic button of the Product Owner's answer is disabled while it answers

  # #670: a signed-off spec's mockups (its images) reach the issues. "Create epic and phase issues" on
  # the item opens the Product Owner's proposal (one issue per phase of the spec), which first shows
  # which issue covers each mockup; a mockup in scope with no issue blocks the proposal, a mockup of a
  # later phase is listed as such. The spec's mockups and the phases naming them are seeded.
  @issue-670
  Scenario: Every mockup of the spec is covered by an issue and the proposal can go to the roadmap
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    And the proposal says no mockup is missing an issue
    And the proposal can be added to the roadmap

  @issue-670
  Scenario: A mockup in scope with no issue blocks the proposal
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
      | mock-4.jpg |         |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-3.jpg | Phase 2 |
    And the proposal says "mock-4.jpg has no issue"
    And the proposal cannot be added to the roadmap

  @issue-670
  Scenario: Mockups of a later phase are listed as later phases and do not block the proposal
    Given the app is open
    And the demo project's repository has the item "Export runs as CSV" with a signed-off spec and these mockups
      | mockup     | phase   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
      | mock-5.jpg | Later   |
    When I open "Documents" in the sidebar
    And I choose "Create epic and phase issues" on the item "Export runs as CSV"
    Then the Product Owner's proposal shows the mockup coverage
      | mockup     | issue   |
      | mock-1.jpg | Phase 1 |
      | mock-2.jpg | Phase 1 |
    And the proposal lists "mock-5.jpg" as a later phase
    And the proposal says no mockup is missing an issue
    And the proposal can be added to the roadmap

  # #785: the Product Owner deduces each recommendation. The drawer asks nothing up front (three
  # suggestions, the others behind "+ opções"; no Plan / Register toggle, no options block: #235's and
  # #431's scenarios went with them); a recommendation shows its workflow and inputs as grouped decisions,
  # each with where its value comes from, and "Editar" changes them before "Colocar no roadmap". An item
  # keeps only the inputs chosen, so the project's configuration reaches the run. The scenarios read the
  # sources as the issue words them, so the interface is in Portuguese; the inputs' labels and values
  # ("E2E tests", "Fork + PR") are the workflow's own, the same in both languages. The project is the
  # issue's: kind backend, variant fork-code, a Cargo.toml (test command "cargo test"), one open issue,
  # so the simulated plan has one recommendation.
  @issue-785
  Scenario: A backend fork project's plan goes to the roadmap with the project's values, marked "do projeto"
    Given the app is open
    And the workspace has a backend fork project "ai-memory" whose backlog has the open issue "Expor as métricas do cache"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I choose the project "ai-memory" in the header
    And I open the Product Owner
    And I click the suggested question "Analisar o backlog e propor runs"
    Then the Product Owner answers
    When I put the recommendation on the roadmap with "Colocar no roadmap"
    And I close the Product Owner
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Expor as métricas do cache"
    Then the item editor shows "Fork + PR" for "Mode", marked "do projeto"
    And the item editor shows "Off" for "E2E tests", marked "do projeto"
    And the item editor shows "Code first" for "Test order", marked "do projeto"
    And the item editor shows "Off" for "Screenshots", marked "do projeto"
    And the item editor shows "cargo test" for "Test command", marked "do projeto"

  @issue-785
  Scenario: The drawer offers three translated suggestions and "+ opções", with no toggle and no options before the answer
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I open the Product Owner
    Then the Product Owner suggests only "Analisar o backlog e propor runs", "Montar um roadmap" and "Registrar uma issue"
    And the Product Owner offers more suggestions behind "+ opções"
    And the Product Owner's drawer has no toggle between planning and registering an issue
    And the Product Owner's drawer shows no options before its answer
    When I open the Product Owner's other suggestions
    Then the Product Owner also suggests
      | suggestion                                   |
      | O que não deve rodar junto?                  |
      | Quais issues estão grandes ou pouco claras?  |
      | Quais issues são grandes demais para um run? |
      | Organizar as issues abertas em épicos        |

  @issue-785
  Scenario: A recommendation shows its decisions grouped, and Editar changes E2E tests before it goes on the roadmap, saving only that value
    Given the app is open
    And the workspace has a backend fork project "ai-memory" whose backlog has the open issue "Expor as métricas do cache"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Backlog" in the sidebar
    And I choose the project "ai-memory" in the header
    And I open the Product Owner
    And I click the suggested question "Analisar o backlog e propor runs"
    Then the Product Owner answers
    And the recommendation names the workflow "Feature"
    And the recommendation shows these decisions, with no input chips
      | group       | decision        | value     | source      |
      | How it runs | Mode            | Fork + PR | do projeto  |
      | Tests       | E2E tests       | Off       | do projeto  |
      | Tests       | Screenshots     | Off       | do projeto  |
      | Agents      | Developer model | Opus 5.5  | do workflow |
    And the recommendation does not show the decision "Test command"
    When I open "Mais" on the recommendation
    Then the recommendation's decision "Test command" shows "cargo test", marked "do projeto"
    When I open "Editar" on the recommendation
    Then "Off" is selected for "E2E tests"
    When I pick "Write" for "E2E tests"
    And I put the recommendation on the roadmap with "Colocar no roadmap"
    And I close the Product Owner
    And I open the Roadmap
    And I edit the inputs of the roadmap item "Expor as métricas do cache"
    Then the item editor shows "Write" for "E2E tests", marked "neste item"
    And the item editor shows "Fork + PR" for "Mode", marked "do projeto"
    And the item editor shows "Off" for "Screenshots", marked "do projeto"
