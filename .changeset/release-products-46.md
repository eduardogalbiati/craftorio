---
"@craftorio/engine": minor
"@craftorio/shared": patch
---

A release run releases one product of a repository that declares several in `.craftorio/project.yaml`
(`products`): its own version command, tag and last release, and the merged issues with no changeset in
the Ship gate. A repository without products is released as before.
