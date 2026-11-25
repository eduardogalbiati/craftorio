---
"@craftorio/engine": minor
"@craftorio/contract": patch
"@craftorio/shared": minor
"@craftorio/ui-kit": minor
"@craftorio/front-build": patch
---

Runs scan their own commits for secrets with gitleaks before the review, and a release before Ship: a finding goes back
to the developer, at most twice, then to you. Without gitleaks the run goes on and says that secrets were not scanned.
Setup and Settings list gitleaks as an optional CLI.
