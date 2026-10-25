# Evidence: screenshots per step and round (#146)

Where a run's screenshots go (`evidence/<step>/round-<n>/`), the evidence index and who reads it.

- Every screenshot of a run goes to `<run_dir>/evidence/<step>/round-<n>/` (the step that captured
  it, its visit: one folder per "Ask for changes" round, per UI fix round), never flat in the run
  folder. Names: `<issue>-<screen>-<state>.original.png` (the app on the base branch) and
  `.modified.png` (the app with the run's change); a new screen has only `modified`, a removed one
  only `original`. The engine gives the folder as `evidence_dir` and in the command guide, and
  `evidence` is one of the `RUN_DIRS` (`--add-dir`).
- `packages/engine/domains/evidence/evidence.js` keeps one index, `<run_dir>/evidence/manifest.json`: every image with `step`,
  `round`, `commit` (captured), `issue`, `screen`, `state`, `side`, `caption` and `pair` (the other
  side, the same round first, else the newest earlier one), the run's `base` and `branch`, and the
  **final set** (`final`, images marked `final: true`): the round that captured last, i.e. the last
  round of the last step that captured. The folders are the source of truth: the engine rebuilds
  the manifest after every step (`recordEvidence`: commits from the worktree, captions from a
  step output's `screenshots: [{ path, caption }]`), and `scripts/screenshot.js --caption` records a
  shot as it saves it. `orphanImages` lists images the manifest misses.
- Readers use the final set: the Artifacts panel (gate and Run tab) and screen through
  `artifacts:evidence`, the verifier's prompt, `pr-screenshots`'s `publish.js --dir <run_dir>/evidence`.
  Exception: the gate right after a screenshots step (developer_check) shows that step's round
  (`evidence/developer/round-<n>`, #144) and puts every other round in History.
- Runs recorded before: a flat `screenshots/` with `screenshots.json` (`{ path, caption, before }`)
  reads as one legacy set (`legacyManifest`); old folders are not migrated.
