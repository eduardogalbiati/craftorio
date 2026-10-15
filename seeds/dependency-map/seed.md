---
name: dependency-map
summary: The modules of the project and how they depend on each other, with coupling, instability, cycles and layering violations
needs:
  - the project's source files
  - the language's import syntax (read by the Oracle; a dependency tool when installed)
produces:
  - html
  - json
cost: one Oracle turn (reads the imports of every source file)
---

# Dependency map

Adapted from `dependencyMap` in Kent Beck's ToolSeeds (https://github.com/KentBeck/ToolSeeds, MIT).

Draw the project's modules and the dependencies between them, so the owner sees which modules
everything leans on, which ones are fragile, and where the intended layers are crossed.

## What it produces

- A self-contained HTML page: a graph of the modules (an SVG, one node per module, arrows from the
  importer to the imported), a table of the modules with their numbers, the list of cycles and the
  list of layering violations.
- A JSON model: `{ modules: [{ id, files, afferent, efferent, instability }], edges: [{ from, to,
  imports }], cycles: [[id]], violations: [{ from, to, rule }] }`, keys sorted, lists sorted by id.

## Data

- A module is a top-level folder of the source tree (or a package, namespace or crate when the
  language has them). Say which grouping you used.
- An edge is an import, require, use or include of another module of the project. External
  libraries are not modules; count them apart.
- Afferent coupling (Ca): how many modules depend on this one. Efferent coupling (Ce): how many it
  depends on. Instability: Ce / (Ca + Ce), 0 when both are 0.
- Cycles: the strongly connected components with more than one module.
- Layers: the project's own rules when it has them (an architecture doc, a lint rule, a
  `layers` config); otherwise infer them from the folder names (ui → service → domain → storage)
  and say so. A violation is an edge from a lower layer to a higher one.

## Layout and interaction

- The graph leads; nodes are coloured by instability (stable = cool, unstable = warm); cycle edges
  are drawn in a warning colour. Inline CSS and SVG only, no external resource.
- The table can be read without the graph: module, files, Ca, Ce, instability.

## VERIFY

1. Pick two edges and open one importing file of each: the import is really there.
2. Pick the most depended-on module and grep for imports of it: Ca matches.
3. For each cycle, name one import on each side of it.
4. For each violation, quote the file and line of the import.

When you are done, tell me:
- the number of modules, edges and cycles;
- the three most depended-on modules and the three most unstable ones;
- every layering violation with its file and line;
- the grouping and the layer rules you used, and what you assumed.
