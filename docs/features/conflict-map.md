---
order: 150.7
---

<!-- section:engine -->
### The conflict map

Parallel runs collide in a few hub files (registries, the shared stylesheet, one import line with
many names), even when their issues look unrelated. The **conflict map** counts, per file and per
single line, the finished runs that changed it (from git and the runs' commits only: no model call;
simulated runs never count; a project with no merged run starts from its last commits). It is saved
as `backlog/<project>.conflict-map.json` and rebuilt after each run that merges. When the Product
Owner plans and finds none, it never waits for a whole build (#526): the first **Analyze** runs
without the map (its prompt has no conflict-map section), and once its agent is done the map is built
in the background and saved, so the next Analyze uses it. One build per project at a time; an Analyze
asked while it runs waits a few seconds for it at most. The Product Owner reads it to put groups that touch one hot file
in different stages, and lists each hot spot (changed by more than half of the last 20 runs) under
**Decongest** with a fix in the repository's terms; **File as issue** files one on your click. The
project's page shows the map on its **Conflict map** tab (#354, merged with the repository
performance of a date range; the Roadmap links to it): click a row to see the runs behind its count,
the lines most changed in the file and the trend.
