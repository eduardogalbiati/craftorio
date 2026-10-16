// Roadmap model (#349): the roadmap's rules, pure (no DOM, no files, never changes what it is given).
// The states, what counts as finished, the current stage and which owner action applies where.
// src/roadmap.js (the only writer of a roadmap's state, pausedBy, scope and item statuses), the
// service, the night watch, the Roadmap view and the Dashboard ask it instead of keeping copies; it
// loads in node (require) and in the renderer (<script>, window.RoadmapModel).
//
// allowedActions(roadmap, stage?, item?) answers every owner action, { allowed, reason } each (the
// reason, when it is refused, is what the screen shows on the disabled control):
//   start, resume, pause, stop   the roadmap's (with a stage, start is "Run this stage", #141)
//   disable, enable              the stage's switch (#284)
//   pauseStage                   the stage's "Pause after current step" (#368): its runs and the roadmap
//   edit, move                   the item's editor, drag and ↑/↓/Remove (only planned or failed items)
//   retry, skip                  the item that failed or could not start (#196), never a paused one
//   park                         the item's "Move on" (#395): its run waits at a human gate, the roadmap goes on
//   parkStage                    the stage's "Move on from this stage" (#395): parks its items at a gate, skips the planned
// The Roadmap view's rules: releaseView, the date ranges (SINCE, inRange) and its pages (pageOf).
// Any load order: read only when a screen draws.
/** An item's status, ITEM_STATES as a type (#346): the file stores planned, done, parked or skipped.
 * @typedef {'done' | 'failed' | 'parked' | 'paused' | 'planned' | 'running' | 'skipped'} RoadmapItemStatus */
(function (root) {
  // planned: edited, never started by itself · running · paused (a failure, the owner, a proposal) · done
  const STATES = ['done', 'paused', 'planned', 'running'];
  // paused (#368): its run ended paused after its current turn; the roadmap's Resume continues it
  // parked (#395): the owner (or the Night watch) moved on while its run waits at a human gate
  const ITEM_STATES = ['done', 'failed', 'parked', 'paused', 'planned', 'running', 'skipped'];
  // an item done (merged), skipped (the owner, or every issue closed) or parked counts as finished
  const FINISHED = new Set(['done', 'parked', 'skipped']);
  const ACTIONS = ['disable', 'edit', 'enable', 'move', 'park', 'parkStage', 'pause', 'pauseStage', 'resume', 'retry', 'skip', 'start', 'stop'];

  // #395: a parked item (`parked`: { at, gate }) whose gate was answered later and whose run then
  // failed is finished too: the roadmap moved past it, so it never holds its stage or pauses the roadmap
  const isFinished = (item) => !!item && (FINISHED.has(item.status) || (item.status === 'failed' && !!item.parked));
  /** #395: an item whose run waits at a human gate (live: running and waiting; interrupted by a closed app: its run waits). */
  const atGate = (item) => !!item && ((item.status === 'running' && !!item.waiting) || (item.status === 'failed' && !!item.runId && !!item.run?.atGate));
  const stagesOf = (roadmap) => (roadmap && Array.isArray(roadmap.stages) ? roadmap.stages : []);
  const itemsOf = (stage) => (stage && Array.isArray(stage.items) ? stage.items : []);
  /** Whether a stage still has work: an item not done or skipped (disabled or not). */
  const hasUnfinished = (stage) => itemsOf(stage).some((x) => !isFinished(x));
  /** Whether the automation works on a stage: enabled (#284) with an unfinished item. */
  const isOpen = (stage) => !!stage && !stage.disabled && hasUnfinished(stage);

  /**
   * Index of the stage in progress: the first enabled one with an item not done or skipped (-1: none
   * left). A disabled stage (#284: `disabled: true`, the owner's switch on the Roadmap screen) is
   * skipped by the automation: it stays in the list and nothing of it starts while the roadmap runs.
   */
  const currentStage = (roadmap) => stagesOf(roadmap).findIndex(isOpen);

  /**
   * #237: the stage run on its own (#141, `scope`), or -1 when there is none or it is over (disabled,
   * no unfinished item, or no longer in the roadmap): such a scope is dropped, a Resume runs the roadmap.
   */
  const scopeIndex = (roadmap) => (roadmap?.scope ? stagesOf(roadmap).findIndex((s) => s.id === roadmap.scope.stage && isOpen(s)) : -1);
  // #391: a "Pause after this stage" (`scope.pauseAfter`) is not a stage run on its own
  const scopedStage = (roadmap) => (roadmap?.scope?.pauseAfter ? -1 : scopeIndex(roadmap));
  /** #391: the stage a running roadmap pauses after (the bar's "Pausing after stage N"), -1 when none. */
  const pausingAfterStage = (roadmap) => (roadmap?.state === 'running' && roadmap.scope?.pauseAfter ? scopeIndex(roadmap) : -1);
  /**
   * The first cut line (#260) the roadmap reached and whose release has not shipped: a stage with a
   * `release` before stage `at` (every stage when `at` < 0: the roadmap is over), all finished by then.
   */
  function pendingRelease(roadmap, at) {
    const stages = stagesOf(roadmap);
    const reached = at < 0 ? stages : stages.slice(0, at);
    // a disabled stage (#284) is skipped, its cut line with it
    return reached.find((s) => !s.disabled && s.release && s.release.status !== 'shipped') || null;
  }
  /** #391: the roadmap bar's two pauses, the default first ([{ after, label, hint }]; the stage in progress named). */
  function pauseChoices(roadmap) {
    const at = scopeIndex(roadmap) >= 0 ? scopeIndex(roadmap) : currentStage(roadmap);
    // a cut line held before the stage: "after this stage" pauses at once (src/roadmap.js pauseAfterStage)
    const now = at < 0 || pendingRelease(roadmap, at);
    return [
      { after: 'stage', label: 'Pause after this stage', hint: !now ?`The items of stage ${at + 1} still start and finish; the next stage waits` : 'No stage is in progress: the roadmap pauses now' },
      { after: 'now', label: 'Pause now', hint: 'Nothing new starts; runs in progress go on' },
    ];
  }

  /** The items still to finish in the enabled stages, in order (a disabled stage's are not work left). */
  const unfinishedItems = (roadmap) => stagesOf(roadmap).filter((s) => !s.disabled).flatMap(itemsOf).filter((x) => !isFinished(x));

  /** A stage's counts: total items, done (merged), finished (done or skipped). */
  function stageProgress(stage) {
    const items = itemsOf(stage);
    return { total: items.length, done: items.filter((x) => x.status === 'done').length, finished: items.filter(isFinished).length };
  }

  /** #196: an item that could not start (an error and no run), not finished. */
  const refusedStart = (item) => !!item && !item.runId && !!item.error && !isFinished(item);

  const yes = () => ({ allowed: true, reason: '' });
  const no = (reason) => ({ allowed: false, reason });

  function roadmapActions(r, stage) {
    const state = r?.state;
    const empty = !stagesOf(r).length;
    const runStage = () => {
      if (stage.disabled) return no('This stage is disabled: enable it first');
      if (state === 'running') return no('The roadmap is running: pause or stop it first');
      return itemsOf(stage).some((x) => x.status === 'planned') ? yes() : no('No planned item in this stage');
    };
    const start = () => {
      if (empty) return no('The roadmap has no stage: add items first.');
      if (state === 'running') return no('The roadmap is already running.');
      if (state === 'paused') return no('The roadmap is paused: resume it.');
      return yes();
    };
    return {
      start: stage ? runStage() : start(),
      resume: state !== 'paused' ? no('The roadmap is not paused.') : empty ? no('The roadmap has no stage: add items first.') : yes(),
      pause: state === 'running' ? yes() : no('The roadmap is not running.'),
      stop: state === 'running' || state === 'paused' ? yes() : no('The roadmap is not running or paused.'),
    };
  }

  function stageActions(r, stage) {
    if (!stage) return { disable: no('No stage given.'), enable: no('No stage given.'), parkStage: no('No stage given.'), pauseStage: no('No stage given.'), stopStage: no('No stage given.') };
    const busy = itemsOf(stage).some((x) => x.status === 'running');
    // #395: its items at a gate are parked and its planned ones not started skipped; never while a turn runs
    const parkStage = () => {
      if (stage.disabled) return no('This stage is disabled: enable it first');
      if (itemsOf(stage).some((x) => x.status === 'running' && !x.waiting)) {
        return no('An agent turn or a command of this stage is running: use "Pause after current step", or move on once it waits at a gate.');
      }
      const work = itemsOf(stage).some((x) => atGate(x) || (x.status === 'planned' && !x.runId));
      return work ? yes() : no('Nothing of this stage waits at a gate or is still to start.');
    };
    // #368: its runs pause after their current turn and the roadmap pauses (no new item starts)
    const pauseStage = () => {
      if (r?.state === 'paused' && r.pausedStage === stage.id && !busy) return no('This stage is already paused.');
      if (busy || r?.state === 'running') return yes();
      return no('Nothing of this stage is running and the roadmap is not running.');
    };
    return {
      disable: stage.disabled ? no('This stage is already disabled.') : busy ? no('An item of this stage is running: wait for it, or stop its run') : yes(),
      enable: stage.disabled ? yes() : no('This stage is already enabled.'),
      parkStage: parkStage(),
      pauseStage: pauseStage(),
      // #412: Stop cancels its runs in progress (the roadmap pauses on them, Resume / Retry / Skip)
      stopStage: busy ? yes() : no('No run of this stage is in progress.'),
    };
  }

  const LOCKED = {
    done: 'This item is done: its run merged.',
    parked: 'The roadmap moved on: its run still waits at its gate for you.',
    paused: 'Its run is paused: Resume continues it where it stopped.',
    running: 'Its run is in progress.',
    skipped: 'This item was skipped.',
  };

  function itemActions(r, item) {
    if (!item) return { edit: no('No item given.'), move: no('No item given.'), park: no('No item given.'), retry: no('No item given.'), skip: no('No item given.') };
    // only planned or failed items change: a running, done or skipped item keeps what its run used
    const editable = item.status === 'planned' || item.status === 'failed';
    const locked = editable ? yes() : no(LOCKED[item.status] || 'This item cannot change now.');
    // #196: Retry / Skip on a failed run and on a refused start (the item that paused the roadmap, or an
    // error without a run, e.g. kept work of an ended run), never while its run is alive
    // a paused run (#368) is not a failure: only the roadmap's Resume continues it
    const failed = item.status === 'failed' || (!['paused', 'running'].includes(item.status) && (r?.pausedBy === item.id || refusedStart(item)));
    const fix = failed ? yes() : no(item.status === 'running' ? 'Its run is in progress: stop the run first.' : LOCKED[item.status] || 'Nothing failed: the item has not failed.');
    // #395: Move on only past a human gate; the gate stays the owner's (nothing answers it)
    const park = atGate(item) ? yes() : no(item.status === 'parked' ? LOCKED.parked
      : item.status === 'running' ? 'Its run is in an agent turn or a command: Move on works once it waits at a human gate.'
        : 'Its run is not waiting at a human gate.');
    return { edit: locked, move: locked, park, retry: fix, skip: fix };
  }

  /**
   * Which owner actions apply to the roadmap, a stage of it and an item of that stage, each
   * { allowed, reason } (the reason says why when it is refused). See the header for the actions.
   */
  function allowedActions(roadmap, stage = null, item = null) {
    return { ...roadmapActions(roadmap, stage), ...stageActions(roadmap, stage), ...itemActions(roadmap, item) };
  }

  /** Every run of an item: its earlier ones (`runs`), then the one that holds its status (`runId`). */
  const itemRuns = (x) => [...(x.runs || []), x.runId].filter(Boolean);
  /** #384: an item's earlier runs (a resumed or retried run), oldest first: its runs but the one that holds its status. */
  const earlierRuns = (x) => (x?.runId ? [...new Set(x.runs || [])].filter((id) => id !== x.runId) : []);

  // The releases the Roadmap knows (#291; `data.releases`: the service's roadmapReleases), each with
  // `at`: the stage it follows (its cut line's, else the last stage with a run in it; -1: none) and
  // `cut` (it has a cut line).
  function roadmapReleases(r, data) {
    const list = (data?.releases?.releases || []).filter((x) => x?.version).map((x) => ({ ...x, cut: false, at: -1 }));
    r.stages.forEach((stage, s) => {
      const line = stage.release;
      const x = line?.runId && list.find((y) => y.version === line.name);
      if (!x) return;
      x.runId = x.runId || line.runId;
      x.cut = true;
      x.at = s;
    });
    for (const x of list.filter((y) => !y.cut)) {
      const runs = new Set(x.runs || []);
      x.at = r.stages.findLastIndex((stage) => stage.items.some((i) => itemRuns(i).some((id) => runs.has(id))));
    }
    return list;
  }

  /**
   * The Roadmap's Releases filter's choice (`wanted`: '' all, 'next' the next release, else a version):
   * { list, choice, shown (the releases drawn), runs (the run ids a chosen release narrows to, null: all), chosen }
   */
  function releaseView(r, data, wanted) {
    const list = roadmapReleases(r, data);
    const chosen = wanted && wanted !== 'next' ? list.find((x) => x.version === wanted) || null : null;
    const choice = chosen ? wanted : wanted === 'next' && list.length ? 'next' : '';
    if (!choice) return { list, choice, shown: list.filter((x) => x.at >= 0), runs: null, chosen: null };
    if (chosen) return { list, choice, shown: [chosen], runs: new Set(chosen.runs || []), chosen };
    // what merged since the last release: the done items' runs no shipped release holds
    const shipped = new Set(list.filter((x) => x.status === 'shipped').flatMap((x) => x.runs || []));
    const pending = list.filter((x) => x.status !== 'shipped');
    const runs = new Set([...r.stages.flatMap((s) => s.items).filter((i) => i.status === 'done').flatMap(itemRuns).filter((id) => !shipped.has(id)), ...pending.flatMap((x) => x.runs || [])]);
    return { list, choice, shown: pending, runs, chosen: null };
  }

  // ---- what the Roadmap view shows (#217, #268; moved from backlog-roadmap.js, #395) ----
  const DAY_MS = 24 * 60 * 60 * 1000;
  // the date ranges: [id, the option, in the header's count, its length in ms (null: no limit)]
  const SINCE = [
    ['24h', 'Last 24 hours', 'last 24 hours', DAY_MS],
    ['2d', 'Last 2 days', 'last 2 days', 2 * DAY_MS],
    ['3d', 'Last 3 days', 'last 3 days', 3 * DAY_MS],
    ['1w', 'Last week', 'last week', 7 * DAY_MS],
    ['15d', 'Last 15 days', 'last 15 days', 15 * DAY_MS],
    ['1m', 'Last month', 'last month', 30 * DAY_MS],
    ['total', 'Total', 'all time', null],
  ];
  const toMs = (ts) => { const t = Date.parse(ts || ''); return Number.isFinite(t) ? t : null; };
  // An item's last activity: the latest of when it joined the roadmap (`origin`), its run's start and
  // its run's end; a run in progress is active now. An item without any date is in every range.
  function inRange(x, rangeMs, now) {
    if (rangeMs == null || x.status === 'running' || x.waiting) return true;
    const at = [x.origin, x.run?.startedAt, x.run?.finishedAt].map(toMs).filter((t) => t != null);
    return !at.length || Math.max(...at) >= now - rangeMs;
  }
  // the cards a visible stage draws (its folded items only when its "+n done" chip is unfolded)
  const cardCount = (x) => x.items.length + (x.open ? x.folded.length : 0);
  const PAGE_STAGES = 15;
  const PAGE_ITEMS = 60;
  const LEAD_STAGES = 2; // the first page starts this many stages before the current one
  /**
   * The page of the visible stages to draw: from LEAD_STAGES before the current stage (so it is in
   * the first page however long the finished history is), PAGE_STAGES stages or PAGE_ITEMS cards per
   * page (a longer stage is cut: `cut`, its first cards). `pages`: { more, earlier } pages drawn
   * around the first. → { drawn, earlier (visible stages above the page), more (something is left below it) }
   */
  function pageOf(list, current, pages) {
    const at = Math.max(0, list.findIndex((x) => x.s >= current));
    const base = Math.max(0, at - LEAD_STAGES);
    const start = Math.max(0, base - pages.earlier * PAGE_STAGES);
    let stagesLeft = PAGE_STAGES * (1 + pages.more);
    let cardsLeft = PAGE_ITEMS * (1 + pages.more);
    const drawn = list.slice(start, base);
    let more = false;
    for (let k = base; k < list.length && !more; k++) {
      const cards = cardCount(list[k]);
      if (stagesLeft <= 0 || cardsLeft <= 0) more = true;
      else if (cards > cardsLeft) { drawn.push({ ...list[k], cut: cardsLeft }); more = true; } else drawn.push(list[k]);
      stagesLeft -= 1;
      cardsLeft -= cards;
    }
    return { drawn, earlier: start, more };
  }

  /** An item's issues: its `issues` list, or (an item stored before #163) the item itself as one issue. */
  function itemIssues(x) {
    if (x?.issues?.length) return x.issues;
    return x?.number ? [{ number: x.number, url: x.url, title: x.title, body: x.body, knownPullRequests: x.knownPullRequests }] : [];
  }

  const api = {
    ACTIONS,
    FINISHED,
    ITEM_STATES,
    SINCE,
    STATES,
    allowedActions,
    atGate,
    cardCount,
    currentStage,
    earlierRuns,
    hasUnfinished,
    inRange,
    isFinished,
    isOpen,
    itemIssues,
    itemRuns,
    pageOf,
    pauseChoices,
    pausingAfterStage,
    pendingRelease,
    refusedStart,
    releaseView,
    scopedStage,
    stageProgress,
    unfinishedItems,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoadmapModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
