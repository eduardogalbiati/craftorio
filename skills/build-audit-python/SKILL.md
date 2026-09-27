---
name: build-audit-python
description: Builds or checks a Python project and audits its dependencies for vulnerabilities, separating production from development (pip-audit, osv-scanner; uv, poetry, pip). Use to check whether a Python project builds and has vulnerable dependencies.
uses: [dependency-audit-policy]
---

# Build and audit: Python

## Environment

`uv.lock` → `uv sync` / prefix `uv run` · `poetry.lock` → `poetry install` / `poetry run` ·
`requirements*.txt` → `python -m pip install -r requirements.txt` in a venv. Never change the lock.

## Build

1. Install the dependencies (above). A resolution/installation failure is `build_status: failed`.
2. Package with `[build-system]` in `pyproject.toml`: `python -m build` (or `uv build`).
3. Application without packaging: `python -m compileall -q <src>` for syntax errors and, if the project configures one, the type checker (`mypy`/`pyright`). Django: `python manage.py check --deploy`.

## Audit

Separate the scopes into temporary files (delete them at the end):
- uv: `uv export --no-dev --format requirements-txt > req-prod.txt` and `uv export --format requirements-txt > req-all.txt`
- poetry: `poetry export --only main -f requirements.txt -o req-prod.txt` and `poetry export --with dev -f requirements.txt -o req-all.txt`
- requirements files: `requirements.txt` is production; `requirements-dev.txt`/`dev-requirements.txt` is development.

Tools, first one installed wins:
1. `osv-scanner --format json -L req-prod.txt` (and `req-all.txt`): includes CVSS severity.
2. `pip-audit -r req-prod.txt --format json` (and `req-all.txt`): no severity; classify with the policy's CVSS table using the advisory aliases.

Fix: the `fix_versions` from the report and where to change it (pyproject/requirements), or which direct dependency must be upgraded for a transitive one.
