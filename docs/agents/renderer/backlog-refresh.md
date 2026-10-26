# The Backlog's refresh model

Full loads versus the light live reloads of the Backlog (#491).

- **The Backlog's refresh model** (#491): the first load, Sync and the owner's reloads fetch the full
  `backlog:get` (several MB: every issue's body). The live paths (run status events, the 5 s poll
  while busy, `backlog:changed`) call `liveReload`, which fetches the light `backlog:state`
  (statuses, runs, timings, the queue, the roadmap's state and `updatedAt`, no bodies) and merges it
  into `bl.data` (`BacklogLive.mergeState`); the full fetch runs only when the state names a stage
  or item the screen does not know, or the stages' shape changed. One reload is in flight at a time
  (a request made meanwhile runs once after it). The scroll position is read right before the DOM
  swap, and a scroll the owner made during the fetch wins. The Roadmap patches rows in place
  (`BacklogLive.patch`: status, ring, waiting badge per `data-rm-item`) and rebuilds the list only
  when the set or order of stages and items changed; expanded rows and open menus stay (#214).
- Test changes with a temporary Electron script (see `scripts/smoke.js`:
  `npx electron scripts/smoke.js <out.png>` runs a mock run and takes a screenshot) and look at
  the screenshots. Never open real CLI terminals or start real runs in those checks. In a fresh
  workspace Developer mode is off and the Simulation box is ignored: set
  `api.setSettings({ developerMode: true })` before clicking Start.
