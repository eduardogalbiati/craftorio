---
name: unit-test-writer-python
description: Writes, updates and runs unit tests for Python with the framework the project already uses (pytest, unittest, pytest-django). Use to add tests for a change or run the suite of a Python project.
uses: [testing-principles, long-commands]
summary: "Framework detection, commands, idioms per language"
used_by: "test writer"
---

# Unit tests: Python

## Framework and commands (never switch frameworks)

| Signal in the repository | Framework | Whole suite | One test |
|---|---|---|---|
| `pytest` in deps, `[tool.pytest.ini_options]`, `pytest.ini`, `conftest.py` | pytest | `python -m pytest -q` | `python -m pytest tests/test_x.py::test_y -q` |
| only `unittest.TestCase` | unittest | `python -m unittest discover -v` | `python -m unittest tests.test_x.Class.test_y` |
| Django with `pytest-django` | pytest | `python -m pytest -q` | as pytest |
| Django without pytest | Django | `python manage.py test` | `python manage.py test app.tests.Class.test_y` |

- Environment from the lockfile: `uv.lock` → prefix `uv run`; `poetry.lock` → `poetry run`; otherwise the active venv (`python -m ...`).
- No framework yet: pytest.
- Dependencies first: a fresh checkout (each run has its own worktree) has no environment.
  When it is missing or the lockfile changed: `uv sync` · `poetry install` · otherwise
  `python -m pip install -r requirements.txt` (plus the dev requirements file) in a venv.

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
