/* global api */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtNum = (n) => (n || 0).toLocaleString('pt-BR');
const fmtCost = (n) => (n == null ? '—' : `US$ ${Number(n).toFixed(4)}`);
function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : m ? `${m}m${String(r).padStart(2, '0')}s` : `${r}s`;
}
const timeOf = (iso) => new Date(iso).toLocaleTimeString('pt-BR');
const LS_KEY = 'multiagent.inputs';

// ---------------------------------------------------------------------------
const state = {
  workflows: [],
  wf: null,
  run: null,          // { id, status, startedAt, finishedAt, mock }
  sessions: new Map(),// id -> { ...snapshot, turnLog: Map, localOpenedAt }
  steps: new Map(),   // id -> { id, type, agent, visits, status }
  orchLog: [],
  events: [],
  selected: null,
  approval: null,
  openDetails: new Set(),
  tab: 'detail',
};

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------
async function init() {
  $('#btn-start').onclick = startRun;
  $('#btn-stop').onclick = () => api.stopRun();
  $('#btn-open-dir').onclick = () => api.openRunDir();
  $('#btn-approve').onclick = () => resolveApproval(true);
  $('#btn-reject').onclick = () => resolveApproval(false);
  document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
  $('#tab-detail').addEventListener('toggle', (e) => {
    const key = e.target.dataset?.key;
    if (!key) return;
    e.target.open ? state.openDetails.add(key) : state.openDetails.delete(key);
  }, true);
  api.onEvent(onEvent);
  setInterval(renderTicking, 1000);

  state.workflows = await api.listWorkflows();
  const sel = $('#wf-select');
  sel.innerHTML = state.workflows.map((w, i) => `<option value="${i}">${esc(w.name)}${w.version ? ' v' + esc(w.version) : ''}${w.error ? ' (erro)' : ''}</option>`).join('');
  sel.onchange = () => selectWorkflow(+sel.value);
  if (state.workflows.length) selectWorkflow(0);
  else $('#wf-desc').textContent = 'Nenhum .yaml encontrado em /workflows.';

  const env = await api.checkEnv();
  $('#env-status').innerHTML = ['claude', 'codex'].map((k) =>
    env[k] ? `<span class="ok">✓ ${k}: <span class="mono">${esc(env[k])}</span></span>`
           : `<span class="missing">✗ ${k} não encontrado no PATH (use o modo simulação)</span>`).join('');
}

function selectWorkflow(i) {
  const wf = state.workflows[i];
  state.wf = wf;
  $('#wf-desc').textContent = wf.error ? `Erro: ${wf.error}` : wf.description || '';
  $('#wf-agents').innerHTML = Object.entries(wf.agents || {}).map(([name, a]) =>
    `<div class="agent-row"><span>${esc(name)}</span><span class="model">${esc(a.provider)} · ${esc(a.model)}</span></div>`).join('');

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(`${LS_KEY}.${wf.file}`) || '{}'); } catch { /* ignore */ }

  $('#inputs-form').innerHTML = Object.entries(wf.inputs || {}).map(([key, def]) => {
    const val = saved[key] ?? def.default ?? '';
    const label = `<label for="in-${key}">${esc(key)} ${def.required ? '<span class="req">*</span>' : ''}</label>`;
    const hint = def.description ? `<div class="hint">${esc(def.description)}</div>` : '';
    let control;
    if (def.enum) {
      control = `<select id="in-${key}" name="${key}">${def.enum.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (key === 'task' || def.multiline) {
      control = `<textarea id="in-${key}" name="${key}" rows="4">${esc(val)}</textarea>`;
    } else if (/path|dir/i.test(key)) {
      control = `<div class="row"><input type="text" id="in-${key}" name="${key}" value="${esc(val)}" /><button type="button" class="btn sm" data-pick="${key}">…</button></div>`;
    } else {
      control = `<input type="text" id="in-${key}" name="${key}" value="${esc(val)}" />`;
    }
    return `<div class="field">${label}${control}${hint}</div>`;
  }).join('');

  document.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = async () => {
    const dir = await api.pickFolder();
    if (dir) $(`#in-${b.dataset.pick}`).value = dir;
  }));

  resetSteps(wf.steps || []);
  renderSteps();
}

function readInputs() {
  const out = {};
  new FormData($('#inputs-form')).forEach((v, k) => (out[k] = String(v).trim()));
  return out;
}

async function startRun() {
  $('#start-error').textContent = '';
  const inputs = readInputs();
  try { localStorage.setItem(`${LS_KEY}.${state.wf.file}`, JSON.stringify(inputs)); } catch { /* ignore */ }
  try {
    await api.startRun({ file: state.wf.file, inputs, mock: $('#mock-toggle').checked });
  } catch (e) {
    $('#start-error').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
}

// answer: true/false ou o id de uma choice
function resolveApproval(answer) {
  if (!state.approval) return;
  api.resolveApproval(state.approval.approval_id, answer);
  closeApproval();
}

function closeApproval() {
  state.approval = null;
  $('#approval-modal').classList.add('hidden');
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-detail').classList.toggle('hidden', tab !== 'detail');
  $('#tab-events').classList.toggle('hidden', tab !== 'events');
  scheduleRender();
}

// ---------------------------------------------------------------------------
// Eventos do engine
// ---------------------------------------------------------------------------
function resetSteps(steps) {
  state.steps = new Map(steps.map((s) => [s.id, { ...s, visits: 0, status: 'pending' }]));
}

function getTurn(sess, n) {
  if (!sess.turnLog.has(n)) sess.turnLog.set(n, { n, items: [], prompt: null, result: null, stepId: null, startedAt: null });
  return sess.turnLog.get(n);
}

function onEvent(ev) {
  state.events.push(ev);
  const sess = ev.session_id ? state.sessions.get(ev.session_id) : null;

  switch (ev.type) {
    case 'workflow.started':
      state.run = { id: ev.run_id, status: 'running', startedAt: Date.parse(ev.ts), mock: ev.mock };
      state.sessions.clear();
      state.orchLog = [];
      state.events = [ev];
      state.selected = null;
      state.openDetails.clear();
      resetSteps(ev.steps);
      orch(ev, `workflow "${ev.workflow}" iniciado ${ev.mock ? '(simulação)' : ''}`);
      break;

    case 'workflow.finished':
      state.run.status = ev.status;
      state.run.finishedAt = Date.parse(ev.ts);
      state.steps.forEach((s) => { if (s.status !== 'pending') s.status = 'done'; });
      orch(ev, `workflow finalizado: ${ev.status}${ev.error ? ' — ' + ev.error : ''}`, ev.status === 'success' ? 'transition' : 'error');
      if (state.approval) closeApproval();
      break;

    case 'session.opened':
      state.sessions.set(ev.session_id, { ...ev.session, turnLog: new Map(), localOpenedAt: Date.parse(ev.ts) });
      if (!state.selected) state.selected = ev.session_id;
      if (ev.session_id !== 'orchestrator') orch(ev, `sessão ${ev.session_id} aberta: ${ev.session.agent} (${ev.session.provider} · ${ev.session.model})`);
      break;

    case 'session.status':
      if (sess) sess.status = ev.status;
      break;

    case 'session.closed':
      if (sess) Object.assign(sess, ev.session);
      if (ev.session_id !== 'orchestrator') orch(ev, `sessão ${ev.session_id} encerrada (${ev.status})`);
      break;

    case 'session.message_sent':
      if (sess) {
        const t = getTurn(sess, ev.turn);
        t.prompt = ev.prompt; t.stepId = ev.step_id; t.startedAt = Date.parse(ev.ts);
        sess.turns_count = ev.turn;
        orch(ev, `→ ${ev.session_id} turno ${ev.turn} (${ev.step_id})`);
      }
      break;

    case 'session.stream':
      if (sess) {
        if (ev.item.kind === 'session' && ev.item.sessionId) sess.provider_session_id = ev.item.sessionId;
        if (ev.item.kind !== 'usage' && ev.item.kind !== 'session') getTurn(sess, ev.turn).items.push(ev.item);
      }
      break;

    case 'session.message_received':
      if (sess) {
        getTurn(sess, ev.turn).result = { usage: ev.usage, cost: ev.cost_usd, duration: ev.duration_ms };
        Object.assign(sess, ev.session);
        orch(ev, `← ${ev.session_id} respondeu em ${fmtDur(ev.duration_ms)}`);
      }
      break;

    case 'step.started': {
      const s = state.steps.get(ev.step_id);
      if (s) { s.status = 'running'; s.visits = ev.visit; }
      orch(ev, `▶ step ${ev.step_id} (visita ${ev.visit})`, 'transition');
      break;
    }
    case 'step.finished': {
      const s = state.steps.get(ev.step_id);
      if (s) s.status = 'done';
      break;
    }
    case 'step.waiting': {
      const s = state.steps.get(ev.step_id);
      if (s) s.status = 'waiting';
      orch(ev, `⏳ ${ev.step_id}: /loop, próxima verificação em ${fmtDur(ev.interval_ms)}`);
      break;
    }
    case 'step.goal':
      orch(ev, `🎯 /goal ${ev.met ? 'atingido' : 'pendente'}: ${ev.goal} (iteração ${ev.iteration})`, ev.met ? 'transition' : '');
      break;
    case 'step.transition':
      orch(ev, `${ev.from} → ${ev.to}   [${ev.when}]`, 'transition');
      break;

    case 'approval.requested':
      state.approval = ev;
      $('#approval-step').textContent = `step: ${ev.step_id}`;
      $('#approval-message').textContent = ev.message;
      $('#approval-binary').classList.toggle('hidden', !!ev.choices);
      $('#approval-choices').classList.toggle('hidden', !ev.choices);
      $('#approval-choices').innerHTML = (ev.choices || []).map((c, i) =>
        `<button class="btn ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('');
      $('#approval-choices').querySelectorAll('[data-choice]').forEach((b) => (b.onclick = () => resolveApproval(b.dataset.choice)));
      $('#approval-modal').classList.remove('hidden');
      orch(ev, `? aprovação solicitada em ${ev.step_id}`, 'warn');
      break;

    case 'approval.resolved':
      if (state.approval?.approval_id === ev.approval_id) closeApproval();
      if (ev.choice !== undefined) orch(ev, `decisão humana: ${ev.choice} (${ev.by})`, 'transition');
      else orch(ev, `aprovação ${ev.approved ? 'concedida' : 'negada'} (${ev.by})`, ev.approved ? 'transition' : 'warn');
      break;

    case 'action.executed':
      orch(ev, `$ ${ev.command} ${ev.skipped ? '(não executado — simulação)' : `→ exit ${ev.exit_code}`}`);
      break;

    case 'limit.exceeded':
      orch(ev, `limite excedido: ${ev.limit}`, 'error');
      break;

    case 'log':
      orch(ev, ev.message, ev.level);
      break;
  }
  scheduleRender();
}

function orch(ev, text, level = '') {
  state.orchLog.push({ ts: ev.ts, text, level });
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; render(); });
}

function render() {
  renderHeader();
  renderSteps();
  renderSessions();
  if (state.tab === 'detail') renderDetail();
  else renderEvents();
}

function renderTicking() {
  if (state.run?.status === 'running') { renderHeader(); renderSessions(); }
}

function liveDuration(s) {
  if (s.closed_at) return s.duration_ms;
  return Date.now() - (s.localOpenedAt || Date.parse(s.opened_at));
}

function totals() {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0, cost: 0 };
  state.sessions.forEach((s) => {
    for (const k of ['input', 'output', 'cache_read', 'cache_write', 'reasoning']) t[k] += s.tokens?.[k] || 0;
    t.cost += s.cost_usd || 0;
  });
  return t;
}

function renderHeader() {
  const r = state.run;
  const pill = $('#run-status');
  const st = r?.status || 'idle';
  pill.className = `pill pill-${st}`;
  pill.textContent = { idle: 'parado', running: r?.mock ? 'executando (simulação)' : 'executando', success: 'concluído', failed: 'falhou', cancelled: 'cancelado' }[st] || st;
  $('#run-id').textContent = r?.id || '';
  $('#kpi-time').textContent = r ? fmtDur((r.finishedAt || Date.now()) - r.startedAt) : '—';
  $('#kpi-sessions').textContent = String([...state.sessions.keys()].filter((k) => k !== 'orchestrator').length);
  const t = totals();
  $('#kpi-tokens').textContent = `${fmtNum(t.input + t.cache_read)} / ${fmtNum(t.output)}`;
  $('#kpi-reasoning').textContent = fmtNum(t.reasoning);
  $('#kpi-cost').textContent = `US$ ${t.cost.toFixed(4)}`;
  $('#btn-stop').disabled = st !== 'running';
  $('#btn-start').disabled = st === 'running';
}

function renderSteps() {
  $('#steps').innerHTML = [...state.steps.values()].map((s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span>${esc(s.id)}<br><span class="kind">${s.type === 'human_approval' ? 'aprovação humana' : esc(s.agent)}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
    </li>`).join('');
}

function renderSessions() {
  const box = $('#sessions');
  if (!state.sessions.size) return;
  const list = [...state.sessions.values()];
  box.innerHTML = list.map((s) => {
    const isOrch = s.id === 'orchestrator';
    const t = s.tokens || {};
    return `
    <div class="session-card ${isOrch ? '' : 'child'} ${state.selected === s.id ? 'selected' : ''}" data-id="${esc(s.id)}">
      <div class="sc-head">
        <span class="name">${esc(s.agent)}</span>
        <span class="id">${esc(s.id)}</span>
        <span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span>
      </div>
      <div class="badges">
        <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span>
        <span class="badge">${esc(s.model)}</span>
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} turno(s)</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>aberta</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>steps</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>sessões filhas</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>custo total</label><b>${fmtCost(totals().cost)}</b></div>` : `
        <div class="metric"><label>ativa</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>in / out</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>custo</label><b>${fmtCost(s.cost_usd)}</b></div>`}
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.session-card').forEach((el) => (el.onclick = () => {
    state.selected = el.dataset.id;
    if (state.tab !== 'detail') switchTab('detail'); else scheduleRender();
  }));
}

function detailsBlock(key, cls, label, body) {
  const open = state.openDetails.has(key);
  return `<details class="item ${cls}" data-key="${esc(key)}" ${open ? 'open' : ''}>
    <summary><div class="label">${label}</div></summary><pre>${esc(body)}</pre></details>`;
}

function renderItem(sid, turn, item, i) {
  const key = `${sid}:${turn}:${i}`;
  switch (item.kind) {
    case 'thinking': return detailsBlock(key, 'thinking', 'thinking', item.text);
    case 'text': return `<div class="item text"><div class="label">output</div><pre>${esc(item.text)}</pre></div>`;
    case 'tool_call': return `<div class="item tool_call"><div class="label">tool · ${esc(item.name)}</div><pre>${esc(typeof item.input === 'string' ? item.input : JSON.stringify(item.input, null, 2))}</pre></div>`;
    case 'tool_result': return detailsBlock(key, 'tool_result', `resultado${item.is_error ? ' (erro)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">stderr</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">processo</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`;
    default: return `<div class="item raw"><div class="label">evento</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
  }
}

function renderDetail() {
  const box = $('#tab-detail');
  const s = state.sessions.get(state.selected);
  if (!s) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  let html = `
    <div class="detail-head">
      <h3>${esc(s.agent)} <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
      <dl class="kv">
        <dt>sessão</dt><dd>${esc(s.id)}</dd>
        <dt>provider session</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>status</dt><dd>${esc(s.status)}</dd>
        <dt>aberta em</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>duração / ativa / ociosa</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>tokens</dt><dd>in ${fmtNum(s.tokens?.input)} · cache r/w ${fmtNum(s.tokens?.cache_read)}/${fmtNum(s.tokens?.cache_write)} · out ${fmtNum(s.tokens?.output)} · reasoning ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>custo</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">Turno ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? `${fmtDur(t.result.duration)} · in ${fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0))} · out ${fmtNum(t.result.usage?.output)} · ${fmtCost(t.result.cost)}` : 'em andamento…'}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt enviado', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>input ${fmtNum(t.result.usage?.input)}</span><span>cache read ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>cache write ${fmtNum(t.result.usage?.cache_write)}</span><span>output ${fmtNum(t.result.usage?.output)}</span>
              <span>reasoning ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || '<p class="empty muted">Aguardando o primeiro turno…</p>';
  }

  box.innerHTML = html;
  if (atBottom) box.scrollTop = box.scrollHeight;
}

function renderEvents() {
  const box = $('#tab-events');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  box.innerHTML = state.events.slice(-400).map((ev) => {
    const { seq, ts, type, run_id, ...rest } = ev;
    return `<div class="ev"><div class="ev-head"><span class="muted">#${seq}</span><span class="muted">${esc(timeOf(ts))}</span><span class="ev-type">${esc(type)}</span></div>
      <pre>${esc(JSON.stringify(rest, null, 1)).slice(0, 2000)}</pre></div>`;
  }).join('');
  if (atBottom) box.scrollTop = box.scrollHeight;
}

init();
