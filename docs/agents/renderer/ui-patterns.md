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
- **A menu of actions** (#269): secondary or rare actions go into a ⋮ menu built from a list
  (`MENU` in `backlog-roadmap.js`: `.bl-menu-wrap`, a button with `aria-haspopup="menu"` and
  `aria-expanded`, `role="menu"` / `role="menuitem"`, the first entry focused when it opens, Esc
  closes it and gives the focus back), so a new action is a line in the list, not a new button.
- **The roadmap item card** (#282, `itemHtml` in `backlog-roadmap.js`, `.rm-*` in `backlog.css`) reads in
  three bands. Band 1, `.rm-item-top`: the issues (`.rm-issues`: the titles, then the count and the
  complexity, `roadmap-issues-foot`) | cost and time (`metersHtml`: `roadmap-meter-cost` /
  `roadmap-meter-time` with `data-verdict` none | estimate | ok | warn | over; the time of a run at
  work is the live timer, `roadmap-run-timer`, moved by `tick()`) | the status block (`statusHtml`,
  `roadmap-status`: the ring, the StatusPill and the step, the fix round in full, then Retry / Skip
  or move and Remove; never an agent avatar). Band 2, `.rm-workflow` (`workflowHtml`,
  `roadmap-workflow`): the workflow's name, the run chip ("Open run →") or Edit, the mode toggle
  (`roadmap-mode`: `.seg.sm`, locked while the item runs), the badges and input pills (`.rm-meta`),
  and the pipeline (`pipelineHtml`, `roadmap-pipeline` / `roadmap-station` with `data-state`), whose
  stations come from `RunProgress.pipeline` (`run-progress-model.js`): the workflow's groups and its
  steps in no group, in order (a human gate in no group is no station; the gate a mode turns on is
  one, right after the station that holds it), each with what the run's trail did there. Band 3: the
  Product Owner's reason, then the error line and the Edit form. The card answers to its own width
  (`@container rm-card` on `.rm-items`, not the window: the sidebar and the Oracle's drawer narrow
  it): the issues share the first row only while they keep 540px, the Workflow band stacks under
  980px, and under 520px everything is one column. A stage's actions are its ⋮ menu
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
- **Releases on the Roadmap** (#291, `releaseView` / `releaseBlockHtml` / `releaseLineHtml` in
  `backlog-roadmap.js`, `.rm-release*` in `backlog.css`): `data.releases` comes with the Backlog read
  (`roadmapReleases` in `packages/engine/service/areas/releases.js`: the history plus the release runs not
  shipped, or `{ error }`). A block `roadmap-release-block` (card `roadmap-release-card`, `role=group`,
  aria-label "Release <version>, <state>") and its dashed `roadmap-release-line` follow the release's
  stage; they are never stages (no `data-stage`, no menu, no drop target) and replace the cut line's
  row once its release run started. The filter row's `roadmap-release-filter` (`view.release`,
  localStorage `multiagent.roadmapRelease`) narrows `visibleStages` to the release's runs (`v.runs`).
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
