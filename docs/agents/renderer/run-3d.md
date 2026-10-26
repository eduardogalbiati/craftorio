# The run's 3D view

The full-screen 3D overlay of a run: what it draws, its model and how to capture it.

- **The run's 3D view** (`run3d.js`, `run3d.css`, model `run3d-model.js`) is a full-screen overlay
  opened by the 3D button beside Chat (Run screen `#run-mode-3d`, run chat `#rc-3d`): the run's
  recorded events, then its live `run:event`s, into a pure `Run3DModel` (Node-tested); "Open the
  gate" closes it and calls `showRun` (it never answers a gate). The scene is the one exception to
  "no bundler": React + React Three Fiber + three in `packages/ui-kit/run3d/*.jsx`, bundled by
  `scripts/build-3d.js` into `generated/run3d-scene.js` (gitignored, rebuilt by prepare / prestart /
  prebuild, packed into the app) and loaded with a `<script src>` on the first click: run
  `npm run build:3d` after changing a `.jsx`. The same script builds the **project city** (#373):
  `fronts/analyser/city3d/*` → `generated/project-city.js` (`window.ProjectCityScene`), loaded by the
  Architecture tab's City view (`views/project/project-city.js`, whose HUD is plain DOM with the
  `r3d-*` classes, placed by `project-city.css`; its notes, cards and connections panel in their own
  files next to it). Its layout is pure (`packages/shared/city-layout.js`, Node-tested) and, like the
  scene's geometry, a port of the approved proof of concept `poc/project-city.html` (#382: the POC
  is the source of truth for the look; copy its rules and constants, never re-derive them from a
  description); the scene draws it with instancing (`city3d/geometry.js`) and the run's theme,
  lights and materials. Capture it with `npm run screenshot -- --view project --tab architecture
  --mode city` (a 31-file demo) and `--mode city-large` (this repository with the POC's plan, the
  real scale: compare it with the POC rendered at the same size before touching the look).
  - **Themes** (`run3d-theme.js`): dark by default, the app's own tokens (a test compares its
    palette with `style.css` `:root`), or the light palette of the approved proof of concept
    (`poc/run-3d.html`). The HUD's colours are `--r3d-*` variables under `.r3d` /
    `.r3d[data-theme="light"]` (no literal colour in a rule: a test checks it); the scene's are the
    theme's palette (`useTheme()` in a component that paints with it; a texture drawn with theme
    colours passes `themed`, so it is freed when the theme is left). A state colour comes from
    `statusColor()` and always with its label. The top bar's sun / moon button
    (`[data-testid=run3d-theme]`) switches; the choice is in localStorage (`multiagent.run3d.theme`).
  - **Replay** (`run3d-replay.js`, a pure `Run3DPlayer`): it keeps every event, a `head` model (the
    run now) and a `past` model (the replayed moment: the state kept at the last step boundary, then
    the events up to it), and the views draw `view.model`, whichever is shown, with `nowMs()` /
    `robotStateOf()` for the time-dependent parts. Controls in the pipeline card: play / pause
    (`[data-testid=run3d-play]`, Space), previous / next step (`[data-r3d-step]`, Left / Right; with
    Shift 1% of the timeline), speeds 1× to 64×, the strip (`[data-testid=run3d-strip]`: click or
    drag), and `[data-testid=run3d-live]` back to the live run (or to a finished run's end). A wait
    for the owner over a minute is cut to 45 s in a replay only (marked on the strip); the head of a
    live run is always in real time.
  - Capture it with `npm run screenshot -- --view run --input mode=validated --stop-at developer_check
    --click "#run-mode-3d" --click ".r3d-zoom button[aria-label='Follow the run']"` (a finished run:
    `--view run-chat --click "#rc-3d"`). Then `--click "[data-testid=run3d-theme]"` for the light
    theme, `--click "[data-r3d-step='-1']"` (repeatable) for a replay paused at an earlier step (on
    the live run: with "Live" offered), `--press "[data-testid=run3d-strip]@0.4"` to seek with the
    pointer, `--key Space` to play, `--size 1150x780` for the narrow layout. The simulated run lasts
    a few seconds: for hours on the clock and a cut wait, give `--run <folder>` a run folder whose
    `events.jsonl` has them.
