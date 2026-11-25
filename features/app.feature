@issue-222
Feature: The app opens
  The packaged app's first screen, on a fresh demo workspace in simulation.

  @smoke
  Scenario: The app opens with its sidebar and nothing running
    Given the app is open
    Then the sidebar offers "Home"
    And the sidebar offers "Backlog"
    And the sidebar offers "Runs"
    And the sidebar offers "Settings"
    And the run status shows "idle"
    And the Start a workflow button is enabled

  # #279: Self-healing writes <workspace>/oracle/app-update.json before it applies merged fixes to the
  # app; still there more than 2 minutes later, the new code did not start. Assumption: the app checks
  # it when its window loads (so a reload stands for the next start).
  @issue-279
  Scenario: A failed app update leaves a banner with the command to go back, kept until dismissed
    Given the app is open
    And an app update from "febef8b" to "5d9be33" was started 10 minutes ago without finishing
    Then a banner says the app update to "5d9be33" did not start
    And the banner gives the command to go back to "febef8b"
    When I reload the app
    Then a banner says the app update to "5d9be33" did not start
    When I dismiss the failed app update banner
    Then no failed app update banner shows
    When I reload the app
    Then no failed app update banner shows

  # #389: the app froze for minutes at startup. Home draws from the index before any slow read, and
  # the app answers right away. Assumption: "promptly" is 3 seconds from the window's page loading
  # (the launch of Electron itself is not counted).
  @issue-389
  Scenario: Home is shown promptly when the app opens and I can move on at once
    Given the app is open
    Then Home shows its overview within 3 seconds
    And Home is on its "Overview" tab
    When I open "Backlog" in the sidebar
    Then the Backlog screen is shown within 3 seconds

  # #389: the usage widget and the 24/7 chip load after the first paint, with a loading state meanwhile.
  # Assumption: the loading state is aria-busy="true" on the widget; with the demo workspace's data the
  # loading may already be over when it is checked, so the first check accepts either state.
  @issue-389
  Scenario: The usage widget and the 24/7 chip load after Home, showing a loading state meanwhile
    Given the app is open
    Then Home shows its overview within 3 seconds
    And the top bar's "usage widget" shows that it is loading or its figures
    And the top bar's "24/7 chip" shows that it is loading or its figures
    And the top bar's "usage widget" then shows its figures
    And the top bar's "24/7 chip" then shows its figures

  # #466: a file dropped anywhere outside the two drop boxes (the Backlog's Product Owner drop box, the
  # Inbox's) no longer opens in the window in place of the app. Assumption: the app refuses such a drop
  # (dragover and drop default-prevented); a drop Playwright dispatches is untrusted and never navigates
  # by itself, so the refusal is what the scenario checks, with the page.
  @issue-466
  Scenario: A file dropped outside the drop boxes does not replace the app
    Given the app is open
    When I drop an HTML file onto the Home screen, outside any drop box
    Then the window refuses the dropped file
    And the app is still on its own page
    And the sidebar offers "Backlog"

  # #76: starting the app warned of a listener leak (more than 10 listeners of run:event, one per part of the app
  # that follows the runs). The log is recorded by features/support/electron-main.js.
  @issue-76
  Scenario: Starting the app writes no listener leak warning in its log
    Given the app is open
    Then the sidebar offers "Home"
    And the app's log has no listener leak warning
