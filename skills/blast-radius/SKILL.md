---
name: blast-radius
description: Finds what a change can break outside its own diff - callers, consumers of changed contracts, config and data, other services - identifies the single most important safety fact and proves it by running code, reporting the evidence level. Use before merging a change, alongside code review.
---

# Blast radius

Adapted from the blast-radius skill in cursor/plugins pstack (MIT). Code review looks inside
the diff; this looks at everything the diff touches from the outside. Read-only on the
repository: write scratch scripts only in a temporary folder.

## 1. Inventory what changed at the boundaries

From `git diff <base>...<branch>`, list every changed:
- exported function, class, type or its signature/behaviour;
- HTTP/RPC route, request/response shape, status codes, event or message format;
- database schema, migration, stored data format, cache key;
- configuration: environment variables, feature flags, ports, file paths, secrets names;
- CLI flags, file formats, public constants, default values;
- dependency versions.

## 2. Find the consumers

For each item, search the repository (and sibling repos in the workspace, if present):
`git grep -n "<name>"`, imports, route strings, config keys, migration references,
test fixtures. Note consumers that are **not** updated in the diff.
Outside the repository (other services, clients, dashboards): name them as unknowns, do not guess.

## 3. Pick the safety fact

The one statement that, if false, causes the worst damage. Examples:
"existing rows with `status = NULL` still load after the migration",
"clients sending the old payload still get 200", "the job is idempotent when retried".

## 4. Prove it, as high on the ladder as you can

| Level | Evidence |
|---|---|
| 0 | someone said so (PR description, comment) |
| 1 | read the code and reasoned about it |
| 2 | an existing test covers exactly this case and passes |
| 3 | you wrote and ran a scratch script/test that exercises it |
| 4 | reproduced against the running app or a real copy of the data format |

Aim for level 3 or 4. If you cannot run it (needs a real service or credentials), stop at the
highest level you reached and say what would raise it.

## Report

```
Safety fact: <statement>
Evidence: level <n> — <command and decisive output, or the reasoning>
Consumers not updated: <list or "none found">
Other risks: <item> — <likelihood/impact> — <mitigation>
Unknowns: <consumers outside the repository>
```

## Done when

Every boundary change from step 1 has its consumers listed, and the safety fact has evidence
at the highest level you could reach, with the reason if below 3.
