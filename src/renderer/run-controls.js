// The Run screen tab row's Stop and Pause (#368, #412) for the run it shows: stopRun, pauseRun (its
// buttons' clicks, wired by run.js's mount) and renderRunControls (their state, from renderRunScreen);
// stopRuns, the roadmap stage menu's Stop (#412). Moved out of app.js; uses app.js globals (api,
// state, confirmDialog, errMsg, scheduleRender, selectedView, showToast) and runLabel (run-meta.js),
// all read when called, never as it loads.

// Stops the run the Run screen shows (only that one).
async function stopRun() {
  const r = state.run;
  if (r?.status !== 'running') return;
  // a run past a human gate holds work the owner already approved: always ask (#112)
  const passed = ((await api.listActiveRuns().catch(() => [])) || []).find((x) => x.runId === r.id)?.passedGates || [];
  const why = passed.length ? `It has already passed the human gate${passed.length > 1 ? 's' : ''} ${passed.join(', ')}: a new run would redo that work. ` : '';
  // its `type: workflow` steps' child runs in progress stop with it: always ask (#175)
  const kids = (r.childRuns || []).filter((c) => c.run_id && c.status === 'running');
  const children = kids.length ? `Its ${kids.length} child run${kids.length > 1 ? 's' : ''} in progress (${kids.map((c) => c.label || c.run_id).join(', ')}) will be stopped too; resuming this run resumes them. ` : '';
  if ((state.settings.confirmStop || passed.length || kids.length) && !(await confirmDialog('Stop workflow', `${why}${children}Running sessions of ${runLabel(r)} will be closed. Stop this run?`, 'Stop'))) return;
  api.stopRun(r.id);
}

// #412: stops several runs (a roadmap stage's live runs), naming them first; false when not confirmed.
// The engine marks each cancelled item failed and pauses the roadmap (Resume / Retry / Skip).
async function stopRuns(runIds, what) {
  if (!runIds.length) return false;
  const many = runIds.length > 1;
  if (!(await confirmDialog(`Stop ${what}`, `${many ? `Its ${runIds.length} runs` : 'Its run'} in progress (${runIds.join(', ')}) will be stopped and ${many ? 'their' : 'its'} running sessions closed. No gate is answered.`, 'Stop'))) return false;
  for (const id of runIds) await api.stopRun(id).catch((e) => showToast('Could not stop the run', `${id}: ${errMsg(e)}`));
  return true;
}

// #368: pauses the run the Run screen shows after its current turn: its agents finish their turns
// (a step command its run), nothing new starts, then it ends paused; the Run screen's pause line
// says what it waits for and offers Cancel pause. Nothing is lost, so it never asks first.
async function pauseRun() {
  const r = state.run;
  if (r?.status !== 'running' || r.pause) return;
  try {
    await api.pauseRun(r.id);
    if (r.status === 'running' && !r.pause) r.pause = { state: 'pausing', at: new Date().toISOString() };
    scheduleRender();
  } catch (e) {
    showToast('Could not pause the run', errMsg(e));
  }
}

// Stop while the run goes; Pause (#368) while it goes and is not pausing already (the Run screen's
// pause line then has Cancel pause); neither on a past run's view (#412: hidden, not disabled).
function renderRunControls(r) {
  const running = r?.status === 'running' && !selectedView().past;
  $('#btn-stop').classList.toggle('hidden', !running);
  $('#btn-stop').title = running ? `Stop ${runLabel(r)} (only this run)` : '';
  const pausable = running && !r.pause;
  $('#btn-pause').classList.toggle('hidden', !pausable);
  $('#btn-pause').title = pausable ? `Pause ${runLabel(r)} once its agents finish their current turn: nothing is cut, Resume continues there` : '';
}
