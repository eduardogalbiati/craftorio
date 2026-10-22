# Proofs of concept

This folder holds proofs of concept the owner asks a Claude session to explore before a feature is
built. They are references, not part of the app:

- `run-3d.html`, the 3D view of a run, and `embed-run.js`, which embeds real runs into it;
- `project-city.html`, a repository as a 3D city (zones and districts from a city plan, buildings
  by lines, complexity and functions, quadrant/zone/churn colours, landmarks, ports, dependency
  arcs), and `embed-city.js`, which builds the model into it from `git ls-files`,
  `scripts/code-health.js --hotspots`, `git log`, `require()` calls and `Cargo.toml` manifests
  (`node poc/embed-city.js --plan poc/project-map/plans/<project>.city-plan.json`, with `NODE_PATH`
  pointing to a `node_modules` when the checkout has none; without `--plan` it groups by folders);
- `city-modes.html`, the layout of the city map per use (#442: Explore, Live, Run replay, Issue impact,
  Stage, Release, one at a time, each with only its panels; chevrons, a closable legend, the map as a
  modal over the screen it was called from, the release legend with its change ramp, a quiet city in
  the analysis modes), on the v2 city (`project-city-v2.html`, its model in `project-city-v2.data.js`)
  with the app's HUD stylesheets verbatim; a demo bar picks the use case; the owner's approved
  screenshots are in `city-modes-screenshots/` (the issues port this layout, not a new reading);
- `project-map/`, the cartographer skill draft (`SKILL.md`: how an AI writes a city plan) and the
  plans of this repository and of photocraft, a public Rust repository used to try the plan format.

Rules:

- the packaged app leaves this folder out (`scripts/package.js`);
- the generated docs leave it out (the code map and the code → tests map, `scripts/docs.js`);
- no lint or test walks it.

When a proof of concept becomes a feature, the feature lives in `src/` with its tests; the files
here stay as they were, for comparison.
