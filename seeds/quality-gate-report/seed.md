---
name: quality-gate-report
summary: The project's own quality gate explained, check by check, with where the project stands on each
needs:
  - the project's lint, test, coverage and CI configuration files
  - git history of those files
produces:
  - html
  - json
cost: one Oracle turn (reads the gate's configuration, runs nothing)
---

# Quality gate report

Adapted from `qualityGateReport` in Kent Beck's ToolSeeds (https://github.com/KentBeck/ToolSeeds, MIT).

Every project has a quality gate, written down or not: what has to pass before a change is merged.
Find it, explain each check in plain words, and show where the project stands on it.

## What it produces

- A self-contained HTML page: one row per check of the gate (what it checks, where it is
  configured, whether it blocks a merge, its threshold, the latest known result), grouped by kind
  (format, lint, types, tests, coverage, size, security, other), then the gaps.
- A JSON model: `{ checks: [{ id, kind, source, blocking, threshold, lastResult }], gaps: [{ kind,
  why }] }`, keys sorted, checks sorted by kind then id.

## Data

- Read the gate from the project's files: the CI configuration, the package manifest's scripts, the
  linters' and formatters' configs, test runner configs, coverage thresholds, pre-commit hooks,
  branch rules documented in the repository. Each check names the file and line it comes from.
- `blocking`: true when the CI fails or a hook refuses on it; false for a report-only check.
- `lastResult`: from the CI's latest run on the default branch when the project's CLI can read it,
  else `unknown`. Run nothing yourself: this seed is read-only.
- A gap is a kind of check the project has none of (no type check, no coverage threshold): say why
  it would matter for this project, in one line.

## Layout and interaction

- The checks lead, blocking ones first in each group; the gaps follow. Each row says in one line
  what the check protects. Inline CSS only, no external resource.

## VERIFY

1. For each blocking check, open the file and line it names: the check is there.
2. Pick one threshold (coverage, a size limit) and read its value in the config.
3. Pick one gap and search the repository for a check of that kind: there is none.

When you are done, tell me:
- the number of checks, how many block a merge, and the gaps;
- the strictest check and the weakest blocking one;
- each check whose source you could not confirm;
- what you assumed.
