# UI patterns: alerts, toasts, menus and the Roadmap

Page alerts, toasts with an action, ⋮ menus, the roadmap card and releases, and how to check a screen change.

- **Page alerts** (#270, `alerts.js`, `window.Alerts`): what a page has to tell its owner goes into
  the alerts box at the top of the page (above its filter row), never into a banner of its own. The
  page builds a list on every render and hands it over: `Alerts.mount(box).set(list)`, each alert
  `{ id, level, title, text, actions: [{ label, onClick, primary, title?, pressed? (a switch),
  attrs? (e.g. a `data-testid`) }], dismissible, onDismiss?, createdAt? }`. One alert shows at a
  time with a counter ("1/3") and arrows, errors first, then warnings, then infos. Choose the level
  by what the owner must do: **error** when something is blocked until they act (a roadmap paused by
  a failed item, the queue's error; never dismissible: it leaves when its cause does), **warning**
  when something is stale or will go wrong later (a Backlog Refresh that is due, a retired label),
  **info** for a state worth knowing with an optional action (local merges not pushed). An alert
  leaves by itself when the page stops listing it; × hides an info or a warning until its condition
  comes back. The component has no screen code: the Backlog's list is `renderAlerts` in `backlog.js`
  (the roadmap's own alert comes from `BacklogRoadmap.alerts`).
- **A toast with an action** (#281, `showToast(title, detail, runId, gate, { action })` in `app.js`;
  the countdown and the action live in `toast.js`, `openToast`):
  `action: { label, run, done? }` draws a button inside the toast ("Undo"). Such a toast stays 10 s
  (7 without), waits while the pointer is over it or its button has the focus, runs the action once
  and then says its outcome (`done`, "Restored" by default, or the error's message); a click
  elsewhere on it does nothing, × dismisses it. **An action that removes or replaces something in
  one click offers Undo in its toast** (or asks first when it cannot be undone): the Roadmap's edits
  do (`undoToast` in `backlog-roadmap.js`, `api.undoRoadmap`), with "Restore an earlier version…" in
  its ⋮ menu for a mistake noticed later.
- **A menu of actions** (#269, #748): secondary or rare actions go into a ⋮ menu built from a list
  with the shared component (`Menu.menuHtml` / `Menu.bindMenu` in `packages/ui-kit/menu.js`, its API
  in `packages/ui-kit/AGENTS.md`: entries, dividers, a refused entry's reason in its tooltip, the
  keyboard and the outside click), behind a button with `aria-haspopup="menu"` and `aria-expanded`;
  the first entry focused when it opens, Esc closes it and gives the focus back. A new action is a
  line in the list, not a new button.
- **The roadmap's items as lanes** (proposal C, 2026-11-27; `lanesHtml` / `groupHtml` / `rowHtml` /
  `panelHtml` in `backlog-roadmap.js`, the meters, the live timer and the Progress cell in
  `backlog-roadmap-meters.js`, `.rm-group` / `.rm-row` / `.rm-station` in `backlog.css`). A stage's head is one line:
  counted chips (waiting for you, failed, running, N of M done), the estimate and its ⋮ menu. Inside the stage, one
  group per workflow (`roadmap-workflow`, `roadmap-workflow-name`; grouped by the name a row shows, so a run of a
  workflow's earlier name has its own group), whose stations are columns drawn once (from `RunProgress.pipeline`,
  `run-progress-model.js`: the workflow's groups and its steps in no group, in order), and one row per item
  (`roadmap-item`): the issue titles (and #90's outside-author badge), a status line, the owner's actions (Retry /
  Skip, Resume run, Move on, the merge wait), one glyph per station (`roadmap-station` with `data-state`; the
  current one is a pill that opens the run), the Progress cell (`roadmap-ring` and two bars: `roadmap-meter-cost` /
  `roadmap-meter-time` with `data-verdict` none | estimate | ok | warn | over, the time of a run at work being the
  live `roadmap-run-timer` moved by `tick()`) and a chevron (`roadmap-item-toggle`). The open row
  (`roadmap-item-panel`) has Cost, Time and Progress with numbers, the run's summary, Open run, the map, Ask the
  Oracle (`roadmap-ask-oracle`), the mode (`roadmap-mode`), the ending, the complexity, earlier runs
  (`roadmap-run-history`), the inputs and Edit / move / Remove. The roadmap's head no longer draws its state dot
  (`roadmap-state-dot` stays in the page, hidden, with the state) nor its title (kept for assistive technology):
  the state pill (`roadmap-state-pill`) says the state. Under 1042px of the card's own width (`@container rm-card`)
  a group's rows scroll sideways.
  A stage's actions are its ⋮ menu
  (`stageMenuHtml`, `roadmap-stage-menu`; an entry that cannot be used is `aria-disabled` with its
  reason under it); a disabled stage (#284) is `.rm-stage.disabled` with `data-disabled="true"`.
  More states for screenshots: `--roadmap states` (a fix round, a disabled stage, a simulated item).
  An item whose run ended interrupted, failed or cancelled has `roadmap-item-resume` ("Resume run",
  `[data-rm-resume]` → `openResumeDialog`) in `.rm-fail-actions` (#288).
  Move on (#395): an item whose run waits at a human gate (`RoadmapModel.atGate`) has "Move on"
  (`roadmap-item-move-on`, `data-rm-item="park"`, asks first in the confirm modal, Undo in its toast)
  in `.rm-fail-actions`, and so does the paused roadmap's alert when its item's run was interrupted
  at a gate. A parked card (`data-status="parked"`) has `roadmap-item-parked`, "Parked at <gate>"
  (`parkedHtml`, a `[data-run]` button that opens the run at its gate; "resume its run first" when it
  was interrupted); the bar counts `roadmap-parked-count` ("N parked at a gate"). Parked items stay in
  Planned. The stage menu has no "Move on from this stage" any more (#748): parking is the card's.
  Screenshot state: `--roadmap parked`.
- **An item that waits for its PR's merge** (#797): the card has `data-status="waiting_merge"`, the
  amber pill, `roadmap-item-pr-link` and Skip without Retry; `roadmap-item-merge-wait` (muted, never
  an error) only after a failed read; the header's activity band says what the next stage waits for
  (`roadmap-merge-wait`). Screenshot state: `--roadmap merge`.
- **Releases on the Roadmap** (#291, `releaseView` / `releaseBlockHtml` / `releaseLineHtml` in
  `backlog-roadmap.js`, `.rm-release*` in `backlog.css`): `data.releases` comes with the Backlog read
  (`roadmapReleases` in `packages/engine/service/areas/releases.js`: the history plus the release runs not
  shipped, or `{ error }`). A block `roadmap-release-block` (card `roadmap-release-card`, `role=group`,
  aria-label "Release <version>, <state>") and its dashed `roadmap-release-line` follow the release's
  stage; they are never stages (no `data-stage`, no menu, no drop target) and replace the cut line's
  row once its release run started. The filter row's `roadmap-release-filter` (`view.release`,
  localStorage `craftorio.roadmapRelease`) narrows `visibleStages` to the release's runs (`v.runs`).
  Screenshots: `--release checking|waiting|held|shipped` (the demo cut line's release run) and
  `--release-filter next|<version>`.
- **A roadmap changed elsewhere** (#287): every save of the Roadmap screen sends the roadmap's
  `updatedAt` it drew (`save(ctx, r, stages, edit)` → `api.saveRoadmap(projectId, stages, label,
  base)`); the service applies only that edit to a roadmap written since (docs/agents/storage.md).
  While an Edit form is open, a change of the file adds the notice `roadmap-changed-notice` to the
  form ("The roadmap changed: 1 item updated elsewhere", `staleNotice` in `backlog.js` with
  `BacklogRoadmap.changedElsewhere`, updated on each change). A refused save (`conflict`) shows the
  stored roadmap and the reason in the error line, and keeps the form open with the values typed
  (`kept`); when the item or its stage is gone, the "Not saved" box `roadmap-save-conflict`
  (`lostHtml`, `.rm-conflict`) shows the reason and those values read-only, until Dismiss.
- **Check it**: extend the screen's demo data in its seed module (`scripts/screenshot/views/<view>.js`) with the fields you add,
  then capture the default view and each state with `--click` (e.g.
  `npm run screenshot -- --view backlog --mode roadmap --click "[data-rm-edit]"`). List those
  captures in `evidence_plan` and log the UI choices in the decision log.
