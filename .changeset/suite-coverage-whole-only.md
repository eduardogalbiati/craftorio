---
"@craftorio/engine": patch
---

A suite step with `coverage: true` measures coverage only when it runs the whole suite: its rounds of selected files
(affected, failed first, listed) run without it, and the coverage report is the last whole run's.
