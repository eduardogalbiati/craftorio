---
name: e2e-test-writer-python
description: Writes end-to-end BDD scenarios (Given/When/Then) for Python projects with the framework the project already uses (pytest-bdd, behave, Robot Framework); default pytest-bdd (+ Playwright for Python for a web UI). Development runs write them and check that they parse (pending, run at release); the E2E release workflow runs the whole suite and reports each result.
uses: [e2e-scenarios, long-commands]
summary: "E2E/BDD framework detection, feature folder, the parse check of a development run and the release run's commands"
used_by: "test writer, E2E runner"
---

# E2E scenarios: Python

**Test workers (#367)**: a run gets `CRAFTORIO_TEST_WORKERS` (and `CRAFTORIO_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`CRAFTORIO_TEST_WORKERS=<n>`) and pass the number to the runner you call: pytest-xdist `-n <n>` (only when pytest-xdist is installed).
Unset: leave the runner's default.

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Feature folder | Release run (one file, or by tag) |
|---|---|---|---|
| `pytest-bdd` in the dependencies | pytest-bdd | `tests/features/` (or `bdd_features_base_dir`) | `pytest tests/e2e -m issue_<n>` |
| `behave` in the dependencies | behave | `features/` | `behave --tags=@issue-<n>` |
| `robotframework` in the dependencies | Robot Framework (Gherkin style) | `tests/` (`*.robot`) | `robot --include issue-<n> tests/` |

- **Development run**: write the scenarios and check that they parse, never run them (no app,
  no browser): behave `behave --dry-run --tags=@issue-<n>` · pytest-bdd `pytest tests/e2e -m issue_<n> --collect-only -q` · Robot `robot --dryrun --include issue-<n> tests/`. Each is reported `pending`; the E2E release workflow runs the suite.
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
