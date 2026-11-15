Feature: Text fits in narrow panels
  At the window's minimum size, in English and in Portuguese (Brasil), text stays inside its card: a
  long value ends in "…" with the whole text in its tooltip, a long sentence wraps, buttons wrap. A
  status pill never wraps; the title next to it gives way instead.

  # #443: the Run screen's side column (data-testid run-side-column, NEW) holds the suite card
  # (run-suite-card): its step name, its scope badge ("Only the affected tests" / "Só os testes
  # afetados"), each test file path (run-suite-file, NEW) with the reason it ran. The run "-nar00443"
  # is seeded finished (features/steps/narrow-panels.steps.js): its suite ran only the affected test
  # files, three of them with long paths and long reasons. "Passes the edge of its card" = a text's
  # visible part reaches past the nearest card (or the column), or is cut by its box without "…"; a
  # text cut with "…" must carry its whole text in a tooltip. The scratch workspace line is not
  # checked: the seeded run has no scratch workspace.
  @issue-443
  Scenario Outline: In <language>, the suite card keeps its text inside the run's side column at the minimum window size
    Given the app is open in "<language>" at its minimum window size
    And the demo project has a finished AI Development run "nar00443" whose suite ran only affected test files with long paths
    When I open the run "nar00443" from the runs list
    Then no text in the run's side column passes the edge of its card
    And the suite card's test file paths end in "…" with the whole path in their tooltip

    Examples:
      | language           |
      | Português (Brasil) |
      | English            |

  # #443: a gate card (data-testid run-gate) at the minimum window size: its summary, message and
  # choice buttons stay inside it (the buttons wrap). The Start panel's steps read English labels.
  @issue-443 @quarantine
  Scenario: A gate card keeps its text and buttons inside it at the minimum window size
    Given the app is open in "English" at its minimum window size
    When I start a simulated run with the task "Add a /health endpoint that reports the database, the queue, the cache and the mail relay, each with its latency and last error"
    Then a gate card waits for my approval
    And no text in the gate card passes its edge

  # #437: the run list's rows (Workflows › Runs) at the minimum window size. A pill (the status label,
  # data-testid status-label) stays on one line and shows its whole label; the run's title next to it
  # (data-testid run-title-text, NEW) ends in "…" with the whole title in its tooltip. The run
  # "-pil00437" is seeded finished with a task too long for its row.
  @issue-437
  Scenario Outline: In <language>, the run list's status pills stay on one line and long titles end in "…"
    Given the app is open in "<language>" at its minimum window size
    And the demo project has a finished AI Development run "pil00437" whose title is too long for its row
    When I open the runs list
    Then every status pill on the run list stays on one line, whole
    When I search the runs list for "pil00437"
    Then the title of the run list row of "pil00437" ends in "…" with the whole title in its tooltip
    And every status pill on the run list stays on one line, whole

    Examples:
      | language           |
      | Português (Brasil) |
      | English            |

  # #437: short Portuguese labels. "The status pills read" asks the app (window.StatusPill.statusLabel)
  # for the label of each status, named by its English label; a run waiting at a human gate reads
  # "Waiting for you". The demo run "-run00233" succeeded (fronts/build/features/workflow-runs.feature).
  @issue-437
  Scenario: In Português (Brasil), the status pills use short labels
    Given the app is open in "Português (Brasil)" at its minimum window size
    When I open the runs list
    Then the run list row of "run00233" shows the status "Sucesso" with the id "success"
    And the status pills read
      | status           | label          |
      | Running          | Rodando        |
      | Succeeded        | Sucesso        |
      | Waiting for you  | Esperando você |
      | Merged locally   | Mesclado       |
      | Parked at a gate | Parado no gate |
    And every status pill on the run list stays on one line, whole
