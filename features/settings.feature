Feature: Settings
  Settings save as soon as a choice is made, and the choice survives a reload.

  # #759: since #630 software-development.yaml is only an alias of feature.yaml, so the select offers
  # feature.yaml (the bundled catalog) and never the old name
  @issue-222 @issue-195 @issue-759 @smoke
  Scenario: Settings saves the default development workflow
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "feature.yaml" as the default development workflow
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the default development workflow is "feature.yaml"

  # Assumes Settings gets a "Phone gates" tab holding the phone gates section (#226)
  @issue-226
  Scenario: Settings shows a pairing code and a QR code for the phone gates page, with the setup steps
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Phone gates" settings tab
    And I ask for a code to pair a phone
    Then the phone gates section shows a pairing code
    And the phone gates section shows a QR code to pair a phone
    And the phone gates section lists the steps to reach the gates page from the phone
    And the steps give the gates page's address

  @issue-226
  Scenario: The paired devices list says when no phone is paired yet
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Phone gates" settings tab
    Then the phone gates section lists the paired devices
    And the paired devices list says no phone is paired yet

  # Assumes Settings › Execution gets a "Memory guard" group under "Concurrent runs" (#276)
  @issue-276
  Scenario: The memory guard is on by default, with its limit in GB for this machine
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard is on
    And the memory guard's limit is 25
    And the memory guard's floor is 10
    And the memory guard's hint gives its limit in GB for this machine

  @issue-276
  Scenario: A new memory guard limit is kept after the app reloads
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I set the memory guard's limit to 30
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard's limit is 30

  @issue-276
  Scenario: A memory guard limit out of range shows an error and is not saved
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I set the memory guard's limit to 95
    Then the memory guard's limit field shows an error
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the memory guard's limit is 25

  # Settings › Execution › Concurrent runs shows this machine's profile (#367); the CI machine varies,
  # so the scenarios check the line's shape, never its numbers
  @issue-367
  Scenario: Concurrent runs sizes the runs and test workers from this machine, in auto state
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then Concurrent runs shows this machine's threads and memory, with the runs and test workers it allows
    And the machine profile is in auto state
    And the machine profile offers "Use these values"
    And the machine profile does not offer "back to auto"

  @issue-367
  Scenario: A manual maximum wins over the machine profile until I go back to auto
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I set the maximum concurrent runs to 3
    Then the machine profile is in manual state
    And the machine profile offers "back to auto"
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the maximum concurrent runs is 3
    And the machine profile is in manual state
    When I go back to auto in the machine profile
    Then the machine profile is in auto state
    And the machine profile does not offer "back to auto"

  @issue-367
  Scenario: "Use these values" fills the maximum concurrent runs from the machine profile
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    And I use the machine profile's values
    Then the maximum concurrent runs is the machine profile's runs at once

  # Assumes Settings › General gets a "Time zone" select (data-testid="settings-time-zone") of IANA
  # zones, the computer's zone until one is chosen, saved as `timeZone` in the workspace's settings (#273)
  @issue-273
  Scenario: The time zone is the computer's until another is chosen, and the choice is kept
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the time zone is the computer's time zone
    And the time zone list offers "Asia/Tokyo"
    And the time zone list offers "America/Sao_Paulo"
    When I choose the time zone "Asia/Tokyo"
    Then the workspace settings keep the time zone "Asia/Tokyo"
    When I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the time zone is "Asia/Tokyo"

  # A run started at 01:14 UTC: 22:14 in São Paulo (UTC-3), 10:14 in Tokyo (UTC+9). The run list's
  # "started" time is data-testid="run-list-started" in its row (#273)
  @issue-273
  Scenario: The run list shows a run's start time in the chosen time zone
    Given the app is open
    And the demo workspace gains a finished run "tzr00273" started at "01:14" UTC three days ago
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose the time zone "America/Sao_Paulo"
    And I open "Runs" in the sidebar
    And I search the runs for "tzr00273"
    Then the run "tzr00273" shows it started at "22:14"
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose the time zone "Asia/Tokyo"
    And I open "Runs" in the sidebar
    And I search the runs for "tzr00273"
    Then the run "tzr00273" shows it started at "10:14"

  # "With the zone in tooltips where it matters": the run list's start time names the zone it is in
  @issue-273
  Scenario: A run's start time says which time zone it is in
    Given the app is open
    And the demo workspace gains a finished run "tzt00273" started at "01:14" UTC three days ago
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose the time zone "Asia/Tokyo"
    And I open "Runs" in the sidebar
    And I search the runs for "tzt00273"
    Then the run "tzt00273" shows it started at "10:14"
    And the run "tzt00273"'s start time names the time zone "Asia/Tokyo" in its tooltip

  # #383: a design-system select with more than 10 options opens a list with a search box
  # (data-testid="select-search", role="searchbox"); typing filters the listed options (role="option")
  @issue-383
  Scenario: The time zone list has a search box that narrows the zones offered
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I search the time zone list for "Tokyo"
    Then the time zone list shows "Asia/Tokyo"
    And the time zone list hides "Europe/London"

  # Assumes Settings › General gets a "Language" group (data-testid="settings-language") next to Time
  # zone, holding an "AI agents" select (aria-label "AI agents", saved as language.agents in the
  # workspace's settings) (#327). Since #424 its default option names the language it resolves to:
  # "Same as the interface (English)" in E2E.
  @issue-327
  Scenario: The AI agents language is the interface's until another is chosen, from the list of languages
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the General settings show a "Language" group
    And the "AI agents" language is "Same as the interface (English)"
    And the "AI agents" language list offers "Same as the interface (English), English, Português (Brasil), Español, Français, Deutsch, Italiano, 日本語, 中文, 한국어"

  @issue-327
  Scenario: A language chosen for the AI agents is kept after the app reloads
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "AI agents" language
    And I open "Runs" in the sidebar
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the "AI agents" language is "Português (Brasil)"

  # The same group gets an "Issues" select (aria-label "Issues", saved as language.issues), its help
  # text tied to it with aria-describedby (#328)
  @issue-328
  Scenario: The Issues language is English by default, and its help names issues, PR descriptions and commit messages
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the "Issues" language is "English"
    And the "Issues" language list offers "English, Português (Brasil), Español, Français, Deutsch, Italiano, 日本語, 中文, 한국어"
    And the "Issues" language's help names issues, PR/MR descriptions and commit messages

  @issue-328
  Scenario: A language chosen for issues is kept after the app reloads
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Español" as the "Issues" language
    And I open "Runs" in the sidebar
    And I reload the app
    And I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the "Issues" language is "Español"

  # #329: the same group gets an "Interface" select (aria-label "Interface", the same in both
  # catalogs) listing the languages with a catalog. E2E runs in English (the computer's language is
  # not read in E2E, or is English). A change re-renders the window at once: no reload between the
  # choice and the checks. Portuguese labels: Settings → "Configurações", General → "Geral"
  @issue-329
  Scenario: The Interface language is English in E2E, from the languages that have a catalog
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    Then the "Interface" language is "English"
    And the "Interface" language list offers "English, Português (Brasil)"

  @issue-329
  Scenario: Choosing Português (Brasil) for the interface translates the sidebar and Settings at once, and is kept
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then the sidebar offers "Configurações"
    And the sidebar no longer offers "Settings"
    And Settings offers the "Geral" tab
    And Settings no longer offers the "General" tab
    When I reload the app
    And I open "Configurações" in the sidebar
    Then Settings offers the "Geral" tab
    And the "Interface" language is "Português (Brasil)"

  @issue-329
  Scenario: Switching the interface back to English restores the English text at once
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then Settings offers the "Geral" tab
    When I choose "English" as the "Interface" language
    Then the sidebar offers "Settings"
    And the sidebar no longer offers "Configurações"
    And Settings offers the "General" tab
    And Settings no longer offers the "Geral" tab
    And the "Interface" language is "English"

  # #424: the AI agents' "Same as the interface" option names the language it resolves to, in the
  # interface language ("Igual à interface (Português (Brasil))"); the select's name and the option's
  # words are read from the catalogs (features/steps/interface-language.steps.js), the language's name
  # is written as is. It follows a change of the interface language at once, without a reload.
  @issue-424
  Scenario: With Português (Brasil) as the interface, the AI agents' default option names Português (Brasil)
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then the "AI agents" language reads "Same as the interface" naming "Português (Brasil)", in "Português (Brasil)"

  @issue-424
  Scenario: Switching the interface back to English, the AI agents' default option names English at once
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "General" settings tab
    And I choose "Português (Brasil)" as the "Interface" language
    Then the "AI agents" language reads "Same as the interface" naming "Português (Brasil)", in "Português (Brasil)"
    When I choose "English" as the "Interface" language
    Then the "AI agents" language reads "Same as the interface" naming "English", in "English"
    And the "AI agents" language is "Same as the interface (English)"

  # #405: Settings › Execution's red-base choice (data-testid="base-check-on-red"), setting baseCheck.onRed
  @issue-405
  Scenario: Settings › Execution offers what happens when the base goes red, issue + fix item by default
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "Execution" settings tab
    Then the red-base choice offers "Off", "Issue only" and "Issue + fix item", with "Issue + fix item" selected

  # #476 (SEC-11): the Linux AppImage's launcher starts the app without Chromium's sandbox when the
  # system forbids it, and then sets MULTIAGENT_NO_SANDBOX=1 (the scenario sets it as the launcher
  # would). Assumes Settings › About gets data-testid="settings-sandbox-warning": that the app runs
  # without the sandbox, with the documented alternative, the sysctl
  # kernel.apparmor_restrict_unprivileged_userns=0 (README, Install on Linux)
  @issue-476
  Scenario: Started without the Chromium sandbox, Settings › About warns and gives the alternative
    Given the app was started without the Chromium sandbox
    When I open "Settings" in the sidebar
    And I open the "About" settings tab
    Then Settings warns that the app runs without the sandbox
    And the sandbox warning mentions "kernel.apparmor_restrict_unprivileged_userns=0"

  @issue-476
  Scenario: Started normally, Settings › About shows no sandbox warning
    Given the app is open
    When I open "Settings" in the sidebar
    And I open the "About" settings tab
    Then Settings shows no sandbox warning
