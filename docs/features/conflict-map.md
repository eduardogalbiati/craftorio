---
order: 150.7
---

<!-- section:engine -->
### The conflict map

Parallel runs collide in a few hub files (registries, the shared stylesheet, one import line with
many names), even when their issues look unrelated. The **conflict map** counts, per file and per
single line, the finished runs that changed it (from git and the runs' commits only: no model call;
simulated runs never count; a project with no merged run starts from its last commits). It is saved
as `backlog/<project>.conflict-map.json`, built when the Product Owner plans and finds none, and
rebuilt after each run that merges. The Product Owner reads it to put groups that touch one hot file
in different stages, and lists each hot spot (changed by more than half of the last 20 runs) under
**Decongest** with a fix in the repository's terms; **File as issue** files one on your click. The
Roadmap shows the map under its stages: click a row to see the runs behind its count and the trend.
