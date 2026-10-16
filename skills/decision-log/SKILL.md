---
name: decision-log
description: Keeps an audit trail of the non-obvious decisions an unattended agent makes - each answer ends with a decisions block that the orchestrator appends to the run's decisions.tsv. Use in long or unattended work where a human reviews the result later.
summary: "Agents end answers with a ```` ```decisions ```` block; the engine appends it to `<run>/decisions.tsv`"
used_by: "developer, PR babysitter"
---

# Decision log

Adapted from show-me-your-work in cursor/plugins pstack (MIT). Nobody watches you work; the
log is how a human later understands **why** the result looks the way it does.

## What to log

A decision is worth a line when a reasonable engineer could have chosen differently:
- an assumption made instead of asking (ambiguous requirement, missing information);
- choosing between approaches (library, algorithm, where to put the code, merge vs rebase);
- skipping something on purpose (a test, a check, a comment not addressed);
- a workaround, a retry, or a change of plan after a failure.

Do not log routine steps (ran the tests, read a file) or anything obvious from the diff.

## How to log

End your answer with one block (before any required JSON block), one line per decision,
five fields separated by ` | `, written in the language the Language line names (English when
there is none) whatever language the project instructions or the conversation use:

```decisions
phase | decision | why | evidence | result
```

- **phase**: short label (`plan`, `implement`, `test`, `fix`, `ci`, `review`...).
- **decision**: what you chose, in a few words.
- **why**: the reason, including the alternative you rejected.
- **evidence**: what you based it on (file, command output, doc) — no secrets.
- **result**: what happened (`ok`, `tests pass`, `reverted`, `pending`).

Example:

```decisions
implement | kept retries in the HTTP client, not the caller | three callers need the same policy; per-caller retries rejected | src/http/client.ts already wraps fetch | tests pass
fix | skipped the flaky e2e test in the local run only | fails on main too (CI run 4812) | gh run view 4812 | pending
```

No block when there was no decision worth logging this turn. The orchestrator stamps each line
with the time, agent and step and appends it to `decisions.tsv` in the run folder.
