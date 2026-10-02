---
name: e2e-test-writer-python
description: Writes and runs end-to-end BDD scenarios (Given/When/Then) for Python projects with the framework the project already uses (pytest-bdd, behave, Robot Framework); default pytest-bdd (+ Playwright for Python for a web UI). Use to add acceptance scenarios for a change and report each one's result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, commands to run only the run's scenarios"
used_by: "test writer"
---

# E2E scenarios: Python

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Only this run's scenarios |
|---|---|---|---|
| `pytest-bdd` in the dependencies | pytest-bdd | `tests/features/` (or `bdd_features_base_dir`) | `pytest tests/e2e -m issue_<n>` |
| `behave` in the dependencies | behave | `features/` | `behave --tags=@issue-<n>` |
| `robotframework` in the dependencies | Robot Framework (Gherkin style) | `tests/` (`*.robot`) | `robot --include issue-<n> tests/` |

- **No E2E framework yet**: default to **pytest-bdd** (with `pytest-playwright` for a web UI),
  feature files in `tests/features/`, step modules in `tests/e2e/`. Record the assumption in
  `e2e_note` and add the packages to the project's dependency file (dev group).
- Use the project's environment manager (`uv run`, `poetry run`, the venv) as the unit tests do.
- Browsers: `playwright install chromium` only when the project uses Playwright; when it fails,
  the UI scenarios are `skipped` (environment).
- Always headless and non-interactive.

## Idioms

- Mark each scenario with its issue (`@issue-143` tag; pytest-bdd turns it into a marker,
  register it in the pytest config).
- Step functions with `parsers.parse` for parameters; shared state in fixtures (`target_fixture`),
  not globals.
- Servers and apps start in a session fixture and stop in its teardown (`yield`), on failure too.
- Screenshots: `page.screenshot(path=...)` into `evidence_dir` with the e2e-scenarios naming.
