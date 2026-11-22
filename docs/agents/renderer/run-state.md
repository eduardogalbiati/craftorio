# Run state and opening a run

Where a run's state comes from, run titles and PRs, and how every way of opening a run reaches the run view.

- **Where run state comes from** (#74): a run's view is built only by `reduceEvent` in app.js
  (`applyRunEvent`, one reducer per event type in `RUN_EVENT_REDUCERS`, returns the side effects
  as data), fed the live `run:event`s by `onEvent`, which then runs the effects
  (`runEventEffects`). `hydrateRun(runId)` replays the recorded events (`runs:events` with
  `activity: true`: stream items compacted, the rest of the CLI output stays on disk) through the
  same reducer with `live` false, dropping the effects (no toasts, no list reloads, one render at
  the end). It runs
  for every run in `runs:active` when the window loads or reloads (`loadActiveRuns`), for a run first
  heard of mid-way (`viewOf`) and for a past run opened in Details (`openPastRun`, `v.past`:
  read-only, an unfinished one becomes interrupted). Live events that arrive during the replay wait
  in `hydrating` and follow in order; each view keeps `lastSeq` and ignores a live event whose `seq`
  is at or below it. Gates still pending after a replay show their toast; the engine's list
  (`runs:active` gates) stays the source of truth.
- **Run titles and PRs** (#84): `state.runMeta` (run id → `{ title, customTitle, pr }`) is fed by
  `runs:list`, the project's runs, `runs:active`, Backlog data and the `run:meta` push (PR state
  changes, a title set); every place reads it through `runTitle(r)` / `runLabel(r)` / `prBadge(r)`
  in `app.js` (exported on `window` for `views/runchat/runchat.js` and `views/backlog/backlog.js`) so they agree. Drawing is in
  `run-badges.js` (pure: PR glyph and state colours, the default title). A PR without a state is
  asked with `askPrStates` (`runs:prState`, cached by the service). The title's pencil
  (`runTitleHtml`, `[data-title-edit]`) and the PR link (`[data-pr-url]`) are handled by one
  capture-phase click listener, so they never select or expand the row around them.
- Write & Review and AI Arena keep their own chat screens; every other run uses the run chat
  (`views/runchat/run-chat-model.js` is pure and unit-tested, `runchat.js` draws it). An
  interrupted run (status running in its events, not live: `interrupted()`) ends with
  `runchat-interrupted-note` and a primary `runchat-resume` (`[data-resume-at]` →
  `openResumeDialog(runId, { step })`, the stopped step preselected); a gate it left open has its
  choices disabled with the reason in their tooltip and its own `runchat-resume` (#288). A run
  alive in another app window (its `listRuns` row's `runningElsewhere`) is not interrupted: it
  ends with `runchat-elsewhere-note`, its gate says to answer it there, and no Resume.
- **How a run is opened**: one global run view, `state.runView` (`'details' | 'chat'`, saved in
  localStorage `craftorio.runView`). Every way of opening a run (sidebar Run menu, toasts,
  notifications, a run card's "Open run", Backlog run links, the gate badge, a resume) goes through
  `selectRun(runId)` / `showRun(runId, { workflow, running })` in `app.js`, which open that run's
  chat (Write & Review and AI Arena: their own screens) or its Run screen (a run this window does
  not follow: loaded from disk by `openPastRun`). Only the explicit
  switches change the choice (`setRunView`): the Run screen's Chat tab, the chat's Details
  tab and a run card's "Open run" (#409: always the Details). A chat always opens at its latest
  message ("Jump to latest" while scrolled up). Both screens start with the same tab row (#410, `data-testid="run-tab-row"`,
  tablist "Run view": Chat | Details | 3D, at the same place so switching never moves it); on the
  Run screen it also holds the status (`run-screen-status`), the id, the run's actions
  (`#run-actions`, filled by `renderRunSummary`) and Pause / Stop (`run-controls.js`, #412). The
  chain banner (`run-chain-banner`) sits below the row, only with a chain, its editor or linked
  runs. Opening another run resets `state.tab` to `'artifacts'` (the Details' first tab).
  The top bar (#412) holds no run: Project select, 24/7 chip, usage, then the Oracle, the bell and
  the account at the right end.
