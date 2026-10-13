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
//   pauseStage                   the stage's "Pause after current turn" (#368): its runs and the roadmap
//   edit, move                   the item's editor, drag and ↑/↓/Remove (only planned or failed items)
//   retry, skip                  the item that failed or could not start (#196), never a paused one
// Any load order: read only when a screen draws.
/** An item's status, ITEM_STATES as a type (#346): the file stores planned, done or skipped.
 * @typedef {'done' | 'failed' | 'paused' | 'planned' | 'running' | 'skipped'} RoadmapItemStatus */
(function (root) {
  // planned: edited, never started by itself · running · paused (a failure, the owner, a proposal) · done
  const STATES = ['done', 'paused', 'planned', 'running'];
  // paused (#368): its run ended paused after its current turn; the roadmap's Resume continues it
  const ITEM_STATES = ['done', 'failed', 'paused', 'planned', 'running', 'skipped'];
  // an item done (merged) or skipped (the owner, or every issue closed) counts as finished
  const FINISHED = new Set(['done', 'skipped']);
  const ACTIONS = ['disable', 'edit', 'enable', 'move', 'pause', 'pauseStage', 'resume', 'retry', 'skip', 'start', 'stop'];

  const isFinished = (item) => !!item && FINISHED.has(item.status);
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
  const scopedStage = (roadmap) => (roadmap?.scope ? stagesOf(roadmap).findIndex((s) => s.id === roadmap.scope.stage && isOpen(s)) : -1);

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
    if (!stage) return { disable: no('No stage given.'), enable: no('No stage given.'), pauseStage: no('No stage given.') };
    const busy = itemsOf(stage).some((x) => x.status === 'running');
    // #368: its runs pause after their current turn and the roadmap pauses (no new item starts)
    const pauseStage = () => {
      if (r?.state === 'paused' && r.pausedStage === stage.id && !busy) return no('This stage is already paused.');
      if (busy || r?.state === 'running') return yes();
      return no('Nothing of this stage is running and the roadmap is not running.');
    };
    return {
      disable: stage.disabled ? no('This stage is already disabled.') : busy ? no('An item of this stage is running: wait for it, or stop its run') : yes(),
      enable: stage.disabled ? yes() : no('This stage is already enabled.'),
      pauseStage: pauseStage(),
    };
  }

  const LOCKED = {
    done: 'This item is done: its run merged.',
    paused: 'Its run is paused: Resume continues it where it stopped.',
    running: 'Its run is in progress.',
    skipped: 'This item was skipped.',
  };

  function itemActions(r, item) {
    if (!item) return { edit: no('No item given.'), move: no('No item given.'), retry: no('No item given.'), skip: no('No item given.') };
    // only planned or failed items change: a running, done or skipped item keeps what its run used
    const editable = item.status === 'planned' || item.status === 'failed';
    const locked = editable ? yes() : no(LOCKED[item.status] || 'This item cannot change now.');
    // #196: Retry / Skip on a failed run and on a refused start (the item that paused the roadmap, or an
    // error without a run, e.g. kept work of an ended run), never while its run is alive
    // a paused run (#368) is not a failure: only the roadmap's Resume continues it
    const failed = item.status === 'failed' || (!['paused', 'running'].includes(item.status) && (r?.pausedBy === item.id || refusedStart(item)));
    const fix = failed ? yes() : no(item.status === 'running' ? 'Its run is in progress: stop the run first.' : LOCKED[item.status] || 'Nothing failed: the item has not failed.');
    return { edit: locked, move: locked, retry: fix, skip: fix };
  }

  /**
   * Which owner actions apply to the roadmap, a stage of it and an item of that stage, each
   * { allowed, reason } (the reason says why when it is refused). See the header for the actions.
   */
  function allowedActions(roadmap, stage = null, item = null) {
    return { ...roadmapActions(roadmap, stage), ...stageActions(roadmap, stage), ...itemActions(roadmap, item) };
  }

  const api = {
    ACTIONS,
    FINISHED,
    ITEM_STATES,
    STATES,
    allowedActions,
    currentStage,
    hasUnfinished,
    isFinished,
    isOpen,
    refusedStart,
    scopedStage,
    stageProgress,
    unfinishedItems,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoadmapModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
