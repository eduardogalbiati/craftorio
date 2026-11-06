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
  return `<div class="field"><label for="${id}-step">${t('resume_dialog.resume_from_step')}</label>
      <select id="${id}-step">${options.map((o) => `<option value="${esc(o.id)}"${o.id === pre ? ' selected' : ''}${o.disabled ? ' disabled' : ''}>${esc(o.label || o.id)}</option>`).join('')}</select></div>
    <div class="field"><label for="${id}-ins">${t('resume_dialog.instruction_for_the_agents')} <span class="muted small">${t('resume_dialog.optional')}</span></label>
      <textarea id="${id}-ins" rows="4" placeholder="${t('resume_dialog.e_g_the_app_was_restarted')}">${esc(instruction)}</textarea></div>`;
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
  return `<label class="check"><input type="checkbox" id="resume-confirm-gate" data-gate="${esc(s.blockedBy)}"> ${t('resume_dialog.approve_o_again', { o: resumeStepHtml(o, s.blockedBy) })}</label>
    <div class="muted small">${commits} ${t('resume_dialog.it_is_recorded_as_your_approval')}</div>`;
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
      : wt.branch ? `the branch <span class="mono">${esc(wt.branch)}</span>${t('resume_dialog.its_worktree_folder_is_recreated_from')} <span class="muted mono">${esc(wt.dir)}</span>`
        : 'not the worktree: it was removed, so the run starts a new one from the base') : '',
  ].filter(Boolean);
  return `<div><b>${t('resume_dialog.kept')}</b> ${kept.join('; ')}.</div>
    <div><b>${t('resume_dialog.runs_again')}</b> ${resumeStepHtml(o, stepId)} ${t('resume_dialog.and_the_steps_its_transitions_lead', { value: again.length > 1 ? ` (reached before: ${again.slice(1).map((s) => esc(resumeStepName(o, s))).join(', ')})` : '' })}</div>
    <div><b>${t('resume_dialog.human_gates_ask_again')}</b> ${t('resume_dialog.when_the_run_reaches_them_value', { value: gates.length ? ` (${gates.map((s) => esc(resumeStepName(o, s))).join(', ')}${o.steps[at].gate ? '; this step is one' : ''})` : '', value2: o.steps[at].blockedBy ? `, except ${esc(resumeStepName(o, o.steps[at].blockedBy))} when you approve it again above` : '' })}</div>`;
}

// A run stopped by a limit (#288: the context limit's gate, the cost or time limits): the resumed run
// is a new run, so its limits count from zero (its own turns' context, cost and time). A provider's
// limit (#799) does not start over with the run: it has to have reset. Then what each agent's next
// turn re-reads (#320), the cost of waiting past the prompt cache.
function resumeLimitNote(o) {
  if (!o.limit) return '';
  const after = o.providerLimit ? t('resume_dialog.the_providers_limit_has_to_have_reset') : t('resume_dialog.the_resumed_run_counts_its_limits');
  const turns = o.turns?.length ? ` ${esc(SessionCache.continueText(o.turns, (agent) => resumeStepName(null, agent)))}.` : '';
  return `<div class="muted small" data-testid="resume-limit-note">${t('resume_dialog.the_run_stopped_at_its_limit')}<span class="mono">${esc(o.limit)}</span>${after}${turns}</div>`;
}

// The inputs the owner may change for the new run (#799: the developer's model and effort), at the
// values the run's agents ran on; the service says which, each with the workflow's own definition.
// An override may have run outside the input's list: that value leads the select, and stays unless
// the owner picks another (only a value that differs from what ran goes to the new run).
const resumeInputKeys = (o) => Object.keys(o.inputDefs || {}).filter((key) => o.inputDefs[key].enum?.length);
const resumeInputSelect = (key) => $(`[data-testid="resume-input-${key}"]`);

function resumeInputFields(o) {
  const fields = resumeInputKeys(o).map((key) => {
    const def = o.inputDefs[key];
    const ran = o.inputs?.[key];
    const values = ran == null || def.enum.some((v) => String(v) === String(ran)) ? def.enum : [ran, ...def.enum];
    const options = values.map((v) => `<option value="${esc(v)}"${String(v) === String(ran) ? ' selected' : ''}>${esc(WorkflowInputs.optionLabel(def, v))}</option>`).join('');
    return `<div class="field"><label for="resume-input-${esc(key)}">${esc(WorkflowInputs.label(key, def))}</label>
      <select id="resume-input-${esc(key)}" data-testid="resume-input-${esc(key)}">${options}</select></div>`;
  });
  return fields.length ? `<div class="resume-inputs">${fields.join('')}</div>` : '';
}

// What the owner changed, or null: the run's other inputs stay as it recorded them
function resumeInputChanges(o) {
  const changed = resumeInputKeys(o).filter((key) => resumeInputSelect(key).value !== String(o.inputs?.[key]));
  return changed.length ? Object.fromEntries(changed.map((key) => [key, resumeInputSelect(key).value])) : null;
}

// opts.step: the step to preselect (#288: where an interrupted run stopped), over the suggested one
// (#799: the step the run stopped at, never the first one by default);
// opts.note: one line on why this dialog opened (the kept-work Resume that needs a gate approved)
async function openResumeDialog(runId, opts = {}) {
  const body = $('#resume-body');
  const msg = $('#resume-msg');
  const yes = $('#btn-resume-yes');
  const box = $('#resume-mock');
  $('#resume-run').innerHTML = `<span class="mono">${esc(runId)}</span>`;
  body.innerHTML = `<div class="sup-loading"><span class="spinner"></span><span>${t('resume_dialog.reading_the_run')}</span></div>`;
  msg.textContent = '';
  msg.className = 'small';
  yes.disabled = true;
  $('#btn-resume-no').onclick = () => closeModal('#resume-modal');
  openModal('#resume-modal');
  let o;
  try { o = await api.resumeOptions(runId); } catch (e) { body.innerHTML = `<p class="error small">${esc(errMsg(e))}</p>`; return; }
  $('#resume-run').innerHTML = `<span class="mono">${esc(o.runId)}</span> · ${esc(o.workflow || '')} ${StatusPill.statusPill(o.status)}${o.mock ? ` <span class="badge p-mock">${t('resume_dialog.simulated')}</span>` : ''}`;
  if (o.active) { body.innerHTML = `<p class="error small">${t('resume_dialog.the_run_is_still_active_it')}</p>`; return; }
  const allowed = (id) => o.steps.some((s) => s.id === id && (!s.blockedBy || s.confirm?.ok));
  const pre = opts.step && allowed(opts.step) ? opts.step : o.suggested;
  body.innerHTML = `${opts.note ? `<p class="small" data-testid="resume-note">${esc(opts.note)}</p>` : ''}${resumeFields('resume', o.steps.map((s) => ({ id: s.id, label: resumeStepLabel(o, s), disabled: !!s.blockedBy && !s.confirm?.ok })), pre)}
    ${resumeInputFields(o)}
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
    msg.textContent = t('resume_dialog.starting');
    try {
      const confirmGate = gateBox()?.checked ? gateBox().dataset.gate : undefined;
      // images pasted into the instruction (#130), for the first resumed step
      const images = await PasteImage.collect($('#resume-ins'));
      const inputs = resumeInputChanges(o);
      const { runId } = await api.resumeRun(o.runId, sel.value, $('#resume-ins').value.trim() || undefined, o.mock || wantsSimulation(box), confirmGate, ...(images.length || inputs ? [images.length ? images : undefined] : []), ...(inputs ? [inputs] : []));
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
