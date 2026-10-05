# Proofs of concept

This folder holds proofs of concept the owner asks a Claude session to explore before a feature is
built (for example `run-3d.html`, the 3D view of a run, and `embed-run.js`, which embeds real runs
into it). They are references, not part of the app:

- the packaged app leaves this folder out (`scripts/package.js`);
- the generated docs leave it out (the code map and the code → tests map, `scripts/docs.js`);
- no lint or test walks it.

When a proof of concept becomes a feature, the feature lives in `src/` with its tests; the files
here stay as they were, for comparison.
