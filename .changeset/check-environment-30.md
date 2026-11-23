---
"@craftorio/contract": patch
"@craftorio/engine": minor
"@craftorio/shared": patch
"@craftorio/ui-kit": minor
---

Rule checks tell an environment failure (dependencies not installed, a command not found) apart from a
rule failure: the run stops once at check_environment with Try again instead of sending the developer
back, and an imported repository offers its dependency install (`onboarding:install-deps`).
