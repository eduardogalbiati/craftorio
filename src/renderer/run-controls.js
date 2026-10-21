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
  const why = passed.length ? t('run_controls.passed_human_gates', { count: passed.length, gates: passed.join(', ') }) : '';
  // its `type: workflow` steps' child runs in progress stop with it: always ask (#175)
  const kids = (r.childRuns || []).filter((c) => c.run_id && c.status === 'running');
  const children = kids.length ? t('run_controls.child_runs_will_stop', { count: kids.length, runs: kids.map((c) => c.label || c.run_id).join(', ') }) : '';
  if ((state.settings.confirmStop || passed.length || kids.length) && !(await confirmDialog(t('run_controls.stop_workflow'), t('run_controls.why_children_running_sessions_of_r', { why, children, r: runLabel(r) }), t('run_controls.stop')))) return;
  api.stopRun(r.id);
}

// #412: stops several runs (a roadmap stage's live runs), naming them first; false when not confirmed.
// The engine marks each cancelled item failed and pauses the roadmap (Resume / Retry / Skip).
async function stopRuns(runIds, what) {
  if (!runIds.length) return false;
  if (!(await confirmDialog(t('run_controls.stop_what', { what }), t('run_controls.runs_will_stop_no_gate', { count: runIds.length, runs: runIds.join(', ') }), t('run_controls.stop')))) return false;
  for (const id of runIds) await api.stopRun(id).catch((e) => showToast(t('run_controls.could_not_stop_the_run'), `${id}: ${errMsg(e)}`));
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
    showToast(t('run_controls.could_not_pause_the_run'), errMsg(e));
  }
}

// Stop while the run goes; Pause (#368) while it goes and is not pausing already (the Run screen's
// pause line then has Cancel pause); neither on a past run's view (#412: hidden, not disabled).
function renderRunControls(r) {
  const running = r?.status === 'running' && !selectedView().past;
  $('#btn-stop').classList.toggle('hidden', !running);
  $('#btn-stop').title = running ? t('run_controls.stop_r_only_this_run', { r: runLabel(r) }) : '';
  const pausable = running && !r.pause;
  $('#btn-pause').classList.toggle('hidden', !pausable);
  $('#btn-pause').title = pausable ? t('run_controls.pause_r_once_its_agents_finish', { r: runLabel(r) }) : '';
}
