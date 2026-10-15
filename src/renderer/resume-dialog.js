/* global api */
// Resume from step… (#74-#76, #112): the dialog that starts a finished, failed, cancelled or
// interrupted run again from one of its steps (openResumeDialog, on window: the Run screen's
// summary, the run lists, the run chat, Write & Review and the restart banner), canResume, and the
// step fields the supervisor's resume card shares (resumeFields, resumeEffects).

// Resume from step…: the owner restarts a finished, failed, cancelled or interrupted run from any
// step, with no supervisor analysis (runs:resume, the channel the recommendations use too). The
// service refuses a step past a human gate the run decided; every gate reached again asks again.
const canResume = (r) => !!r && !r.current && !['running', 'pending', 'waiting'].includes(r.status);

// The step select and the instruction, shared by the dialog and the supervisor's resume card.
// options: [{ id, label?, disabled? }]
function resumeFields(id, options, pre, instruction = '') {
  return `<div class="field"><label for="${id}-step">Resume from step</label>
      <select id="${id}-step">${options.map((o) => `<option value="${esc(o.id)}"${o.id === pre ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label || o.id)}</option>`).join('')}</select></div>
    <div class="field"><label for="${id}-ins">Instruction for the agents <span class="muted small">(optional)</span></label>
      <textarea id="${id}-ins" rows="4" placeholder="e.g. The app was restarted: go on with the same task.">${esc(instruction)}</textarea></div>`;
}

// A step as people read it (#245): its display name (o.steps[].display when the service gives it),
// else its id made readable; resumeStepHtml keeps the id in the tooltip.
function resumeStepName(o, id) {
  const display = o?.steps?.find((x) => x.id === id)?.display;
  return display || (typeof displayName === 'function' ? displayName(id) : String(id || ''));
}
const resumeStepHtml = (o, id) => `<b title="${esc(id)}">${esc(resumeStepName(o, id))}</b>`;

function resumeStepLabel(o, s) {
  const where = s.id === o.stoppedAt ? (o.status === 'failed' && s.id === o.failedStep ? 'failed here' : 'stopped here')
    : s.id === o.failedStep ? 'failed' : s.visits ? 'reached' : '';
  const after = s.blockedBy ? `after the decided gate ${resumeStepName(o, s.blockedBy)}${s.confirm?.ok ? ' (approve it again)' : s.confirm?.reason ? ` (${s.confirm.reason})` : ''}` : '';
  return [resumeStepName(o, s.id), s.gate ? 'human gate' : '', where, after].filter(Boolean).join(' · ');
}

// A step after a decided gate (#112): the owner may approve that gate again here, while the branch
// is still at the commit approved there; nothing else (supervisor, roadmap) ever does.
function resumeGateConfirm(o, stepId) {
  const s = o.steps.find((x) => x.id === stepId);
  if (!s?.blockedBy || !s.confirm?.ok) return '';
  const short = (c) => (c ? `<span class="mono">${esc(String(c).slice(0, 8))}</span>` : '');
  const commits = s.confirm.approvedCommit
    ? `Approved at commit ${short(s.confirm.approvedCommit)}; the branch is still at ${short(s.confirm.currentCommit)}.`
    : 'A simulation: no branch to compare.';
  return `<label class="check"><input type="checkbox" id="resume-confirm-gate" data-gate="${esc(s.blockedBy)}"> Approve ${resumeStepHtml(o, s.blockedBy)} again</label>
    <div class="muted small">${commits} It is recorded as your approval in the new run.</div>`;
}

// What the resume keeps and what runs again, for the chosen step.
function resumeEffects(o, stepId) {
  const at = o.steps.findIndex((s) => s.id === stepId);
  if (at < 0) return '';
  const before = o.steps.slice(0, at).filter((s) => s.visits && !s.gate).map((s) => s.id);
  const again = o.steps.slice(at).filter((s) => s.visits).map((s) => s.id);
  const gates = o.steps.slice(at).filter((s) => s.gate && (s.visits || s.id === stepId)).map((s) => s.id);
  const wt = o.worktree;
  const kept = [
    before.length ? `the outputs of ${before.map((s) => resumeStepHtml(o, s)).join(', ')}` : 'no earlier outputs (it starts at the beginning)',
    o.sessions.length || o.handoffs.length ? `the agents' sessions and handoff notes (${esc([...new Set([...o.sessions, ...o.handoffs])].join(', '))})` : '',
    wt ? (wt.exists ? `the worktree and branch <span class="mono">${esc(wt.branch || '')}</span> <span class="muted mono">${esc(wt.dir)}</span>`
      // #202: an ended run keeps its branch, not its folder
      : wt.branch ? `the branch <span class="mono">${esc(wt.branch)}</span>: its worktree folder is recreated from it, with the previous attempt's uncommitted work <span class="muted mono">${esc(wt.dir)}</span>`
        : 'not the worktree: it was removed, so the run starts a new one from the base') : '',
  ].filter(Boolean);
  return `<div><b>Kept:</b> ${kept.join('; ')}.</div>
    <div><b>Runs again:</b> ${resumeStepHtml(o, stepId)} and the steps its transitions lead to${again.length > 1 ? ` (reached before: ${again.slice(1).map((s) => esc(resumeStepName(o, s))).join(', ')})` : ''}.</div>
    <div><b>Human gates ask again</b> when the run reaches them${gates.length ? ` (${gates.map((s) => esc(resumeStepName(o, s))).join(', ')}${o.steps[at].gate ? '; this step is one' : ''})` : ''}: none is treated as already approved${o.steps[at].blockedBy ? `, except ${esc(resumeStepName(o, o.steps[at].blockedBy))} when you approve it again above` : ''}.</div>`;
}

// A run stopped by a limit (#288: the context limit's gate, the cost or time limits): the resumed run
// is a new run, so its limits count from zero (its own turns' context, cost and time).
function resumeLimitNote(o) {
  return o.limit ? `<div class="muted small" data-testid="resume-limit-note">The run stopped at its limit (<span class="mono">${esc(o.limit)}</span>). The resumed run counts its limits from zero: the limit applies again only once the new run reaches it.</div>` : '';
}

// opts.step: the step to preselect (#288: where an interrupted run stopped), over the suggested one;
// opts.note: one line on why this dialog opened (the kept-work Resume that needs a gate approved)
async function openResumeDialog(runId, opts = {}) {
  const body = $('#resume-body');
  const msg = $('#resume-msg');
  const yes = $('#btn-resume-yes');
  const box = $('#resume-mock');
  $('#resume-run').innerHTML = `<span class="mono">${esc(runId)}</span>`;
  body.innerHTML = '<div class="sup-loading"><span class="spinner"></span><span>Reading the run…</span></div>';
  msg.textContent = '';
  msg.className = 'small';
  yes.disabled = true;
  $('#btn-resume-no').onclick = () => closeModal('#resume-modal');
  openModal('#resume-modal');
  let o;
  try { o = await api.resumeOptions(runId); } catch (e) { body.innerHTML = `<p class="error small">${esc(errMsg(e))}</p>`; return; }
  $('#resume-run').innerHTML = `<span class="mono">${esc(o.runId)}</span> · ${esc(o.workflow || '')} ${StatusPill.statusPill(o.status)}${o.mock ? ' <span class="badge p-mock">Simulated</span>' : ''}`;
  if (o.active) { body.innerHTML = '<p class="error small">The run is still active: it can be resumed once it ends.</p>'; return; }
  const allowed = (id) => o.steps.some((s) => s.id === id && (!s.blockedBy || s.confirm?.ok));
  const pre = opts.step && allowed(opts.step) ? opts.step : o.suggested;
  body.innerHTML = `${opts.note ? `<p class="small" data-testid="resume-note">${esc(opts.note)}</p>` : ''}${resumeFields('resume', o.steps.map((s) => ({ id: s.id, label: resumeStepLabel(o, s), disabled: !!s.blockedBy && !s.confirm?.ok })), pre)}
    ${resumeLimitNote(o)}
    <div id="resume-gate" class="field"></div>
    <div id="resume-effects" class="resume-effects small"></div>`;
  const sel = $('#resume-step');
  const gateBox = () => $('#resume-confirm-gate');
  // a step past a decided gate starts only once the owner ticks the confirmation
  const ready = () => { yes.disabled = !sel.value || (!!gateBox() && !gateBox().checked); };
  const effects = () => {
    $('#resume-gate').innerHTML = resumeGateConfirm(o, sel.value);
    if (gateBox()) gateBox().onchange = ready;
    $('#resume-effects').innerHTML = resumeEffects(o, sel.value);
    ready();
  };
  sel.onchange = effects;
  effects();
  // a simulated run resumes as one; simulation-only (automated checks) never resumes a real run
  box.checked = o.mock || devMode();
  box.disabled = o.mock || !!state.simulationOnly;
  if (!pre) yes.disabled = true;
  yes.onclick = async () => {
    yes.disabled = true;
    msg.className = 'small muted';
    msg.textContent = 'Starting…';
    try {
      const confirmGate = gateBox()?.checked ? gateBox().dataset.gate : undefined;
      // images pasted into the instruction (#130), for the first resumed step
      const images = await PasteImage.collect($('#resume-ins'));
      const { runId } = await api.resumeRun(o.runId, sel.value, $('#resume-ins').value.trim() || undefined, o.mock || wantsSimulation(box), confirmGate, ...(images.length ? [images] : []));
      closeModal('#resume-modal');
      showRun(runId, { running: true });
    } catch (e) {
      msg.className = 'small error';
      msg.textContent = errMsg(e);
      yes.disabled = false;
    }
  };
}
window.openResumeDialog = openResumeDialog;
