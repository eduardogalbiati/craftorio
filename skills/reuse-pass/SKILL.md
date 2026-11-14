---
name: reuse-pass
description: The one reuse pass text (#756) - for each new function, constant, mapping table or rule of a diff, search the repository for an existing one (by name, literal values and rule). Pulled with `uses:` by code-review (the reviewer) and developer-self-review (the developer), so the two never drift.
summary: "For each new function, constant, mapping table or rule of the diff: search by name, literal values and rule; reuse what exists, a duplicated rule is `major`"
used_by: "developer, reviewer"
---

# Reuse pass

The costly duplication is rarely copied lines: it is the same rule or the same mapping written
again in another place, which then drifts. When your prompt carries the Warm Up's reuse list
(#758), start from it: a diff that rewrites one of its entries instead of calling it is a finding.
Then, for each new function, constant, mapping table or rule in the diff, search the repository
for an existing one (the reviewer before the verdict, the developer before handing over):
- by **name** (and obvious synonyms: `CLI_BY_TYPE`, `cliForProvider`, `providerCli`);
- by the **literal values** it maps or lists (`grep` for two or three of its keys or values
  together, e.g. `'claude-code'` and `'codex-cli'`);
- by the **rule** it computes (the condition or formula: a cost correction, a "current stage", a
  status derived from the same fields).

When you find one:
- A rule or mapping table that already exists elsewhere is a `major` finding (axis `standards`, a
  hard violation, not a judgement call): name both places (file and line), say which one to keep
  and which helper to call, or where to move the shared one when neither is reachable (export it,
  or a small module next to the data it reads). The developer calls it instead.
- Plain copied lines (the same few statements, no shared rule or table) stay `minor`.
- When it is unclear whether the two compute the same rule, record your assumption and pick the
  lower severity; never stop to wait for an answer.

No match: no finding. Say in your summary that the reuse pass found nothing.
