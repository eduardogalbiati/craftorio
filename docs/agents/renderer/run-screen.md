# The Run screen: artifacts, tabs, gates and diffs

Artifact previews and the image viewer, the Run screen's tabs, the gate layout, the diff viewer and the expanded run row.

- Artifacts previews images (`kind: image`, read as a data URL; the CSP allows `img-src data:`).
- **Artifact images open in the shared viewer** (#145, `image-viewer.js`, math in
  `image-viewer-model.js`, browsing in `image-sequence.js`), **with the whole context** (#182):
  `ImageViewer.open({ title, items: [{ title, images: [{ src | file, label, caption, side }] }],
  index, imageIndex })` gets every image of the place the click happened, in the order shown there
  (an original/modified pair is one item), and the clicked one; `open({ title, images, index })`
  still opens one item. Almost full screen, fitted (never upscaled), click / wheel / + − Fit 100%
  zoom up to 400%, drag to pan when zoomed; previous / next arrows on the sides (hover or Tab,
  disabled at the ends, no wrap-around), ← / → and Home / End between items (a new item is fitted,
  the neighbours preloaded), a counter "2 / 3"; one item shows neither. Tabs, Space or O / M switch
  inside a pair at the same zoom; Esc or a click outside closes, right-click keeps the copy menu.
  Every artifact image must use it: give the thumbnail `ImageViewer.THUMB` (hand cursor, "Click to
  enlarge", focusable, Enter opens) and open it on click with its context; no per-screen viewer.
  Users today: the Artifacts panel (its screenshot cards and image files), the Artifacts screen
  (`ArtifactsPanel.openImage({ files })`: the run group's images), the gate's E2E scenario
  screenshots, the diff viewer (the changed images), the run's input images and pasted images.
- **The Run screen's tabs** (#109): the Details panel has Session, Events and Artifacts
  (`switchTab`, `#tab-artifacts`, with a count on the tab). The Artifacts tab and the approval
  gate's side panel are one component, `artifacts-panel.js` (`ArtifactsPanel.mount(root, { runId,
  flat, extras })`): the run's files from `artifacts:list { runId }`, what the run produced first
  (#225: each file's `category` from `packages/engine/domains/evidence/artifact-categories.js`; "Produced" = Result, Screenshots &
  images, Tests, Reports by default, "Show all" adds Process, Internal is never listed; category and
  kind chips; the Artifacts screen reuses `filtersHtml` / `filterFiles` / `onFilterClick`),
  grouped by category (newest first in one; `flat` for the gate), a preview in place (markdown, images with their original/modified
  pair from the evidence manifest, TSV as a table, JSON, text) and "Open in Artifacts"
  (`openArtifactsAt`). `onEvent` calls `ArtifactsPanel.refreshRun(runId)` on the events that add a
  file (`ARTIFACT_EVENTS`), so a running run's list follows without a reload. Above the files, the
  run's **Screenshots** (#146, `artifacts:evidence`): the final set by issue, each pair side by side
  ("Original (main)" / "Modified (<branch> @<sha>)") with its caption, older rounds in a collapsed
  History, "No screenshots in this run" without any. `npm run screenshot -- --view run --input
  mode=validated --stop-at developer_check` (and `--view artifacts`) add demo screenshots in two rounds.
- **The gate layout** (#108): a gate whose step has `local_preview: true` (the engine adds
  `run_app: true` to it, configured or not) has two columns, `.run-gate-wide`: on the left a short
  summary (`gateBriefHtml`: the developer's summary and one line per issue, the full message under
  "Full message"), the tools (`gateToolsHtml`: Run App, Show the diff, the worktree) and the
  choices; on the right its Artifacts panel (`gateSideHtml` / `mountGateSides`: the run's files
  newest first, the changed files from `gate:changes`, each opening the diff viewer, and the developer's
  test notes and evidence plan). Stacked under 1100 px. The Run screen and the run chat use the same
  helpers; the sidebar card only links to the run (no room). **Run App** asks `localPreview:info`:
  with a config it starts the preview (`localPreview:start`), without one it opens a setup
  prefilled from the worktree (`suggestConfig` in `packages/engine/domains/local/local-preview.js`) that saves the project's
  `localPreview`. Its state (running / stopped / failed, Stop, Terminal, Open URL, the port-in-use
  error) is painted by `paintGateApps` from the run view's `preview` (local_preview events).
  `npm run screenshot -- --view run --workflow software-development-local-hero.yaml --input
  mode=validated --stop-at developer_check` captures it.
- **The diff viewer** (#118, `diff-viewer.js`, model `diff-viewer-model.js`, styles
  `diff-viewer.css`) is a near-full-screen overlay: `DiffViewer.open({ runId, approvalId?, file?, title?, commit? })`
  (`commit`: one of the branch's commits, the Commits select set to it, #289).
  Show the diff, the Changed files entries (`onChange` in `mountGateSides`), the Run screen's
  Review changes and the expanded run card's Review changes and commit rows open it.
- **The expanded run row** (#289, `run-list.js`, styles `.pr-*`): under the run's actions, task and
  sessions, two columns (`runColumnsBlock`, `.pr-cols`: side by side from 900px of card width with a
  container query, stacked below, Artifacts first), wherever the shared run list is expanded
  (Workflows › Runs, Project, Analytics › Run). **Artifacts** (`runArtifactsColumn`,
  `run-card-artifacts`) reuses the Details tab's filter from `ArtifactsPanel` (`newFilter`,
  `filtersHtml`, `filterFiles`, `onFilterClick`, `chipKindOf`, `CATEGORIES`): Produced by default,
  grouped by category newest first, "n of m" in its head, the step as a mono label on each row,
  "Nothing produced yet" with a "Show all (n)" button when only process files exist, no column when
  the run has no file; the filter lives in the row's `rl.arts` entry and resets when the card is
  reopened. **Repository** (`runRepositoryColumn`, `run-card-repository`) reads `run:diff` once per
  open card with its `summary` option (`ensureRunRepo`, `rl.repo`: the commits and the files' counts,
  no patch; a running run's commits again when a run event refreshed its row; never `run:diffFile`).
  A run merged locally whose branch the engine deleted still lists its commits (the service reads
  them from the `worktree.merged` commit). It shows the branch (`run-card-repo-branch`) and its base, a state badge
  (`run-card-repo-state`: merged or pushed from the PR, merged locally at the merge commit, not
  merged), the totals (`run-card-repo-totals`), the commits newest first (`run-card-commits`,
  `run-card-commit` buttons named by hash and subject, five then `run-card-commits-more`), and
  **Review changes** (`run-card-review-changes`, disabled with the reason in its title when there is
  nothing to show). States: loading, an error with Retry, "This run made no commits", "Simulated:
  nothing was committed", "The branch is gone" (the service answers `unavailable` instead of an
  error when the run's branch was deleted). Screenshots: `--view workflows --tab runs` with the demo
  runs (every run's `run:diff` is `demoRunDiff`). Its data is `run:diff` (the files with their status, counts and patches,
  and the branch's commits) and `run:diffFile` (one file's patch and both sides, used to expand
  context, load a huge diff and preview images). Both are served by `packages/engine/fronts/analyser/areas/diff.js`,
  which takes the folder and base from the open gate or the run's `worktree.ready`. The model is pure
  and Node-testable: `parsePatch`, `rows` (gaps and expansion), `splitRows` (split and unified
  share the hunks), `wordDiff`, `highlightHtml` and `groupByFolder`. In screenshots, `run:diff` /
  `run:diffFile` answer with a demo branch (`demoRunDiff` in `scripts/screenshot/channels.js`). Use
  `--view run --input mode=validated --stop-at developer_check --click "#btn-run-diff"`, then
  `--click ".dv [data-dv-mode=unified]"`, `--click ".dv [data-dv-expand=all]"` or
  `--click ".dv [data-dv-file='docs/images/backoff.svg']"`.
