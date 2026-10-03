/* global api */
// The AI supervisor drawer: the analysis of a run and its recommendations (openSupervisor,
// analyzeRun, runRecommendation; SUP_ACTIONS names what each does), its chat, and watch mode: the
// supervisor follows a running run and explains it (opt-in: it costs tokens; WATCH_TITLE). Opened
// from the Run screen, the failure banner and the run lists. initSupervisorDrawer() wires it from
// app.js's init(). The Supervisor screen (its settings) is views/supervisor/.

// AI supervisor: analysis of a run, resume from a step, chat
const SUP_ACTIONS = { retry: 'retry the step', fix_output: 'fix the output', goto: 'go to another step', ask_human: 'ask you', fail: 'stop the run', wait: 'keep waiting', interrupt: 'interrupt the idle agent' };

const WATCH_TITLE = 'The supervisor follows this run and explains it in a chat, where you can ask questions (opt-in: it costs tokens)';

function openSupervisorForCurrent(opts) {
  const r = state.run;
  if (!r) return;
  openSupervisor({ runId: r.id, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock, issues: issuesOfRun(r) }, opts);
}

// opts.watch: turn the watch mode on (the "Watch with the supervisor" buttons)
function openSupervisor(run, opts = {}) {
  const sup = state.sup;
  if (sup.runId !== run.runId) {
    Object.assign(sup, { runId: run.runId, question: '', loading: false, result: null, error: null, recMsgs: {}, watch: null, watchError: null });
  }
  loadWatch(run.runId).then(() => {
    if (opts.watch && !sup.watch?.on && sup.runId === run.runId) setWatch(true);
  });
  Object.assign(sup, { workflow: run.workflow, status: run.status, runError: run.error, mock: !!run.mock, issues: issuesOfRun(run) });
  $('#sup-question').value = sup.question;
  $('#sup-chat-msg').textContent = '';
  $('#sup-drawer').classList.add('open');
  $('#sup-drawer').setAttribute('aria-hidden', 'false');
  $('#sup-backdrop').classList.remove('hidden');
  renderSupervisor();
  renderWatch();
  setTimeout(() => $(opts.watch ? '#sup-watch-q' : '#sup-question').focus(), 200);
}
window.watchWithSupervisor = (run) => openSupervisor(run, { watch: true });

function closeSupervisor() {
  $('#sup-drawer').classList.remove('open');
  $('#sup-drawer').setAttribute('aria-hidden', 'true');
  $('#sup-backdrop').classList.add('hidden');
}

async function analyzeRun() {
  const sup = state.sup;
  if (!sup.runId || sup.loading) return;
  const runId = sup.runId;
  Object.assign(sup, { loading: true, error: null, recMsgs: {} });
  renderSupervisor();
  try {
    // images pasted into the question (#130) go with it
    const images = await PasteImage.collect($('#sup-question'));
    const res = await api.askSupervisor(runId, sup.question.trim() || undefined, ...(images.length ? [images] : []));
    if (sup.runId !== runId) return;
    if (images.length) PasteImage.clear($('#sup-question'));
    sup.result = res;
  } catch (e) {
    if (sup.runId !== runId) return;
    sup.error = errMsg(e);
  } finally {
    if (sup.runId === runId) sup.loading = false;
  }
  renderSupervisor();
}

async function supervisorChat() {
  const msg = $('#sup-chat-msg');
  msg.textContent = '';
  msg.classList.remove('error');
  try {
    await openTerminal({ kind: 'supervisor', runId: state.sup.runId, label: 'supervisor' });
  } catch (e) {
    msg.textContent = errMsg(e);
    msg.classList.add('error');
  }
}

// Watch mode: the supervisor follows a running run and explains it in this drawer (opt-in: it costs
// tokens). Its messages arrive on api.onWatch; the model and effort picked are remembered.
const WATCH_PICK_KEY = 'supWatchPick';
function watchPick() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(WATCH_PICK_KEY) || '{}'); } catch { /* defaults */ }
  return { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'default', ...p };
}
const saveWatchPick = (change) => localStorage.setItem(WATCH_PICK_KEY, JSON.stringify({ ...watchPick(), ...change }));

async function loadWatch(runId) {
  try {
    const w = await api.watchState(runId);
    if (state.sup.runId === runId) { state.sup.watch = w; renderWatch(); }
  } catch { /* shown without its history */ }
}

async function setWatch(on) {
  const sup = state.sup;
  const runId = sup.runId;
  const p = watchPick();
  sup.watchError = null;
  try {
    const w = await api.watchRun(runId, on, { provider: p.provider, model: p.model, effort: p.effort === 'default' ? '' : p.effort });
    if (sup.runId === runId) sup.watch = w;
  } catch (e) {
    if (sup.runId === runId) sup.watchError = errMsg(e);
  }
  renderWatch();
}

async function askWatch() {
  const input = $('#sup-watch-q');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  state.sup.watchError = null;
  try {
    await api.askWatch(state.sup.runId, q);
  } catch (e) {
    state.sup.watchError = errMsg(e);
    input.value = q;
    renderWatch();
  }
}

function onWatch({ runId, message, watch }) {
  const sup = state.sup;
  if (sup.runId !== runId) return;
  const messages = sup.watch?.messages || [];
  // the reply to watchRun may already hold the message
  const known = message && messages.some((m) => m.ts === message.ts && m.text === message.text);
  sup.watch = { ...sup.watch, ...watch, messages: message && !known ? [...messages, message] : messages };
  renderWatch();
}

function renderWatch() {
  const sup = state.sup;
  const w = sup.watch;
  const on = !!w?.on;
  const live = on || isRunLive(sup.runId);
  $('#sup-watch').classList.toggle('hidden', !live && !w?.messages?.length);
  $('#sup-watch-on').checked = on;
  $('#sup-watch-on').disabled = !live;
  const p = watchPick();
  const sel = $('#sup-watch-model');
  if (!sel.options.length) {
    sel.innerHTML = Object.entries(window.ChatModels?.PROVIDERS || {}).map(([type, pr]) =>
      `<optgroup label="${esc(pr.label)}">${pr.models.map((m) => `<option value="${esc(`${type}|${m}`)}">${esc(m)}</option>`).join('')}</optgroup>`).join('');
  }
  sel.value = on ? `${w.provider}|${w.model}` : `${p.provider}|${p.model}`;
  sel.disabled = on;
  const effort = on ? w.effort || 'default' : p.effort;
  $('#sup-watch-effort').innerHTML = ['default', ...(window.ChatModels?.EFFORTS || [])]
    .map((e) => `<button type="button" data-effort="${e}" class="${e === effort ? 'active' : ''}"${on ? ' disabled' : ''}>${e}</button>`).join('');
  $('#sup-watch-cost').textContent = w && (on || w.costUsd) ? `watch cost ${fmtCost(w.costUsd || 0)}` : '';
  $('#sup-watch-q').disabled = !on;
  $('#btn-sup-watch-ask').disabled = !on;
  const log = $('#sup-watch-log');
  log.innerHTML = (w?.messages || []).map((m) => {
    const cls = `sup-wmsg ${esc(m.role)}${m.flag ? ' flag' : ''}${m.error ? ' error' : ''}`;
    if (m.role === 'system') return `<div class="${cls} small">${esc(m.text)}</div>`;
    const meta = `${m.role === 'user' ? 'You' : '◆ Supervisor'} · ${esc(new Date(m.ts).toLocaleTimeString())}${m.costUsd != null ? ` · ${esc(fmtCost(m.costUsd))}` : ''}`;
    return `<div class="${cls}"><div class="sup-wmsg-meta">${meta}</div><div class="md md-compact">${markdownHtml(m.text)}</div></div>`;
  }).join('')
    + (w?.busy ? '<div class="sup-loading"><span class="spinner"></span><span>The supervisor is reading the run…</span></div>' : '')
    + (sup.watchError ? `<p class="error small">${esc(sup.watchError)}</p>` : '');
  log.scrollTop = log.scrollHeight;
}

function renderSupervisor() {
  const sup = state.sup;
  $('#sup-run').innerHTML = `<span class="mono">${esc(sup.runId || '')}</span>${sup.workflow ? ` · ${esc(sup.workflow)}` : ''}${sup.issues?.length === 1 ? ` · <b>#${esc(sup.issues[0].number)}</b> ${esc(sup.issues[0].title || '')}` : sup.issues?.length ? ` · <b>${esc(issueRefs(sup))}</b>` : ''}${sup.status ? ` <span class="pill pill-${esc(sup.status)}">${esc(sup.status)}</span>` : ''}${sup.mock ? ' <span class="badge p-mock">simulated</span>' : ''}`;
  $('#btn-sup-analyze').disabled = sup.loading;
  $('#btn-sup-analyze').textContent = sup.result ? 'Analyze again' : 'Analyze';
  const box = $('#sup-result');
  if (sup.loading) {
    box.innerHTML = '<div class="sup-loading"><span class="spinner"></span><span>The supervisor is reading the run… (this can take a minute)</span></div>';
    return;
  }
  if (sup.error) { box.innerHTML = `<p class="error small">${esc(sup.error)}</p>`; return; }
  const res = sup.result;
  if (!res) {
    box.innerHTML = `${sup.runError ? `<div class="sup-runerror"><div class="sup-h">Error</div><pre>${esc(sup.runError)}</pre></div>` : ''}
      <p class="muted small">The supervisor reads the run's events, outputs and logs, explains what happened and suggests how to continue. You can also chat with it in a terminal.</p>`;
    return;
  }
  const a = res.analysis || {};
  const steps = res.steps || [];
  const recs = a.recommendations || [];
  box.innerHTML = `
    <div class="sup-meta muted small">
      <span>${esc(res.model || 'supervisor')}${res.costUsd != null ? ` · ${esc(fmtCost(res.costUsd))}` : ''}</span>
      ${res.artifactPath ? '<button class="link-btn small" id="sup-open-art">Open in Artifacts</button>' : ''}
    </div>
    <section class="sup-sec"><div class="sup-h">What happened</div><div class="md md-compact">${markdownHtml(a.summary || '_No summary._')}</div></section>
    ${a.root_cause ? `<section class="sup-sec"><div class="sup-h">Root cause</div><div class="md md-compact">${markdownHtml(a.root_cause)}</div></section>` : ''}
    ${recs.length ? `<section class="sup-sec"><div class="sup-h">Recommendations</div>${recs.map((r, i) => recCard(r, i, steps)).join('')}</section>` : ''}`;
  $('#sup-open-art')?.addEventListener('click', () => {
    closeSupervisor();
    openArtifactsAt({ projectId: '', path: res.artifactPath, mock: sup.mock });
    loadArtifacts().then(() => renderArtifactList());
  });
  box.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => runRecommendation(Number(b.dataset.rec))));
}

function recCard(r, i, steps) {
  const m = state.sup.recMsgs[i];
  const msg = m ? `<span class="small ${m.error ? 'error' : 'muted'}">${esc(m.text)}</span>` : '';
  let ctrl = '';
  if (r.action === 'resume') {
    const pre = steps.includes(r.step) ? r.step : steps[0];
    ctrl = `${resumeFields(`rec-${i}`, steps.map((s) => ({ id: s })), pre, r.instruction || '')}
      <div class="row"><button class="btn sm primary" data-rec="${i}">Resume from this step</button>${msg}</div>`;
  } else if (r.action === 'rerun') {
    ctrl = `${r.instruction ? `<p class="small muted sup-ins">${esc(r.instruction)}</p>` : ''}<div class="row"><button class="btn sm" data-rec="${i}">Run again</button>${msg}</div>`;
  } else if (r.instruction) {
    ctrl = `<p class="small muted sup-ins">${esc(r.instruction)}</p>`;
  }
  const tag = { resume: 'resume', rerun: 'run again', none: 'advice' }[r.action] || r.action;
  return `<div class="sup-rec"><div class="sup-rec-head"><b>${esc(r.title || 'Recommendation')}</b><span class="badge">${esc(tag)}</span></div>${ctrl}</div>`;
}

async function runRecommendation(i) {
  const sup = state.sup;
  const res = sup.result;
  const r = res?.analysis?.recommendations?.[i];
  if (!r) return;
  const steps = res.steps || [];
  const step = r.action === 'resume' ? $(`#rec-${i}-step`).value : steps[0];
  const instruction = r.action === 'resume' ? $(`#rec-${i}-ins`).value.trim() : r.instruction || '';
  const btn = document.querySelector(`[data-rec="${i}"]`);
  if (btn) btn.disabled = true;
  sup.recMsgs[i] = { text: 'Starting…', error: false };
  try {
    // images pasted into the instruction (#130), for the first resumed step
    const images = r.action === 'resume' ? await PasteImage.collect($(`#rec-${i}-ins`)) : [];
    const { runId } = await api.resumeRun(sup.runId, step, instruction || undefined, ...(images.length ? [undefined, undefined, images] : []));
    sup.recMsgs = {};
    closeSupervisor();
    showRun(runId, { running: true });
  } catch (e) {
    sup.recMsgs[i] = { text: errMsg(e), error: true };
    renderSupervisor();
  }
}

function initSupervisorDrawer() {
  $('#btn-sup-close').onclick = closeSupervisor;
  $('#sup-backdrop').onclick = closeSupervisor;
  $('#btn-sup-analyze').onclick = analyzeRun;
  $('#btn-sup-chat').onclick = supervisorChat;
  $('#sup-question').oninput = (e) => { state.sup.question = e.target.value; };
  $('#sup-watch-on').onchange = (e) => setWatch(e.target.checked);
  $('#sup-watch-model').onchange = (e) => { const [provider, model] = e.target.value.split('|'); saveWatchPick({ provider, model }); };
  $('#sup-watch-effort').onclick = (e) => {
    const b = e.target.closest('[data-effort]');
    if (b && !b.disabled) { saveWatchPick({ effort: b.dataset.effort }); renderWatch(); }
  };
  $('#btn-sup-watch-ask').onclick = askWatch;
  $('#sup-watch-q').onkeydown = (e) => { if (e.key === 'Enter') askWatch(); };
}
