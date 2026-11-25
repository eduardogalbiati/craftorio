---
name: secret-triage
description: How to judge a finding of the secret scan (gitleaks, #49) - a real secret is leaked (the owner revokes it, the run's own commits are rewritten), a false positive is an entry in .gitleaksignore with its reason. Used by the developer a finding goes back to and by code-review for the entries a change adds.
summary: "Real: leaked, the owner revokes it and the run's own commits are rewritten; false positive: a `.gitleaksignore` entry with its reason, in the same commit"
used_by: "developer, reviewer"
---

# Secret triage

The scan names a rule, a file, a line and a commit, never the value. Never use, test or try a
value, on any service, and never print or copy it (not in a command, a message, a commit, a log or
your answer): look at the line only to judge it.

## Judge each finding

- **Real**: a credential something accepts, or may accept. Not sure: it is real.
- **False positive**: made up for a test, an example or a placeholder, public by design (a
  publishable key), or not a credential (a hash, an id). Say how you know: it comes from the code
  around it, never from trying it.

## A real secret

1. Treat it as **leaked**. Tell the owner in `summary` to **revoke** it (rule, file, line, what it
   opens): deleting it from the commit is not enough, it may already be in a log, a cache or a clone.
2. Read it from the environment or the project's secret store, with no default value.
3. Take it out of the run's **own** commits, not only of the last one: a fixup commit and
   `git rebase --autosquash` from the base. A new commit that deletes it leaves it in the history.
4. Never rewrite a commit already on the base: report it to the owner. Once the owner says it is
   revoked, and only then, its entry is recorded as below with that reason.

## A false positive

- Prefer changing the code so that nothing looks like a secret (a value built at run time).
- Else one entry in `.gitleaksignore`, with its reason in a `#` comment right above it, in the
  same commit. Run's own commits: `file:rule:line` (a commit's hash changes when it is rebased or
  merged); a commit already on the base: `commit:file:rule:line`. Commit it: the scan refuses an
  ignore file that is not committed.
- A path or rule allowlist in `.gitleaks.toml` only for a whole folder of made up values, with its
  reason. `gitleaks:allow` comments do not count.

## Reviewer

- Read the line behind each new entry and each change of `.gitleaks.toml`. Refuse (a blocker) an
  entry that may be a real secret, has no reason, or is wider than its finding.
- No finding is not proof: the scan knows patterns. A password in plain words is yours to see.
