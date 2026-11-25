---
"@craftorio/engine": minor
"@craftorio/shared": minor
"@craftorio/ui-kit": patch
"@craftorio/front-ai": patch
"@craftorio/front-build": patch
---

A run's cost never counts an unknown model as zero: a turn with no price counts the CLI's own figure, every total that
includes one is marked "≈", and the run list, the Run screen, the roadmap, the header and Usage give one total for the
same run. Usage also counts the Product Owner's calls.
