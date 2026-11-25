---
order: 175
---

<!-- section:workflows -->
## Secret scan

Feature, Fix and Release look for secrets in the commits a run made (#49), with
[gitleaks](https://github.com/gitleaks/gitleaks) and no agent: the base to HEAD, after the developer's
commits and before the code review (Release: the commits since the product's last tag, the whole history
without one, before the Ship gate).

- **Found**: the developer gets the rule, the file, the line and the commit, never the value, at most
  twice; then the run stops at a gate. Nothing is merged or pushed while a finding is open. The developer
  takes it out of every commit of the run; a commit already on the base is never rewritten.
- **A real secret** is leaked: the skill `secret-triage` tells you to revoke it, since deleting it from the
  commit is not enough. No agent tests or uses the value.
- **A false positive** is an entry in `.gitleaksignore` (or the project's `.gitleaks.toml`), committed with
  its reason. The code review sees each new entry and can refuse it.
- **Not installed**: the run goes on and the run, its gate and its result say "secrets not scanned".
  Setup and Settings › Agents & CLIs list gitleaks as optional, with its install command; a run never
  installs it. An error of gitleaks is not a pass: the run stops at a gate.
- **Off**: the input *Secret scan*, for a project that has its own scan.

It does not find every secret: see the Security model.
