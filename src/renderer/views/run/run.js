/* global api */
// Run screen (Run Details): the run shown in the top bar, its failure banner, the gates it waits at
// (gate cards: renderRunGates, onRunGateClick; what a gate offers is gate-panel.js), its summary
// (inputs, supervisor, watch, resume, Save to issue), its steps by group, its sessions and the
// Session / Events / Artifacts tabs. No sidebar entry of its own: the Run item and the runs menu
// belong to the shell (app.js), which also keeps the run state it draws (state.runs, onEvent,
// hydrateRun) and calls renderRunScreen() from render() while it shows. Registers itself with
// registerView (view-registry.js); uses app.js globals ($, esc, state, api, selectedView…).

// The gates waiting in the run the Run screen shows, asked inline above its steps (never in a
// dialog over the app): which run and step they belong to, the message, the choices and the
// optional feedback field. Rebuilt only when the gates change, so a feedback being typed stays.
// A gate with `local_preview: true` (developer_check, human_review, approve_merge) has two columns
// (#108): the message, Run App and the choices on the left, the run's Artifacts panel on the right
// (stacked below on a narrow window, style.css).
function renderRunGates() {
  const v = selectedView();
  const box = $('#run-gates');
  const gates = [...v.approvals.values()];
  box.classList.toggle('hidden', !gates.length);
  const key = `${gates.map((g) => `${g.run_id}:${g.approval_id}`).join('|')}:${runLabel(v.run)}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = gates.map((g) => {
    const buttons = g.choices
      ? gateChoices(g).map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : 'ghost'}" data-choice="${esc(c.id)}"${c.intent ? ` data-intent="${esc(c.intent)}" title="${esc(c.title)}"` : ''}${c.feedback_required ? ' data-needs-text="1"' : ''}>${esc(c.label)}</button>`).join('')
      : '<button type="button" class="btn sm ghost" data-answer="false">Reject</button><button type="button" class="btn sm primary" data-answer="true">Approve</button>';
    const field = g.feedback ? `<label class="duo-ask-label">${esc(g.feedback.label || 'Instructions (optional)')}</label>
      <textarea class="duo-ask-text run-gate-feedback" rows="3" placeholder="${esc(g.feedback.placeholder || '')}"></textarea>` : '';
    const message = `<pre class="run-gate-message">${esc(g.message || '')}</pre>`;
    const main = `<div class="run-gate-head"><b>Approval required</b><span class="muted small mono">${esc(`${v.run ? `${runLabel(v.run)} · ` : ''}step: ${g.step_id}`)}</span></div>
      ${gateBriefHtml(g.run_id, g, message) || message}${gateToolsHtml(g)}${field}<div class="row run-gate-actions">${buttons}</div>`;
    const side = gateSideHtml(g);
    return `<div class="run-gate${side ? ' run-gate-wide' : ''}" data-approval="${esc(g.approval_id)}" data-run="${esc(g.run_id)}">${side ? `<div class="run-gate-main">${main}</div>${side}` : main}</div>`;
  }).join('');
  mountGateSides(box);
  paintGateApps();
}

// A click on a gate card's button answers that gate (true/false or a choice id) with the run's id,
// so it works for any run in progress; the card goes away with approval.resolved. A choice that
// needs the feedback text (feedback_required) is not sent without one.
function onRunGateClick(e) {
  const tool = e.target.closest('[data-gate-tool]');
  if (tool) { onGateTool(e, tool.closest('.run-gate')?.dataset.run); return; }
  const b = e.target.closest('button[data-answer], button[data-choice]');
  const card = b?.closest('.run-gate');
  if (!card) return;
  const answer = b.dataset.choice !== undefined ? b.dataset.choice : b.dataset.answer === 'true';
  const text = card.querySelector('.run-gate-feedback');
  if (b.dataset.needsText && !text?.value.trim()) { showToast('Write your request first', `"${b.textContent}" sends the text to the agent.`); text?.focus(); return; }
  const buttons = card.querySelectorAll('button');
  buttons.forEach((x) => (x.disabled = true));
  // intent: "Accept and save to issue #n" (#125)
  Promise.resolve(api.resolveApproval(card.dataset.approval, answer, text?.value || '', card.dataset.run, ...(b.dataset.intent ? [b.dataset.intent] : [])))
    .then((ok) => { if (ok === false) { buttons.forEach((x) => (x.disabled = false)); showToast('The gate did not accept the answer', 'It needs a text, or it was already answered.'); } })
    .catch((err) => { buttons.forEach((x) => (x.disabled = false)); showToast('Could not answer the gate', errMsg(err)); });
}

// Brings the Run screen's gate card into view and focuses its first answer.
function focusRunGate() {
  requestAnimationFrame(() => {
    const card = $('#run-gates .run-gate');
    card?.scrollIntoView({ block: 'nearest' });
    card?.querySelector('.run-gate-actions button')?.focus();
  });
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  $('#tab-detail').classList.toggle('hidden', tab !== 'detail');
  $('#tab-events').classList.toggle('hidden', tab !== 'events');
  $('#tab-artifacts').classList.toggle('hidden', tab !== 'artifacts');
  scheduleRender();
}

// The Run screen's Artifacts tab (#109): the shared panel (artifacts-panel.js), mounted on first
// use (the component loads after app.js); its count goes on the tab.
let runArtPanel = null;
function runArtifactsPanel() {
  if (!runArtPanel && window.ArtifactsPanel) {
    runArtPanel = ArtifactsPanel.mount($('#tab-artifacts'), {
      onCount: (n) => { const c = $('#tab-artifacts-count'); c.textContent = String(n); c.classList.toggle('hidden', !n); },
    });
  }
  return runArtPanel;
}

// What render() draws while the Run screen shows.
function renderRunScreen() {
  renderRunBanner();
  renderRunGates();
  renderRunSummary();
  renderSteps();
  renderSessions();
  // the tab's count follows the selected run even while another tab shows
  runArtifactsPanel()?.setRun(state.runId);
  if (state.tab === 'detail') renderDetail();
  else if (state.tab === 'events') renderEvents();
}

function liveDuration(s) {
  if (s.closed_at) return s.duration_ms;
  return Date.now() - (s.localOpenedAt || Date.parse(s.opened_at));
}

function renderRunSummary() {
  const r = state.run;
  if (!r) return;
  askPrStates([r]);
  const inputs = Object.entries(r.inputs || {}).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length));
  // an accepted Write & Review run started from an issue: Save to issue, now or later (#103)
  const saveIssue = r.workflow === 'writer-reviewer' && r.status === 'success' && window.openDuoSaveToIssue ? (issuesOfRun(r)[0] || null) : null;
  // its title (editable) and PR first, the workflow under it (#84); a past run opened from disk is read-only
  const html = `
    <div class="run-summary-name"><b>${runTitleHtml(r)}</b> ${prBadge(r)}</div>
    <div class="small muted">${esc(r.workflow || '')}${r.version ? ` v${esc(r.version)}` : ''}${selectedView().past ? ' · <span title="Opened from its recorded events: nothing here can change it">read-only</span>' : ''}</div>
    ${r.project ? `<div class="small">Project: <b>${esc(r.project)}</b></div>` : ''}
    ${(r.issueSaves || []).map((s) => `<div class="small" title="The accepted document was saved to the issue (Save to issue, Write & Review)">Saved to issue: <a href="${esc(s.commentUrl || s.url)}" target="_blank" rel="noopener">#${esc(s.number)}</a> · ${s.mode === 'comment' ? 'as a comment' : 'description replaced'} · ${esc(new Date(s.at).toLocaleString('en-US'))}</div>`).join('')}
    ${r.gateWaitMs ? `<div class="small" title="Time the run waited for your answers at its human gates: no agent works (or costs) meanwhile">Waiting for you at gates: <b>${esc(fmtDur(r.gateWaitMs))}</b></div>` : ''}
    <dl class="kv run-inputs">${inputs.map(([k, v]) => `<dt title="${esc(k)}">${esc(k)}</dt>${inputValueCell(v)}`).join('')}</dl>
    <div class="row">
      <button class="btn sm ghost sup-btn" id="btn-run-sup" title="Ask the AI supervisor to explain this run and suggest how to continue"><span class="sup-mark">◆</span> Ask the supervisor</button>
      ${r.status === 'running' ? `<button class="btn sm ghost sup-btn" id="btn-run-watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> Watch</button>` : ''}
      ${canResume(r) ? '<button class="btn sm ghost" id="btn-run-resume" title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button>' : ''}
      ${saveIssue ? `<button class="btn sm ghost" id="btn-run-save-issue" title="Save the accepted document to its issue (preview first, then confirm)">Save to issue #${esc(saveIssue.number)}…</button>` : ''}
    </div>`;
  // rendered on every event: rebuilt only when it changes, so a hover popover over an input stays open
  const box = $('#run-summary');
  if (box._html === html || box.querySelector('.run-title-input') === document.activeElement) return;
  box._html = html;
  box.innerHTML = html;
  $('#btn-run-sup').onclick = () => openSupervisorForCurrent();
  if ($('#btn-run-watch')) $('#btn-run-watch').onclick = () => openSupervisorForCurrent({ watch: true });
  if ($('#btn-run-resume')) $('#btn-run-resume').onclick = () => openResumeDialog(r.id);
  if ($('#btn-run-save-issue')) {
    $('#btn-run-save-issue').onclick = () => window.openDuoSaveToIssue({ runId: r.id, issue: saveIssue, mock: !!r.mock, docSkill: r.inputs?.document_skill || '' });
  }
}

// A run input in the Details panel: one line cut with an ellipsis (paths keep their end), the full
// text on hover (a scrollable popover for long values). Arrays read as a list (issue URLs as #N).
const ISSUE_URL_RE = /\/(?:issues|pull|merge_requests|-\/issues)\/(\d+)\/?$/;
function inputText(v) {
  if (Array.isArray(v)) {
    const items = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x)));
    const refs = items.map((x) => ISSUE_URL_RE.exec(x)?.[1]);
    return { line: refs.every(Boolean) ? refs.map((n) => `#${n}`).join(', ') : items.join(', '), full: items.join('\n') };
  }
  if (v && typeof v === 'object') return { line: JSON.stringify(v), full: JSON.stringify(v, null, 2) };
  const s = String(v);
  return { line: s.replace(/\s*\n\s*/g, ' ⏎ '), full: s };
}
const looksLikePath = (s) => !/\n/.test(s) && /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/])/.test(s);
function inputValueCell(v) {
  const { line, full } = inputText(v);
  const long = full.length > 200 || full.includes('\n');
  const text = looksLikePath(line) ? `<span class="kv-path"><bdi>${esc(line)}</bdi></span>` : esc(line);
  return long ? `<dd class="kv-line" data-full="${esc(full)}">${text}</dd>` : `<dd class="kv-line" title="${esc(full)}">${text}</dd>`;
}

// One floating popover for elements with data-full (long run inputs): scrollable, stays open while
// the mouse moves into it, so a task of thousands of characters stays readable.
function initFullTextPopover() {
  const pop = document.createElement('div');
  pop.className = 'full-pop hidden';
  document.body.appendChild(pop);
  let owner = null;
  let timer = null;
  const hide = () => { clearTimeout(timer); timer = setTimeout(() => { pop.classList.add('hidden'); owner = null; }, 200); };
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[data-full]');
    if (el || pop.contains(e.target)) clearTimeout(timer);
    if (!el || el === owner) return;
    owner = el;
    pop.textContent = el.dataset.full;
    pop.classList.remove('hidden');
    const b = el.getBoundingClientRect();
    const w = Math.min(560, window.innerWidth - 24);
    pop.style.width = `${w}px`;
    pop.style.left = `${Math.max(12, Math.min(b.left, window.innerWidth - w - 12))}px`;
    const below = window.innerHeight - b.bottom - 12;
    pop.style.maxHeight = `${Math.max(below, b.top - 12, 120)}px`;
    if (below >= Math.min(pop.scrollHeight, 240) || below >= b.top) { pop.style.top = `${b.bottom + 4}px`; pop.style.bottom = ''; }
    else { pop.style.top = ''; pop.style.bottom = `${window.innerHeight - b.top + 4}px`; }
  });
  document.addEventListener('mouseout', (e) => {
    const from = e.target.closest?.('[data-full]') || (pop.contains(e.target) ? pop : null);
    if (!from) return;
    const to = e.relatedTarget;
    if (to && (pop.contains(to) || to.closest?.('[data-full]') === owner)) return;
    hide();
  });
}

function renderRunBanner() {
  const r = state.run;
  const box = $('#run-fail-banner');
  const show = r?.status === 'failed';
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const key = `${r.id}:${issueRefs(r)}:${r.error || ''}`;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.innerHTML = `<div class="fail-banner-text"><b>The workflow failed: ${esc(runLabel(r))}</b><span class="muted small mono">${esc(r.id)}</span>${r.error ? `<span class="mono small" title="${esc(r.error)}">${esc(r.error)}</span>` : ''}</div>
    <button class="btn sm sup-btn solid" id="btn-banner-sup"><span class="sup-mark">◆</span> Ask the supervisor</button>`;
  $('#btn-banner-sup').onclick = () => openSupervisorForCurrent();
}

// The Run screen's steps: only those that ran, one collapsible section per workflow group (the
// current step's group open), a step in no group on its own; "Show all steps" adds the others.
function renderSteps() {
  const v = selectedView();
  const all = [...v.steps.values()];
  const shown = v.allSteps ? all : all.filter((s) => s.visits > 0);
  const groupOf = new Map(v.groups.flatMap((g) => g.steps.map((id) => [id, g.name])));
  const current = v.trail?.steps.at(-1)?.step || all.find((s) => s.status === 'running' || s.status === 'waiting')?.id;
  const item = (s) => `
    <li class="${s.status}">
      <span class="dot"></span>
      <span>${esc(s.id)}<br><span class="kind"${s.agent ? ` title="${esc(s.agent)}"` : ''}>${s.type === 'human_approval' ? 'human approval' : esc(agentLabel(s.agent, v.run?.agentNames))}</span></span>
      <span class="visits">${s.visits ? '×' + s.visits : ''}</span>
    </li>`;
  // in the workflow's step order: a group where its first shown step is
  const sections = [];
  const byGroup = new Map();
  for (const s of shown) {
    const name = groupOf.get(s.id);
    if (name == null) { sections.push({ steps: [s] }); continue; }
    if (!byGroup.has(name)) { byGroup.set(name, { name, steps: [] }); sections.push(byGroup.get(name)); }
    byGroup.get(name).steps.push(s);
  }
  const html = sections.map((sec) => {
    if (sec.name == null) return `<ol class="steps">${item(sec.steps[0])}</ol>`;
    const open = v.openGroups.get(sec.name) ?? sec.steps.some((s) => s.id === current);
    const st = sec.steps.some((s) => s.status === 'running') ? 'running' : sec.steps.some((s) => s.status === 'waiting') ? 'waiting' : sec.steps.some((s) => s.visits) ? 'done' : 'pending';
    return `<details class="step-group ${st}" data-group="${esc(sec.name)}" ${open ? 'open' : ''}>
      <summary><span class="dot"></span><b>${esc(sec.name)}</b><span class="muted small">${sec.steps.filter((s) => s.visits).length}/${sec.steps.length}</span></summary>
      <ol class="steps">${sec.steps.map(item).join('')}</ol>
    </details>`;
  }).join('');
  const hidden = all.length - all.filter((s) => s.visits > 0).length;
  const toggle = hidden ? `<button type="button" class="link-btn small" data-all-steps>${v.allSteps ? 'Hide the steps that did not run' : `Show all steps (${hidden} not run)`}</button>` : '';
  const box = $('#steps');
  const out = (html || '<p class="muted small">No step has run yet.</p>') + toggle;
  if (box.dataset.html === out) return;
  box.dataset.html = out;
  box.innerHTML = out;
  box.querySelectorAll('.step-group > summary').forEach((sum) => (sum.onclick = () => {
    v.openGroups.set(sum.parentElement.dataset.group, !sum.parentElement.open);
  }));
  const btn = box.querySelector('[data-all-steps]');
  if (btn) btn.onclick = () => { v.allSteps = !v.allSteps; renderSteps(); };
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
        <span class="name" title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))}</span>
        <span class="id">${esc(s.id)}</span>
        <span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span>
      </div>
      <div class="badges">
        <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span>
        <span class="badge">${esc(s.model)}</span>
        ${isOrch ? '' : `<span class="badge">${s.turns || 0} turn(s)</span>`}
      </div>
      <div class="metrics">
        <div class="metric"><label>open</label><b>${fmtDur(liveDuration(s))}</b></div>
        ${isOrch ? `
        <div class="metric"><label>steps</label><b>${[...state.steps.values()].reduce((a, x) => a + x.visits, 0)}</b></div>
        <div class="metric"><label>child sessions</label><b>${list.length - 1}</b></div>
        <div class="metric"><label>total cost</label><b>${fmtCost(totals().cost)}</b></div>` : `
        <div class="metric"><label>active</label><b>${fmtDur(s.active_ms)}</b></div>
        <div class="metric"><label>in / out</label><b>${fmtNum((t.input || 0) + (t.cache_read || 0))} / ${fmtNum(t.output)}</b></div>
        <div class="metric"><label>cost</label><b>${fmtCost(s.cost_usd)}</b></div>`}
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
    case 'tool_result': return detailsBlock(key, 'tool_result', `result${item.is_error ? ' (error)' : ''}`, item.output);
    case 'stderr': return `<div class="item stderr"><div class="label">stderr</div><pre>${esc(item.text)}</pre></div>`;
    case 'spawn': return `<div class="item spawn"><div class="label">process</div><pre>${esc(item.command)} ${esc(item.args.join(' '))}\ncwd: ${esc(item.cwd)}</pre></div>`;
    default: return `<div class="item raw"><div class="label">event</div><pre>${esc(item.text || JSON.stringify(item.event))}</pre></div>`;
  }
}

function renderDetail() {
  const box = $('#tab-detail');
  const s = state.sessions.get(state.selected);
  if (!s) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  let html = `
    <div class="detail-head">
      <h3 title="${esc(s.agent)}">${esc(agentLabel(s.agent, selectedView()?.run?.agentNames))} <span class="muted small mono">${esc(s.agent)}</span> <span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="badge">${esc(s.model)}</span></h3>
      <div class="detail-actions">
        ${termButtons('live', s.id === 'orchestrator' ? 'Follow the orchestrator log (steps, transitions, sessions, approvals) in a terminal' : 'Follow this session live in a terminal')}
        ${s.id === 'orchestrator' ? '' : termButtons('cli', '', cliBlocked(s))}
        ${s.id === 'orchestrator' ? '<button class="btn sm ghost sup-btn" data-sup><span class="sup-mark">◆</span> Ask the supervisor</button>' : ''}
        <span class="muted small" data-term-msg></span>
      </div>
      <dl class="kv">
        <dt>session</dt><dd>${esc(s.id)}</dd>
        <dt>provider session</dt><dd>${esc(s.provider_session_id || '—')}</dd>
        <dt>status</dt><dd>${esc(s.status)}</dd>
        <dt>opened at</dt><dd>${esc(timeOf(s.opened_at))}${s.closed_at ? ' → ' + esc(timeOf(s.closed_at)) : ''}</dd>
        <dt>duration / active / idle</dt><dd>${fmtDur(liveDuration(s))} / ${fmtDur(s.active_ms)} / ${fmtDur(s.idle_ms)}</dd>
        <dt>tokens</dt><dd>in ${fmtNum(s.tokens?.input)} · cache r/w ${fmtNum(s.tokens?.cache_read)}/${fmtNum(s.tokens?.cache_write)} · out ${fmtNum(s.tokens?.output)} · reasoning ${fmtNum(s.tokens?.reasoning)}</dd>
        <dt>cost</dt><dd>${fmtCost(s.cost_usd)}</dd>
      </dl>
    </div>`;

  if (s.id === 'orchestrator') {
    html += `<div class="orch-log">${state.orchLog.map((l) =>
      `<div class="line ${esc(l.level)}"><span class="ts">${esc(timeOf(l.ts))}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  } else {
    html += [...s.turnLog.values()].map((t) => `
      <div class="turn">
        <div class="turn-head">
          <span class="t">Turn ${t.n}</span><span class="muted">${esc(t.stepId || '')}</span>
          <span class="meta">${t.result ? `${fmtDur(t.result.duration)} · in ${fmtNum((t.result.usage?.input || 0) + (t.result.usage?.cache_read || 0))} · out ${fmtNum(t.result.usage?.output)} · ${fmtCost(t.result.cost)}` : 'in progress…'}</span>
        </div>
        <div class="turn-body">
          ${t.prompt != null ? detailsBlock(`${s.id}:${t.n}:prompt`, 'prompt', 'prompt sent', t.prompt) : ''}
          ${t.items.map((it, i) => renderItem(s.id, t.n, it, i)).join('')}
          ${t.result ? `<div class="usage-row">
              <span>input ${fmtNum(t.result.usage?.input)}</span><span>cache read ${fmtNum(t.result.usage?.cache_read)}</span>
              <span>cache write ${fmtNum(t.result.usage?.cache_write)}</span><span>output ${fmtNum(t.result.usage?.output)}</span>
              <span>reasoning ${fmtNum(t.result.usage?.reasoning)}</span></div>` : ''}
        </div>
      </div>`).join('') || '<p class="empty muted">Waiting for the first turn…</p>';
  }

  box.innerHTML = html;
  box.querySelector('[data-sup]')?.addEventListener('click', () => openSupervisorForCurrent());
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async () => {
    const msg = box.querySelector('[data-term-msg]');
    const r = await termAction(b, { sessionId: s.id, runId: state.run?.id, label: s.agent });
    if (msg) { msg.textContent = r.text; msg.classList.toggle('error', r.error); }
  }));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

// Why "Open in CLI" is not available for a session right now ('' = available).
function cliBlocked(s) {
  if (s.provider === 'mock') return 'Simulated sessions have no CLI conversation.';
  if (!s.provider_session_id) return 'Available after the first turn finishes.';
  if (s.status === 'active' || s.status === 'retrying') return 'The agent is in the middle of a turn.';
  return '';
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

registerView({
  id: 'run',
  markup: `
      <section id="view-run" class="view hidden">
        <div id="run-fail-banner" class="fail-banner hidden"></div>
        <div id="run-gates" class="run-gates hidden" aria-live="polite"></div>
        <div class="run-modebar">
          <div class="seg sm" role="group" aria-label="Run view">
            <button id="run-mode-chat" type="button" title="Follow this run as a chat">Chat</button>
            <button type="button" class="active" aria-pressed="true">Details</button>
          </div>
        </div>
        <div class="run-layout">
          <aside class="panel config">
            <section>
              <h2>Workflow</h2>
              <div id="run-summary" class="run-summary"><p class="muted small">No workflow started.</p></div>
            </section>
            <section>
              <h2>Steps</h2>
              <div id="steps" class="step-groups"></div>
            </section>
          </aside>

          <section class="panel sessions-panel">
            <h2>Sessions</h2>
            <div id="sessions" class="sessions">
              <p class="empty muted">No sessions yet. Click <b>Start</b> at the top to pick a workflow.</p>
            </div>
          </section>

          <section class="panel detail-panel">
            <div class="tabs">
              <button class="tab active" data-tab="detail">Session</button>
              <button class="tab" data-tab="events">Events</button>
              <button class="tab" data-tab="artifacts" title="The files this run produced">Artifacts <span id="tab-artifacts-count" class="tab-count hidden"></span></button>
            </div>
            <div id="tab-detail" class="tab-body">
              <p class="empty muted">Select a session to see prompts, thinking, tool calls and output.</p>
            </div>
            <div id="tab-events" class="tab-body hidden"></div>
            <div id="tab-artifacts" class="tab-body hidden"></div>
          </section>
        </div>
      </section>`,
  mount() {
    $('#run-gates').onclick = onRunGateClick;
    document.querySelectorAll('.tab[data-tab]').forEach((t) => (t.onclick = () => switchTab(t.dataset.tab)));
    $('#tab-detail').addEventListener('toggle', (e) => {
      const key = e.target.dataset?.key;
      if (!key) return;
      e.target.open ? state.openDetails.add(key) : state.openDetails.delete(key);
    }, true);
  },
  show() {
    scheduleRender();
  },
});
