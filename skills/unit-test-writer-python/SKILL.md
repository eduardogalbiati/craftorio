---
name: unit-test-writer-python
description: Writes, updates and runs unit tests for Python with the framework the project already uses (pytest, unittest, pytest-django). Use to add tests for a change or run the suite of a Python project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Python

**Test workers (#367)**: a run gets `MULTIAGENT_TEST_WORKERS` (and `MULTIAGENT_E2E_WORKERS`) in its
environment, the workers this machine gives each run so parallel runs do not overload it. Read it
from the variables line of the command guide (`MULTIAGENT_TEST_WORKERS=<n>`) and pass the number to the runner you call: pytest-xdist `-n <n>` (only when pytest-xdist is installed).
Unset: leave the runner's default.

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Whole suite | One test |
|---|---|---|---|
| `pytest` in deps, `[tool.pytest.ini_options]`, `pytest.ini`, `conftest.py` | pytest | `python -m pytest -q` | `python -m pytest tests/test_x.py::test_y -q` |
| only `unittest.TestCase` | unittest | `python -m unittest discover -v` | `python -m unittest tests.test_x.Class.test_y` |
| Django with `pytest-django` | pytest | `python -m pytest -q` | as pytest |
| Django without pytest | Django | `python manage.py test` | `python manage.py test app.tests.Class.test_y` |

- Run only the tests you write (the "One test" column); the whole suite is the orchestrator's when
  the workflow has a suite step (see testing-principles: time budget).
- Which tests and how to read them: the code → tests map when the project has one, and
  failures-only output (`pytest -q --tb=short -rf`, read the `FAILED` lines), never the whole log
  (testing-principles: the code → tests map, agent mode).
- Environment from the lockfile: `uv.lock` → prefix `uv run`; `poetry.lock` → `poetry run`; otherwise the active venv (`python -m ...`).
- No framework yet: pytest.
- Dependencies first: a fresh checkout (each run has its own worktree) has no environment.
  When it is missing or the lockfile changed: `uv sync` · `poetry install` · otherwise
  `python -m pip install -r requirements.txt` (plus the dev requirements file) in a venv.

## Running the tests: timeouts and turns

- Pass the Bash tool's `timeout` on **every** test or build command (e.g. `timeout: 300000` for
  one focused file in this orchestrator, the suite's budget for the whole suite), never the default
  120 s: a command cut there returns no result and the turn is lost (long-commands). Never start a
  test command in the background and wait for its log in a loop: run it in the foreground.
- Measure your first focused run (the runner's duration line). A file that takes more than a
  minute is a slow file: from then on run it with a narrower filter (`pytest <path>::<test>`, `-k "<name>"`, one file),
  at most once per round; a command that may take longer than the tool's maximum goes to the
  orchestrator's suite step or runs with a narrower filter.
- Fewer, bigger turns: write all the tests of a behaviour in one edit, then run them once; never
  one assertion per edit-and-run cycle. Each turn re-reads your whole context.

## Idioms

- Follow the existing layout (`tests/` mirroring the package, `test_*.py`) and the style of neighbouring tests.
- `@pytest.mark.parametrize` for variations of one behaviour instead of copied tests.
- Expected errors: `with pytest.raises(ValueError, match="..."):`.
- Fixtures for setup, `function` scope by default; files with `tmp_path`; env with `monkeypatch.setenv`.
- `mock.patch` the name **where it is used** (`app.service.requests.get`), not where it is defined.
- HTTP boundaries: `responses`/`respx`/`pytest-httpx` if the project has them; never the real network.
- Time: `freezegun`/`time-machine` if available, or inject the clock.
- Async: `pytest-asyncio` (`@pytest.mark.asyncio`) or `anyio`, as the project does.
- Django database: `@pytest.mark.django_db` / `TestCase`; never depend on another test's data.

## Coverage (only when asked)

`python -m pytest --cov=<package> --cov-report=term-missing`
