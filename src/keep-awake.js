// Keep awake (#162): while the setting is on (settings.keepAwake, per workspace, off by default)
// and the app has work to do, the computer is kept from sleeping, so an overnight run or roadmap
// is not interrupted. No Electron here: src/main.js passes Electron's powerSaveBlocker (tests a
// fake one) and the service's pendingWork() (src/service/areas/keep-awake.js).
// - workToDo(work): the rule that decides "work to do", from the runs in progress
//   ({ waiting }), the roadmaps ({ state, stage, of, disabled? }) and the queued items not paused. A
//   running run counts; a run waiting at a gate counts only when a roadmap or a queue continues after it.
// - keepAwakeLabel(state): what the switch shows ("Active: 2 runs, roadmap stage 3/6"; with disabled
//   stages (#284), "roadmap stage 3/6 (1 disabled)").
// - createKeepAwake({ blocker, enabled, readWork, onChange }): update() starts or stops the
//   blocker and returns the state; stop() releases it (switch off, quit). 'prevent-app-suspension'
//   only: the display may still turn off, and the owner's power plan, Sleep and the lid still win.

const BLOCKER_TYPE = 'prevent-app-suspension';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Whether there is work to keep the computer awake for, and what it is. */
function workToDo({ runs = [], roadmaps = [], queued = 0 } = {}) {
  const running = runs.filter((r) => !r.waiting).length;
  const waiting = runs.length - running;
  const started = roadmaps.filter((r) => r.state === 'running')
    .map((r) => ({ projectId: r.projectId || null, stage: Number(r.stage) || 0, of: Number(r.of) || 0, ...(Number(r.disabled) > 0 ? { disabled: Number(r.disabled) } : {}) }));
  const queue = Math.max(0, Math.floor(Number(queued) || 0));
  // a run at a gate keeps nothing busy on its own; it does when a roadmap or a queue goes on after it
  const continues = started.length > 0 || queue > 0;
  return {
    active: running > 0 || continues,
    runs: running + (continues ? waiting : 0),
    running,
    waiting,
    roadmaps: started,
    queued: queue,
  };
}

/** The switch's status line: Off, "On: waiting for work", or what keeps the computer awake. */
function keepAwakeLabel({ enabled, holding, work } = {}) {
  if (!enabled) return 'Off';
  if (!work?.active) return 'On: waiting for work';
  const parts = [];
  if (work.runs) parts.push(plural(work.runs, 'run'));
  const [one, ...more] = work.roadmaps || [];
  // #284: a disabled stage is in the total and never the current one; said apart
  if (one && !more.length) parts.push(one.of && one.stage ? `roadmap stage ${one.stage}/${one.of}${one.disabled ? ` (${one.disabled} disabled)` : ''}` : 'roadmap');
  if (more.length) parts.push(plural(more.length + 1, 'roadmap'));
  if (work.queued) parts.push(`${work.queued} queued`);
  return `${holding ? 'Active' : 'On'}: ${parts.join(', ')}`;
}

/**
 * The blocker's owner. `blocker` is { start(type) -> id, stop(id), isStarted(id) } (Electron's
 * powerSaveBlocker); `enabled()` reads the setting; `readWork()` the work in progress (see
 * workToDo); `onChange(state)` is called when the state changes. A failed start leaves the switch
 * on with `error` set and is tried again at the next update.
 */
function createKeepAwake({ blocker, enabled, readWork, onChange = () => {} }) {
  let id = null;
  let on = false;
  let error = null;
  let work = workToDo();
  let last = '';

  const holding = () => id !== null && !!blocker.isStarted(id);

  function state() {
    const s = { available: true, enabled: on, holding: holding(), work, error };
    return { ...s, label: keepAwakeLabel(s) };
  }

  function release() {
    if (id === null) return;
    try { if (blocker.isStarted(id)) blocker.stop(id); } catch (e) { console.error('keep awake:', e.message); }
    id = null;
  }

  function hold() {
    if (holding()) return;
    id = null;
    try {
      const started = blocker.start(BLOCKER_TYPE);
      if (blocker.isStarted(started)) { id = started; error = null; } else error = 'The system did not accept the request to stay awake.';
    } catch (e) {
      error = `Could not keep the computer awake: ${e.message}`;
    }
  }

  function update() {
    try { on = !!enabled(); } catch { on = false; }
    if (on) {
      try { work = workToDo(readWork()); } catch (e) { console.error('keep awake: reading the work in progress:', e.message); }
    } else work = workToDo();
    if (on && work.active) hold();
    else { release(); error = null; }
    const s = state();
    const key = JSON.stringify(s);
    if (key !== last) { last = key; onChange(s); }
    return s;
  }

  return { state, stop: release, update };
}

module.exports = {
  BLOCKER_TYPE,
  createKeepAwake,
  keepAwakeLabel,
  workToDo,
};
