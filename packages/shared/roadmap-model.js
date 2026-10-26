// Roadmap model (#349): the roadmap's rules, pure (no DOM, no files, never changes what it is given).
// The states, what counts as finished, the current stage and which owner action applies where.
// packages/engine/domains/roadmap/roadmap.js (the only writer of a roadmap's state, pausedBy, scope and item statuses), the
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
// The Roadmap view's rules: releaseView (Planned: the latest release only, #425), the date ranges (SINCE, inRange) and its pages (pageOf).
// Any load order: read only when a screen draws.
/** An item's status, ITEM_STATES as a type (#346): the file stores planned, done, parked or skipped.
 * @typedef {'done' | 'failed' | 'parked' | 'paused' | 'planned' | 'running' | 'skipped'} RoadmapItemStatus */
(function (root) {
  const node = typeof module === 'object' && module.exports;
  // the catalog's helper (#330), at call time: the reasons are in the interface language
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
  // planned: edited, never started by itself · running · paused (a failure, the owner, a proposal) · done
  const STATES = ['done', 'paused', 'planned', 'running'];
  // paused (#368): its run ended paused after its current turn; the roadmap's Resume continues it
  // parked (#395): the owner (or the Night watch) moved on while its run waits at a human gate
  const ITEM_STATES = ['done', 'failed', 'parked', 'paused', 'planned', 'running', 'skipped'];
  // an item done (merged), skipped (the owner, or every issue closed) or parked counts as finished
  const FINISHED = new Set(['done', 'parked', 'skipped']);
  // an item whose run still changes (#491): its live run is in the light backlog:state
  const LIVE_ITEM_STATES = new Set(['parked', 'running']);
  const ACTIONS = ['disable', 'edit', 'enable', 'move', 'park', 'parkStage', 'pause', 'pauseStage', 'resume', 'retry', 'skip', 'start', 'stop'];

  // #395: a parked item (`parked`: { at, gate }) whose gate was answered later and whose run then
  // failed is finished too: the roadmap moved past it, so it never holds its stage or pauses the roadmap
  const isFinished = (item) => !!item && (FINISHED.has(item.status) || (item.status === 'failed' && !!item.parked));
  /** #395: an item whose run waits at a human gate (live: running and waiting; interrupted by a closed app: its run waits). */
  const atGate = (item) => !!item && ((item.status === 'running' && !!item.waiting) || (item.status === 'failed' && !!item.runId && !!item.run?.atGate));
  const stagesOf = (roadmap) => (roadmap && Array.isArray(roadmap.stages) ? roadmap.stages : []);
  const itemsOf = (stage) => (stage && Array.isArray(stage.items) ? stage.items : []);
  /**
   * #555: a release (a cut line, #260) is its own entry of the roadmap's list, between two stages:
   * { kind: 'release', id, name, status?, runId?, shippedAt? } with no items of its own. It is never a
   * stage: never open, never current, and not counted in the stage numbers ("Stage N").
   */
  const isRelease = (entry) => !!entry && entry.kind === 'release';
  /** #555: the number "Stage N" of the stage at index `s` of the list (the release entries before it do not count). */
  const stageNumber = (roadmap, s) => stagesOf(roadmap).slice(0, s + 1).filter((x) => !isRelease(x)).length;
  /**
   * #555: a list whose stages carry their cut line (`release`, as written before #555 and as the
   * Roadmap screen saves it): each becomes a release entry right after its stage, every release entry
   * with an empty `items`. Its id is kept; a new one has none (the service gives it one), except when
   * `migrate` reads a file written before #555: `release-<stage id>`, the same on every read.
   */
  const releaseEntries = (stages, { migrate = false } = {}) => (Array.isArray(stages) ? stages.flatMap((s) => {
    if (isRelease(s)) return [{ ...s, items: [] }];
    if (!s || !s.release) return [s];
    const { release, ...stage } = s;
    if (!String(release.name || '').trim()) return [stage];
    return [stage, { ...release, kind: 'release', id: release.id || (migrate && stage.id ? `release-${stage.id}` : null), items: [] }];
  }) : stages);
  /**
   * #555: the roadmap as the Roadmap screen draws and edits it: each release entry back on the stage
   * before it (`release`, the stage's cut line), so the stage indexes are the stage numbers; one that
   * follows no stage of its own (first, or right after another release) kept in `leadReleases` with
   * `after`: the index of the stage before it (-1: the roadmap's start). unfoldReleases puts them back.
   */
  function foldReleases(roadmap) {
    if (!roadmap) return roadmap;
    const stages = [];
    const leadReleases = [];
    for (const e of releaseEntries(stagesOf(roadmap), { migrate: true })) {
      const before = stages.at(-1);
      if (!isRelease(e)) stages.push(e);
      else if (before && !before.release) stages[stages.length - 1] = { ...before, release: (({ kind: _k, items: _i, ...rel }) => rel)(e) };
      else leadReleases.push({ ...e, after: stages.length - 1 });
    }
    return { ...roadmap, stages, leadReleases };
  }
  /** #555: the list a save sends: the folded `stages`, each of `leadReleases` back after the stage it followed (by index, as the cut lines). */
  function unfoldReleases(leadReleases, stages) {
    const lead = (s) => (leadReleases || []).filter((e) => Math.min(e.after, stages.length - 1) === s).map(({ after: _a, ...e }) => e);
    return [...lead(-1), ...stages.flatMap((stage, s) => [stage, ...lead(s)])];
  }
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
   * #552: index of the stage whose run is in progress (an item `running`, not waiting at a human gate:
   * #395 counts that one as finished), the later one when two stages have one; -1 when nothing runs.
   * The screen's highlight; currentStage still decides what the automation starts next.
   */
  const runningStage = (roadmap) => stagesOf(roadmap).findLastIndex((s) => !s.disabled && itemsOf(s).some((x) => x.status === 'running' && !x.waiting));

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
   * The first release entry (#260, #555) the roadmap reached and that has not shipped: one before stage
   * `at` (the whole list when `at` < 0: the roadmap is over), every enabled stage before it finished.
   * A disabled stage (#284) before it is skipped and does not hold it: the release stays.
   */
  function pendingRelease(roadmap, at) {
    const stages = stagesOf(roadmap);
    const reached = at < 0 ? stages : stages.slice(0, at);
    return reached.find((s) => isRelease(s) && s.status !== 'shipped') || null;
  }
  /** #391: the roadmap bar's two pauses, the default first ([{ after, label, hint }]; the stage in progress named). */
  function pauseChoices(roadmap) {
    const at = scopeIndex(roadmap) >= 0 ? scopeIndex(roadmap) : currentStage(roadmap);
    // a cut line held before the stage: "after this stage" pauses at once (packages/engine/domains/roadmap/roadmap.js pauseAfterStage)
    const now = at < 0 || pendingRelease(roadmap, at);
    return [
      { after: 'stage', label: t('roadmap.pause_after_stage'), hint: now ? t('roadmap.pause_after_stage_now') : t('roadmap.pause_after_stage_hint', { stage: stageNumber(roadmap, at) }) },
      { after: 'now', label: t('roadmap.pause_now'), hint: t('roadmap.pause_now_hint') },
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
      if (stage.disabled) return no(t('roadmap.stage_disabled'));
      if (state === 'running') return no(t('roadmap.running_pause_or_stop'));
      return itemsOf(stage).some((x) => x.status === 'planned') ? yes() : no(t('roadmap.no_planned_item'));
    };
    const start = () => {
      if (empty) return no(t('roadmap.no_stage'));
      if (state === 'running') return no(t('roadmap.already_running'));
      if (state === 'paused') return no(t('roadmap.paused_resume_it'));
      return yes();
    };
    return {
      start: stage ? runStage() : start(),
      resume: state !== 'paused' ? no(t('roadmap.not_paused')) : empty ? no(t('roadmap.no_stage')) : yes(),
      pause: state === 'running' ? yes() : no(t('roadmap.not_running')),
      stop: state === 'running' || state === 'paused' ? yes() : no(t('roadmap.not_running_or_paused')),
    };
  }

  function stageActions(r, stage) {
    if (!stage) {
      const none = no(t('roadmap.no_stage_given'));
      return { disable: none, enable: none, parkStage: none, pauseStage: none, stopStage: none };
    }
    const busy = itemsOf(stage).some((x) => x.status === 'running');
    // #395: its items at a gate are parked and its planned ones not started skipped; never while a turn runs
    const parkStage = () => {
      if (stage.disabled) return no(t('roadmap.stage_disabled'));
      if (itemsOf(stage).some((x) => x.status === 'running' && !x.waiting)) return no(t('roadmap.stage_turn_running'));
      const work = itemsOf(stage).some((x) => atGate(x) || (x.status === 'planned' && !x.runId));
      return work ? yes() : no(t('roadmap.stage_nothing_at_gate'));
    };
    // #368: its runs pause after their current turn and the roadmap pauses (no new item starts)
    const pauseStage = () => {
      if (r?.state === 'paused' && r.pausedStage === stage.id && !busy) return no(t('roadmap.stage_already_paused'));
      if (busy || r?.state === 'running') return yes();
      return no(t('roadmap.stage_nothing_running'));
    };
    return {
      disable: stage.disabled ? no(t('roadmap.stage_already_disabled')) : busy ? no(t('roadmap.stage_item_running')) : yes(),
      enable: stage.disabled ? yes() : no(t('roadmap.stage_already_enabled')),
      parkStage: parkStage(),
      pauseStage: pauseStage(),
      // #412: Stop cancels its runs in progress (the roadmap pauses on them, Resume / Retry / Skip)
      stopStage: busy ? yes() : no(t('roadmap.stage_no_run')),
    };
  }

  // the item states whose item is locked: their reason's key, read when asked (the interface language)
  const LOCKED = {
    done: 'roadmap.locked_done',
    parked: 'roadmap.locked_parked',
    paused: 'roadmap.locked_paused',
    running: 'roadmap.locked_running',
    skipped: 'roadmap.locked_skipped',
  };
  const lockedReason = (status, fallback) => t(LOCKED[status] || fallback);

  function itemActions(r, item) {
    if (!item) {
      const none = no(t('roadmap.no_item_given'));
      return { edit: none, move: none, park: none, retry: none, skip: none };
    }
    // only planned or failed items change: a running, done or skipped item keeps what its run used
    const editable = item.status === 'planned' || item.status === 'failed';
    const locked = editable ? yes() : no(lockedReason(item.status, 'roadmap.item_cannot_change'));
    // #196: Retry / Skip on a failed run and on a refused start (the item that paused the roadmap, or an
    // error without a run, e.g. kept work of an ended run), never while its run is alive
    // a paused run (#368) is not a failure: only the roadmap's Resume continues it
    const failed = item.status === 'failed' || (!['paused', 'running'].includes(item.status) && (r?.pausedBy === item.id || refusedStart(item)));
    const fix = failed ? yes() : no(item.status === 'running' ? t('roadmap.item_running_stop_first') : lockedReason(item.status, 'roadmap.item_not_failed'));
    // #395: Move on only past a human gate; the gate stays the owner's (nothing answers it)
    const park = atGate(item) ? yes() : no(t(item.status === 'parked' ? LOCKED.parked
      : item.status === 'running' ? 'roadmap.item_in_turn' : 'roadmap.item_not_at_gate'));
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
  // `at`: the index of the stage it is drawn after, among the stages only (#555: its release entry,
  // planned or not, 0 for one before every stage; else the last stage with a run in it; -1: none),
  // `cut` (it has a release entry, `entry`: its id) and `closes` (#555: the stages since the previous
  // release entry, [{ name, number }]).
  function roadmapReleases(r, data) {
    const list = (data?.releases?.releases || []).filter((x) => x?.version).map((x) => ({ ...x, cut: false, at: -1 }));
    const entries = { stages: releaseEntries(stagesOf(r), { migrate: true }) };
    let from = 0;
    entries.stages.forEach((entry, s) => {
      if (!isRelease(entry)) return;
      const closes = entries.stages.slice(from, s).flatMap((x, k) => (isRelease(x) ? [] : [{ name: x.name || '', number: stageNumber(entries, from + k) }]));
      from = s + 1;
      const x = list.find((y) => !y.cut && y.version === entry.name);
      if (x) Object.assign(x, { runId: x.runId || entry.runId || null, cut: true, entry: entry.id, at: Math.max(0, stageNumber(entries, s) - 1), closes });
    });
    const stages = entries.stages.filter((x) => !isRelease(x));
    for (const x of list.filter((y) => !y.cut)) {
      const runs = new Set(x.runs || []);
      x.at = stages.findLastIndex((stage) => itemsOf(stage).some((i) => itemRuns(i).some((id) => runs.has(id))));
    }
    return list;
  }

  /**
   * The Roadmap's Releases filter's choice (`wanted`: '' all, 'next' the next release, else a version):
   * { list, choice, shown (the releases drawn), runs (the run ids a chosen release narrows to, null: all), chosen }
   * #425: with no choice, Planned (`showAll` false) draws only the latest placed release with a run (greatest `at`), All every one;
   * #555: the planned releases (no run yet) are drawn in both.
   */
  function releaseView(r, data, wanted, showAll) {
    const list = roadmapReleases(r, data);
    const chosen = wanted && wanted !== 'next' ? list.find((x) => x.version === wanted) || null : null;
    const choice = chosen ? wanted : wanted === 'next' && list.length ? 'next' : '';
    const placed = list.filter((x) => x.at >= 0);
    const latest = placed.filter((x) => x.status !== 'planned').reduce((a, x) => (!a || x.at > a.at ? x : a), null);
    if (!choice) return { list, choice, shown: showAll ? placed : placed.filter((x) => x === latest || x.status === 'planned'), runs: null, chosen: null };
    if (chosen) return { list, choice, shown: [chosen], runs: new Set(chosen.runs || []), chosen };
    // what merged since the last release: the done items' runs no shipped release holds
    const shipped = new Set(list.filter((x) => x.status === 'shipped').flatMap((x) => x.runs || []));
    const pending = list.filter((x) => x.status !== 'shipped');
    const runs = new Set([...stagesOf(r).flatMap(itemsOf).filter((i) => i.status === 'done').flatMap(itemRuns).filter((id) => !shipped.has(id)), ...pending.flatMap((x) => x.runs || [])]);
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
   * around the first. #552 `next`: the first open stage when it is before the running `current` one,
   * the page starts from it instead when both fit on it. → { drawn, earlier (visible stages above the page), more (something is left below it) }
   */
  function pageOf(list, current, pages, next = -1) {
    const index = (s) => Math.max(0, list.findIndex((x) => x.s >= s));
    const at = index(current);
    const from = next >= 0 && next < current && at - index(next) < PAGE_STAGES - LEAD_STAGES ? index(next) : at;
    const base = Math.max(0, from - LEAD_STAGES);
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

  // #426: the stage nearest to `s` towards `dir` (-1 up, 1 down) among those the view draws
  // (`drawn`: their real indexes; every stage when absent), or -1 when none is drawn on that side
  function drawnNeighbour(stages, s, dir, drawn) {
    const side = (drawn || stages.map((_, i) => i)).filter((i) => i < stages.length && (dir < 0 ? i < s : i > s));
    return side.length ? (dir < 0 ? Math.max(...side) : Math.min(...side)) : -1;
  }

  // #426: "Run earlier / later" moves stage `s` just before the previous / just after the next drawn
  // stage (the hidden ones in between keep their order), to the roadmap's start / end when none is
  // drawn on that side. Changes `stages`; returns the stage's new index, -1 when it cannot move.
  // #555: on the folded stages, the cut lines (`release`) stay where they are
  function moveStage(stages, s, dir, drawn) {
    const near = drawnNeighbour(stages, s, dir, drawn);
    const to = near >= 0 ? near : dir < 0 ? 0 : stages.length - 1;
    if (!stages[s] || to === s) return -1;
    const cuts = stages.map((st) => st.release);
    stages.splice(to, 0, ...stages.splice(s, 1));
    stages.forEach((st, i) => { if (cuts[i]) st.release = cuts[i]; else delete st.release; });
    return to;
  }

  // #555: on the folded stages, the cut line of stage `s` moves onto the stage before (dir -1) or after
  // (1) it, when that one has none. Changes `stages`; returns the release's name, null when it cannot move.
  function moveRelease(stages, s, dir) {
    const [from, onto] = [stages[s], stages[s + dir]];
    if (!from?.release || !onto || onto.release) return null;
    onto.release = from.release;
    delete from.release;
    return onto.release.name;
  }

  // #552: the highlight. A stage run on its own (#141) is current; else the running stage, and the first
  // open one (never a disabled one, #284) is `next` when it is another; nothing running: the first open one
  function highlight(r) {
    const [scoped, first] = [scopedStage(r), currentStage(r)];
    const running = scoped >= 0 ? -1 : runningStage(r);
    if (scoped >= 0) return { scoped, current: scoped, next: -1 };
    return running < 0 ? { scoped, current: first, next: -1 } : { scoped, current: running, next: first !== running ? first : -1 };
  }

  const api = {
    ACTIONS,
    FINISHED,
    ITEM_STATES,
    LIVE_ITEM_STATES,
    SINCE,
    STATES,
    allowedActions,
    atGate,
    cardCount,
    currentStage,
    drawnNeighbour,
    earlierRuns,
    foldReleases,
    hasUnfinished,
    highlight,
    inRange,
    isFinished,
    isOpen,
    isRelease,
    itemIssues,
    itemRuns,
    moveRelease,
    moveStage,
    pageOf,
    pauseChoices,
    pausingAfterStage,
    pendingRelease,
    refusedStart,
    releaseEntries,
    releaseView,
    runningStage,
    scopedStage,
    stageNumber,
    stageProgress,
    unfinishedItems,
    unfoldReleases,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoadmapModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
