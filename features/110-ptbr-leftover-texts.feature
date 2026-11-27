Feature: English texts left in the Portuguese interface
  With Settings › General › Language › Interface set to Português (Brasil), the Night watch screen, the
  Issues language and the first-run Setup's install hints still read in English (#110). They follow the
  interface language.

  # #110: the Night watch screen's heading (and its switch's name) read "Night watch", the checklist's
  # permissions come from the engine in English, the never-saved line reads "Defaults: retry and refresh
  # only." and the turn-on form's limits line "Runs keep each workflow's limits". The sidebar entry already
  # reads "Vigília noturna" (nav.nightwatch in packages/shared/i18n/pt-BR.json); the screen's title reads
  # the same. "shows none of these English texts:" is interface-language.steps.js's rule (a text of 12
  # characters or fewer counts only as an element's whole text). The demo seed writes no
  # night-permissions.json; the step that forgets it makes the defaults line certain.
  @issue-110
  Scenario: In Português (Brasil), the Night watch screen and its turn-on form show no English
    Given the app is open
    And the workspace never saved its "Night watch permissions"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    And I open "Vigília noturna" in the sidebar
    Then the open screen's title is "Vigília noturna"
    And the open screen shows none of these English texts:
      | Night watch                       |
      | Defaults: retry and refresh only. |
      | Retry a failed roadmap item       |
      | Skip an item                      |
      | Refresh issue text                |
      | Answer a human gate               |
      | Never allowed                     |
    When I start turning the Night watch on
    Then the open screen shows none of these English texts:
      | Runs keep each workflow's limits |
      | Night watch                      |

  # #110: while no Issues language was chosen (the demo workspace saves none), the Issues select shows the
  # interface's language, not English, and follows a change of the interface language (a default, not a
  # value written when the interface changed). The option may be the language itself or a default option
  # naming it ("Igual à interface (Português (Brasil))"), as the AI agents select does (#424).
  @issue-110
  Scenario: With no Issues language chosen, the Issues language follows the interface language
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then the "Issues" language resolves to "Português (Brasil)"
    When I choose "English" as the "Interface" language
    Then the "Issues" language resolves to "English"

  # #110: the install hints of a CLI without a one-line installer are prose from the engine
  # (packages/engine/domains/machine/install-commands.js): Grok Build's on every platform ("install Grok
  # Build from x.ai (it lands in ~/.grok/bin, which must be on the PATH)"), GitLab CLI's on Linux and on
  # macOS without Homebrew ("… the GitLab CLI …"). Both CLIs are missing on the simulated machine
  # (CRAFTORIO_E2E_CLI_MISSING); Claude Code is ready, so the AIs step goes on with Next.
  @issue-110
  Scenario: In Português (Brasil), the Setup's install hints for Grok Build and GitLab CLI show no English
    Given the app is open on a new workspace of a machine without "Grok Build" and "GitLab CLI"
    Then the first-run Setup is open on its "Connect your AIs" step
    When I choose "Português (Brasil)" as the Setup's language
    Then the Setup shows none of these English texts:
      | install Grok Build from x.ai |
      | which must be on the PATH    |
    When I go to the Setup's next step
    Then the first-run Setup is open on its "Version control" step
    And the Setup shows none of these English texts:
      | the GitLab CLI                 |
      | distribution's package manager |
      | Installing                     |
