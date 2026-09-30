// Write & Review: runs the writer-reviewer workflow and shows it as a chat between the writer,
// the reviewer and the platform's supervisor. The chat is rebuilt from the run's events, live
// (run:event) or from a past run's events.jsonl (Workflows › Runs › "Open chat").
(() => {
  const $d = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const WORKFLOW = 'writer-reviewer';
  const FILE = 'writer-reviewer.yaml';

  const PROVIDERS = {
    'claude-code': { label: 'Claude Code', key: 'claude', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5'] },
    'codex-cli': { label: 'Codex CLI', key: 'codex', models: ['gpt-6-luna'] },
    'grok-cli': { label: 'Grok Build', key: 'grok', models: ['grok-4.7'] },
  };
  const BY_KEY = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [p.key, id]));
  const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
  // shared with the AI Arena screen (arena.js)
  window.ChatModels = { PROVIDERS, EFFORTS };
  // Simulation scenarios (developer mode): what the simulated agents answer, as the engine's
  // mockSequences ({ field: [value per visit] }; invalid_answers: { step: n } = first n answers invalid).
  const SCENARIOS = {
    happy: { label: 'Approved on the 3rd review', seq: {} },
    first: { label: 'Approved on the 1st review', seq: { score: [9] } },
    never: { label: 'Never reaches the score (rounds run out)', seq: { score: [4, 5, 6] } },
    gaps: { label: 'Supervisor finds gaps in the approved draft', seq: { ready: [false, true], ok: [false, true] } },
    format: { label: 'Reviewer answers in the wrong format (supervisor steps in)', seq: { invalid_answers: { review: 3 } } },
  };
  const LS = 'multiagent.duo';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
  // Setup of the two user-chosen roles; the supervisor is internal (fixed in the workflow, never shown).
  const config = {
    writer: { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'high', ...saved.writer },
    reviewer: { provider: 'codex-cli', model: 'gpt-6-luna', effort: 'high', ...saved.reviewer },
    supervisor: { internal: true },
  };
  const NAMES = { writer: 'Writer', reviewer: 'Reviewer', supervisor: 'Supervisor' };
  // Which role an agent / step of the workflow plays in the chat.
  const ROLE_OF_AGENT = { writer: 'writer', reviewer: 'reviewer', signoff: 'supervisor', supervisor: 'supervisor', _supervisor: 'supervisor' };
  const ROLE_OF_STEP = { write: 'writer', review: 'reviewer', signoff: 'supervisor' };
  const ICON_DOC = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></svg>';

  // ---------------------------------------------------------------- robots
  // Robots on the left of the chat (writer, supervisor) are mirrored so they face the conversation.
  const MIRRORED = { writer: true, supervisor: true };
  let roles = config; // the setup, or the roles of the run being shown
  const variantOf = (role) => (roles[role].internal ? 'supervisor' : Robots.variantFor(roles[role].provider, roles[role].model));
  // The name plate shows the chosen model; the internal supervisor keeps its own generic plate.
  const plaqueOf = (role) => (roles[role].internal ? undefined : Robots.plaqueFor(roles[role].model));
  const robotSvg = (role, st = 'idle', opts = {}) => Robots.svg(variantOf(role), st, { mirror: MIRRORED[role], plaque: plaqueOf(role), ...opts });
  // Chat messages keep a still, balloon-less robot; only the live ones animate.
  const avatar = (role) => `<span class="duo-robot still ${role}" aria-hidden="true">${robotSvg(role, 'idle', { bubble: false })}</span>`;
  const DOING = {
    writer: { thinking: 'Writer is thinking', writing: 'Writer is writing', reading: 'Writer is reading the notes' },
    reviewer: { thinking: 'Reviewer is thinking', writing: 'Reviewer is writing the review', reading: 'Reviewer is reading the draft' },
    supervisor: { thinking: 'Supervisor is thinking', writing: 'Supervisor is writing', reading: 'Supervisor is checking the run' },
  };

  // ---------------------------------------------------------------- setup form
  function fillAgentForm(role) {
    const c = config[role];
    const prov = $d(`select[data-role="${role}"][data-field="provider"]`);
    const model = $d(`select[data-role="${role}"][data-field="model"]`);
    prov.innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}"${k === c.provider ? ' selected' : ''}>${p.label}</option>`).join('');
    model.innerHTML = PROVIDERS[c.provider].models.map((m) => `<option${m === c.model ? ' selected' : ''}>${m}</option>`).join('');
    prov.onchange = () => { c.provider = prov.value; c.model = PROVIDERS[c.provider].models[0]; fillAgentForm(role); };
    model.onchange = () => { c.model = model.value; fillAgentForm(role); };
    const seg = $d(`.duo-effort[data-role="${role}"]`);
    seg.innerHTML = EFFORTS.map((e) => `<button type="button" data-effort="${e}" class="${e === c.effort ? 'active' : ''}">${e}</button>`).join('');
    seg.querySelectorAll('button').forEach((b) => (b.onclick = () => { c.effort = b.dataset.effort; fillAgentForm(role); }));
    const prev = roles;
    roles = config;
    const slot = $d(`[data-robot="${role}"]`);
    const key = `${variantOf(role)}:${c.model}`;
    if (slot.dataset.key !== key) { slot.dataset.key = key; slot.innerHTML = robotSvg(role, 'idle'); }
    roles = prev;
  }

  function readSetup() {
    const inputs = {
      prompt: $d('#duo-prompt').value.trim(),
      goal: $d('#duo-goal').value.trim(),
      threshold: +$d('#duo-threshold').value || 8,
      max_rounds: Math.max(1, Math.round(+$d('#duo-rounds').value || 5)),
      project_path: projects.find((p) => p.id === $d('#duo-project').value)?.folder || '',
    };
    for (const role of ['writer', 'reviewer']) {
      const c = config[role];
      Object.assign(inputs, { [`${role}_provider`]: PROVIDERS[c.provider].key, [`${role}_model`]: c.model, [`${role}_effort`]: c.effort });
    }
    return inputs;
  }

  async function startRun() {
    const err = $d('#duo-error');
    err.textContent = '';
    const inputs = readSetup();
    if (!inputs.prompt || !inputs.goal) { err.textContent = 'Write the prompt and the goal first.'; return; }
    // simulation only in developer mode (the checkbox is hidden otherwise); checked without it fails
    let mock;
    try { mock = wantsSimulation($d('#duo-mock')); } catch (e) { err.textContent = e.message; return; }
    const scenario = $d('#duo-scenario').value;
    try { localStorage.setItem(LS, JSON.stringify({ writer: config.writer, reviewer: config.reviewer, prompt: inputs.prompt, goal: inputs.goal, threshold: inputs.threshold, max_rounds: inputs.max_rounds, scenario, project: $d('#duo-project').value })); } catch { /* ignore */ }
    $d('#duo-run').disabled = true;
    try {
      starting = true; // the run's first events may arrive before startRun resolves
      const { runId } = await api.startRun({ file: FILE, inputs, mock, mockSequences: mock ? SCENARIOS[scenario]?.seq : null });
      bindLive(runId);
    } catch (e) {
      starting = false;
      buffer = [];
      err.textContent = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      $d('#duo-run').disabled = false;
    }
  }

  // Projects (Projects view): the chosen one's folder is the agents' working folder, read-only.
  let projects = [];
  async function loadProjects() {
    try { projects = await api.listProjects(); } catch { projects = []; }
    const sel = $d('#duo-project');
    const current = sel.value || saved.project || '';
    sel.innerHTML = '<option value="">No project (prompt and goal only)</option>' + projects.map((p) =>
      `<option value="${esc(p.id)}"${p.exists ? '' : ' disabled'}${p.id === current && p.exists ? ' selected' : ''}>${esc(p.name)}${p.exists ? '' : ' (folder missing)'}</option>`).join('');
    const hint = () => {
      const p = projects.find((x) => x.id === sel.value);
      $d('#duo-project-hint').textContent = p ? `${p.folder}: the writer and the reviewer read its files (read-only).` : 'The writer and the reviewer read its files (read-only) to ground the document.';
    };
    sel.onchange = hint;
    hint();
  }

  // ---------------------------------------------------------------- chat state
  const chat = { runId: null, live: false, running: false };
  function resetChat(runId, live) {
    Object.assign(chat, {
      runId, live, running: live, seq: 0, runDir: null, mock: false,
      threshold: 8, maxRounds: 5, round: 0, scores: [], docs: [], docView: -1,
      interventions: 0, usage: {}, sessions: new Map(), openStep: null, typing: null, cost: 0,
    });
    $d('#duo-setup').classList.add('hidden');
    $d('#duo-chat').classList.remove('hidden');
    $d('#duo-messages').innerHTML = '';
    $d('#duo-checks').innerHTML = '';
    $d('#duo-interventions').textContent = '0/6';
    $d('#duo-round').textContent = '0';
    $d('#duo-chat-status').textContent = live ? 'starting…' : 'loading…';
    $d('#duo-stop').classList.toggle('hidden', !live);
    setSuperPill('watch', 'watching');
    renderScores();
    renderDoc();
    ['writer', 'reviewer', 'supervisor'].forEach((role) => { delete $d(`[data-cast="${role}"]`).dataset.state; });
  }

  function clock(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const fmtDur = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${Math.round((ms || 0) / 1000)}s`);

  function addToChat(html) {
    const box = $d('#duo-messages');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    const typing = box.querySelector('.duo-typing');
    if (typing) typing.insertAdjacentHTML('beforebegin', html);
    else box.insertAdjacentHTML('beforeend', html);
    if (stick && chat.live) box.scrollTop = box.scrollHeight;
  }

  // The live robot below the last message (thinking, reading, writing…).
  function setTyping(role, st = 'thinking') {
    const box = $d('#duo-messages');
    box.querySelector('.duo-typing')?.remove();
    chat.typing = role ? { role, st } : null;
    if (!role) return;
    setCast(role, st);
    if (!chat.live) return;
    const label = DOING[role][st] || DOING[role].thinking;
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    box.insertAdjacentHTML('beforeend', `<div class="duo-typing ${role}"><span class="duo-robot ${role}" aria-hidden="true">${robotSvg(role, st)}</span><span class="duo-dots"><i></i><i></i><i></i></span><span>${label}…</span></div>`);
    if (stick) box.scrollTop = box.scrollHeight;
    $d('#duo-chat-status').textContent = `${label}…`;
  }

  // Header cast: the three robots with what each one is doing right now.
  function setCast(role, st) {
    const el = $d(`[data-cast="${role}"]`);
    if (el.dataset.state === st) return;
    el.dataset.state = st;
    el.innerHTML = robotSvg(role, st, { bubble: false });
    $d(`[data-cast-state="${role}"]`).textContent = st;
  }

  function setSuperPill(kind, text) {
    const pill = $d('#duo-super-state');
    pill.className = `pill pill-${kind}`;
    pill.textContent = text;
  }

  function renderScores() {
    $d('#duo-scores').innerHTML = chat.scores
      .map((s) => `<span class="${s >= chat.threshold ? 'pass' : ''}" style="height:${Math.max(3, s * 2.6)}px" title="${s}/10"></span>`).join('');
  }

  function renderDoc() {
    $d('#duo-versions').innerHTML = chat.docs.map((_, i) => `<button type="button" class="${i === chat.docView ? 'active' : ''}" data-v="${i}">v${i + 1}</button>`).join('');
    $d('#duo-versions').querySelectorAll('button').forEach((b) => (b.onclick = () => { chat.docView = +b.dataset.v; renderDoc(); }));
    $d('#duo-doc-body').innerHTML = chat.docView < 0 ? '<p class="muted">No draft yet.</p>' : md(chat.docs[chat.docView]);
  }

  function addCheck(cls, text) {
    $d('#duo-checks').insertAdjacentHTML('beforeend', `<li class="${cls}">${esc(text)}</li>`);
  }

  function footOf(stepId) {
    const u = chat.usage[stepId];
    if (!u || !u.ms) return '';
    return `${fmtK(u.input)} in / ${fmtK(u.output)} out · $${u.cost.toFixed(2)} · ${fmtDur(u.ms)}`;
  }

  function message(role, body, ts, stepId) {
    const c = roles[role];
    const tag = c.internal ? '' : `<span class="tag">${esc(c.model)} · ${esc(c.effort)}</span>`;
    const foot = footOf(stepId);
    addToChat(`<div class="duo-msg ${role}">${avatar(role)}<div class="duo-bubble">
      <div class="duo-meta"><b>${NAMES[role]}</b>${tag}<span class="time">${clock(ts)}</span></div>
      ${body}${foot ? `<div class="duo-foot">${esc(foot)}</div>` : ''}</div></div>`);
    // a failure stops shaking once someone answers it
    document.querySelectorAll('#duo-messages .duo-fail .duo-robot').forEach((r) => r.classList.add('still'));
  }

  function failRow(role, text) {
    addToChat(`<div class="duo-fail"><span class="duo-robot ${role}${chat.live ? '' : ' still'}" aria-hidden="true">${robotSvg(role, 'error')}</span><span class="duo-fail-text">${esc(text)}</span></div>`);
    setCast(role, 'error');
  }

  function note(html, cls = 'plain') {
    addToChat(`<div class="duo-note ${cls}"><span>${html}</span></div>`);
  }

  // ---------------------------------------------------------------- events → chat
  function apply(ev) {
    if (ev.seq && ev.seq <= chat.seq) return; // already shown (replay + live overlap)
    if (ev.seq) chat.seq = ev.seq;
    switch (ev.type) {
      case 'workflow.started': return onStarted(ev);
      case 'session.opened': chat.sessions.set(ev.session_id, ev.session?.agent); return;
      case 'step.started': return onStepStarted(ev);
      case 'session.stream': return onStream(ev);
      case 'session.message_received': return onMessage(ev);
      case 'log': return onLog(ev);
      case 'supervisor.started':
        chat.supervised = ev.step_id;
        setTyping('supervisor', 'reading');
        addCheck('act', `${ev.step_id} failed: ${String(ev.error || '').slice(0, 140)}`);
        return;
      case 'supervisor.decision': return onDecision(ev);
      case 'step.finished': return onStepFinished(ev);
      case 'approval.requested': return onApproval(ev);
      case 'approval.resolved': return onApprovalResolved(ev);
      case 'workflow.finished': return onFinished(ev);
      default:
    }
  }

  function onStarted(ev) {
    const i = ev.inputs || {};
    roles = {
      writer: { provider: BY_KEY[i.writer_provider] || 'claude-code', model: i.writer_model || '', effort: i.writer_effort || '' },
      reviewer: { provider: BY_KEY[i.reviewer_provider] || 'codex-cli', model: i.reviewer_model || '', effort: i.reviewer_effort || '' },
      supervisor: { internal: true },
    };
    Object.assign(chat, { threshold: +i.threshold || 8, maxRounds: +i.max_rounds || 5, runDir: ev.run_dir, mock: !!ev.mock });
    ['writer', 'reviewer', 'supervisor'].forEach((role) => setCast(role, 'idle'));
    $d('#duo-round').textContent = `0/${chat.maxRounds}`;
    $d('#duo-chat-title').innerHTML = `<span style="color:var(--writer)">${esc(roles.writer.model)}</span> <span class="muted">⇄</span> <span style="color:var(--reviewer)">${esc(roles.reviewer.model)}</span>`;
    addToChat(`<div class="duo-msg user"><div class="duo-bubble">
      <div class="duo-meta"><b>You</b><span class="time">${clock(ev.ts)}</span></div>
      <p><b>Prompt</b> <span class="duo-msg-text">${esc(i.prompt)}</span></p>
      <p><b>Goal</b> <span class="duo-msg-text">${esc(i.goal)}</span></p></div></div>`);
    const project = i.project_path ? (projects.find((p) => p.folder === i.project_path)?.name || i.project_path) : '';
    note(`Run started${ev.mock ? ' · <b>simulation</b>' : ''}${project ? ` · project <b>${esc(project)}</b> (read-only)` : ''} · approve at ${chat.threshold}/10 · max ${chat.maxRounds} rounds`);
    addCheck('ok', `Run started${ev.mock ? ' (simulation, no model calls)' : ''}`);
    $d('#duo-chat-status').textContent = 'running';
  }

  function onStepStarted(ev) {
    const role = ROLE_OF_STEP[ev.step_id];
    chat.openStep = ev.step_id;
    chat.usage[ev.step_id] = { input: 0, output: 0, cost: 0, ms: 0 };
    chat.invalid = 0;
    if (ev.step_id === 'write') {
      chat.round = ev.visit;
      $d('#duo-round').textContent = `${chat.round}/${chat.maxRounds}`;
    }
    if (role) setTyping(role, role === 'writer' ? 'thinking' : 'reading');
  }

  // What the CLI streams says what the robot is doing: reasoning, using a tool, writing.
  function onStream(ev) {
    if (!chat.typing) return;
    const role = ROLE_OF_AGENT[chat.sessions.get(ev.session_id)];
    if (role !== chat.typing.role) return;
    const st = { thinking: 'thinking', text: 'writing', tool_call: 'reading' }[ev.item?.kind];
    if (st && st !== chat.typing.st) setTyping(role, st);
  }

  function onMessage(ev) {
    const stepId = String(ev.step_id || '').split(':')[0];
    const u = (chat.usage[stepId] ??= { input: 0, output: 0, cost: 0, ms: 0 });
    u.input += (ev.usage?.input || 0) + (ev.usage?.cache_read || 0) + (ev.usage?.cache_write || 0);
    u.output += ev.usage?.output || 0;
    u.cost += ev.cost_usd || 0;
    u.ms += ev.duration_ms || 0;
    chat.cost += ev.cost_usd || 0;
  }

  function onLog(ev) {
    const msg = String(ev.message || '');
    const m = /^Invalid output in (\w+)/.exec(msg);
    if (m && ROLE_OF_STEP[m[1]]) {
      const role = ROLE_OF_STEP[m[1]];
      // the engine asks again twice, then the step fails and the supervisor looks at it
      const last = ++chat.invalid >= 3;
      failRow(role, `Answer rejected: ${msg.replace(/^Invalid output in \w+(?: \([^)]*\))?: /, '').slice(0, 160)}. ${last ? 'Calling the supervisor.' : 'Asked again.'}`);
      addCheck('warn', `${NAMES[role]}'s answer did not match its format; ${last ? 'gave up' : 'asked again'}`);
      if (chat.live && !last) setTyping(role, 'thinking');
      return;
    }
    if (/^loop "rounds" reached/.test(msg)) { addCheck('warn', `All ${chat.maxRounds} reviews used without approval`); return; }
    if (ev.level === 'error' && /attempt \d+\/\d+ failed/.test(msg)) addCheck('warn', msg.slice(0, 160));
  }

  function onDecision(ev) {
    chat.interventions++;
    $d('#duo-interventions').textContent = `${chat.interventions}/6`;
    const target = ROLE_OF_STEP[ev.step_id];
    const mention = target && target !== 'supervisor' ? `<span class="duo-mention">@${NAMES[target]}</span> ` : '';
    const what = {
      retry: 'I asked for a new attempt.', fix_output: 'I fixed the answer so the run can continue.', goto: `I moved the run to "${esc(ev.goto)}".`,
      ask_human: 'This needs you: see the question below.', fail: 'I could not recover this step.',
    }[ev.action] || '';
    setTyping(null);
    message('supervisor', `<p>${mention}<span class="duo-msg-text">${esc(ev.explanation)}</span></p>
      ${ev.instruction ? `<p class="duo-msg-text">${esc(ev.instruction)}</p>` : ''}<p class="muted small">${what}</p>`, ev.ts, ev.step_id);
    addCheck('act', `Intervened on ${ev.step_id}: ${ev.action}`);
  }

  function onStepFinished(ev) {
    const role = ROLE_OF_STEP[ev.step_id];
    if (chat.openStep === ev.step_id) chat.openStep = null;
    if (!role) return;
    setTyping(null);
    const o = ev.output || {};
    if (ev.error) {
      // a failure the supervisor already explained in the chat needs no second row
      if (chat.supervised !== ev.step_id) failRow(role, `${NAMES[role]} failed: ${String(o.error || 'unknown error').slice(0, 200)}`);
      chat.supervised = null;
      return;
    }
    setCast(role, 'idle');
    if (ev.step_id === 'write') {
      chat.docs.push(String(o.document || ''));
      chat.docView = chat.docs.length - 1;
      renderDoc();
      const words = String(o.document || '').split(/\s+/).filter(Boolean).length;
      message('writer', `<p class="duo-msg-text">${esc(o.message)}</p>
        <button type="button" class="duo-doc-card" data-v="${chat.docView}">${ICON_DOC}<span><b>document.md · v${chat.docs.length}</b><small>${words} words · click to view</small></span></button>`, ev.ts, 'write');
    }
    if (ev.step_id === 'review') {
      const score = +o.score || 0;
      chat.scores.push(score);
      renderScores();
      const pass = score >= chat.threshold;
      const notes = (o.notes || []).map((n) => `<li><span class="sev ${n.severity === 'major' ? 'major' : 'minor'}">${esc(n.severity)}</span>${esc(n.text)}</li>`).join('');
      message('reviewer', `<div class="duo-score ${pass ? 'pass' : ''}"><span class="duo-score-num">${score.toFixed(1)}<small>/10</small></span>
        <span class="duo-score-bar"><i style="width:${Math.min(100, score * 10)}%"></i><b style="left:${chat.threshold * 10}%"></b></span>
        <span class="duo-verdict ${pass ? 'approve' : 'revise'}">${pass ? 'approved' : 'revise'}</span></div>
        <p class="duo-msg-text">${esc(o.summary)}</p>${notes ? `<ul>${notes}</ul>` : ''}`, ev.ts, 'review');
      addCheck(pass ? 'ok' : '', `Round ${chat.round}: ${score.toFixed(1)}/10${pass ? ' (approved)' : ''}`);
    }
    if (ev.step_id === 'signoff') {
      const checks = (o.checks || []).map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '✗'}</b><span>${esc(c.item)}</span></li>`).join('');
      message('supervisor', `${o.ready ? '<div class="duo-ready">✓ Ready</div>' : '<div class="duo-not-ready">↺ Not ready yet</div>'}
        <p class="duo-msg-text">${esc(o.summary)}</p>${checks ? `<ul class="duo-checklist">${checks}</ul>` : ''}`, ev.ts, 'signoff');
      addCheck(o.ready ? 'ok' : 'warn', o.ready ? 'Final check against the goal: passed' : 'Final check: sent back to the writer');
    }
  }

  // Human gates are the supervisor asking the user: its question, the choices and, when the
  // step allows it, a free text that goes to the next prompts (the run-wide `feedback`).
  function onApproval(ev) {
    setTyping(null);
    ['writer', 'reviewer'].forEach((r) => setCast(r, 'waiting'));
    setCast('supervisor', 'waiting');
    const off = chat.live ? '' : ' disabled';
    const choices = ev.choices || [{ id: true, label: 'Approve' }, { id: false, label: 'Reject' }];
    const buttons = choices.map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : ''}" data-approval="${esc(ev.approval_id)}" data-choice="${esc(c.id)}"${off}>${esc(c.label)}</button>`).join('');
    const field = ev.feedback ? `<label class="duo-ask-label">${esc(ev.feedback.label)}</label>
      <textarea class="duo-ask-text" rows="2" placeholder="${esc(ev.feedback.placeholder)}"${off}></textarea>` : '';
    chat.labels = Object.fromEntries(choices.map((c) => [String(c.id), c.label]));
    message('supervisor', `<div class="duo-ask" data-gate="${esc(ev.approval_id)}"><p class="duo-msg-text">${esc(ev.message)}</p>${field}<div class="row">${buttons}</div></div>`, ev.ts);
    $d('#duo-chat-status').textContent = 'The supervisor is waiting for you';
    if (chat.live) document.querySelector(`[data-gate="${ev.approval_id}"] textarea`)?.focus();
  }

  // The user's answer, as their own message.
  function onApprovalResolved(ev) {
    const gate = document.querySelector(`[data-gate="${ev.approval_id}"]`);
    const choice = String(ev.choice ?? ev.approved);
    if (gate) {
      gate.querySelectorAll('button, textarea').forEach((x) => { x.disabled = true; });
      gate.querySelectorAll('button').forEach((x) => { x.classList.remove('primary'); x.classList.toggle('chosen', x.dataset.choice === choice); });
      gate.querySelector('textarea')?.remove();
      gate.querySelector('.duo-ask-label')?.remove();
    }
    const label = chat.labels?.[choice] || choice;
    addToChat(`<div class="duo-msg user reply"><div class="duo-bubble">
      <div class="duo-meta"><b>You</b><span class="time">${clock(ev.ts)}</span></div>
      <p><b>${esc(label)}</b></p>${ev.feedback ? `<p class="duo-msg-text">${esc(ev.feedback)}</p>` : ''}</div></div>`);
    if (ev.feedback) addCheck('act', `Your instruction: ${ev.feedback.slice(0, 120)}`);
    ['writer', 'reviewer', 'supervisor'].forEach((r) => setCast(r, 'idle'));
  }

  function onFinished(ev) {
    chat.running = false;
    setTyping(null);
    $d('#duo-stop').classList.add('hidden');
    const s = ev.summary || {};
    const dur = fmtDur(s.duration_ms || 0);
    const cost = `$${(s.cost_usd ?? chat.cost).toFixed(2)}`;
    const last = chat.scores.at(-1);
    if (ev.status === 'success') {
      const rounds = chat.scores.length;
      note(`<b>Done</b>${last != null ? ` · ${last.toFixed(1)}/10` : ''} after ${rounds} round${rounds === 1 ? '' : 's'} · saved to <span class="mono">document.md</span> · ${cost} · ${dur}`, 'done');
      ['writer', 'reviewer', 'supervisor'].forEach((r) => setCast(r, 'done'));
      setSuperPill('success', 'done');
      addCheck('ok', 'Run finished');
      $d('#duo-chat-status').textContent = 'Finished';
    } else {
      note(`<b>${esc(ev.status)}</b> · ${esc(String(ev.error || '').slice(0, 220))} · ${cost} · ${dur}`, 'failed');
      setSuperPill(ev.status === 'cancelled' ? 'cancelled' : 'failed', ev.status);
      addCheck('warn', `Run ${ev.status}`);
      $d('#duo-chat-status').textContent = ev.status === 'cancelled' ? 'Cancelled' : 'Failed';
    }
  }

  // ---------------------------------------------------------------- live / history
  let starting = false;
  let buffer = [];
  // Events of the run this screen started, or of a writer-reviewer run started elsewhere while
  // nothing is running here. A past run is replayed from its events.jsonl (openRun).
  function onEvent(ev) {
    if (starting) { buffer.push(ev); return; }
    if (ev.type === 'workflow.started' && ev.workflow === WORKFLOW && !chat.running) {
      resetChat(ev.run_id, true);
      apply(ev);
      return;
    }
    if (ev.run_id === chat.runId && chat.live) apply(ev);
  }

  function bindLive(runId) {
    starting = false;
    resetChat(runId, true);
    for (const ev of buffer) if (ev.run_id === runId) apply(ev);
    buffer = [];
  }

  // Opens a run (running or past) from the runs list: replays what is on disk, then follows it
  // live when it is the run in progress.
  async function openRun(runId, { running = false } = {}) {
    if (typeof showView === 'function') showView('duo');
    resetChat(runId, false);
    let events = [];
    try { events = await api.runEvents(runId); } catch (e) { note(`Could not load the run: ${esc(e.message || e)}`, 'failed'); return; }
    for (const ev of events) apply(ev);
    const finished = events.some((e) => e.type === 'workflow.finished');
    chat.live = running && !finished;
    chat.running = chat.live;
    $d('#duo-stop').classList.toggle('hidden', !chat.live);
    if (chat.live && ROLE_OF_STEP[chat.openStep]) setTyping(ROLE_OF_STEP[chat.openStep], 'thinking');
    if (!finished && !chat.live) $d('#duo-chat-status').textContent = 'Interrupted';
    if (!chat.live) $d('#duo-messages').scrollTop = 0;
  }
  window.openDuoRun = openRun;
  // true while this screen shows the live run (its gates are answered in the chat, not in a dialog)
  window.duoShowsRun = (runId) => chat.live && chat.runId === runId
    && !$d('#view-duo').classList.contains('hidden') && !$d('#duo-chat').classList.contains('hidden');
  // the run this screen shows (live or replayed), for desktop notifications
  window.duoShownRunId = () => (!$d('#view-duo').classList.contains('hidden') && !$d('#duo-chat').classList.contains('hidden') ? chat.runId : null);

  // ---------------------------------------------------------------- help ("?")
  // The guide shows the robots of the current setup in a few of their states.
  function openHelp() {
    const prev = roles;
    roles = config;
    const cast = [['writer', 'thinking'], ['writer', 'writing'], ['reviewer', 'reading'], ['reviewer', 'error'], ['supervisor', 'waiting'], ['supervisor', 'done']];
    $d('#duo-help-cast').innerHTML = cast.map(([role, st]) =>
      `<figure><span class="duo-robot ${role}" aria-hidden="true">${robotSvg(role, st)}</span><figcaption><b class="c-${role}">${NAMES[role]}</b> · ${st}</figcaption></figure>`).join('');
    roles = prev;
    $d('#duo-help').classList.remove('hidden');
    $d('#duo-help-close').focus();
  }
  const closeHelp = () => { $d('#duo-help').classList.add('hidden'); $d('#duo-help-cast').innerHTML = ''; };

  function init() {
    if (!$d('#view-duo')) return;
    $d('#duo-help-open').onclick = openHelp;
    $d('#duo-help-open2').onclick = openHelp;
    $d('#duo-help-close').onclick = closeHelp;
    $d('#duo-help').addEventListener('click', (e) => { if (e.target.id === 'duo-help') closeHelp(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$d('#duo-help').classList.contains('hidden')) closeHelp(); });
    for (const k of ['prompt', 'goal']) if (saved[k]) $d(`#duo-${k}`).value = saved[k];
    if (saved.threshold) $d('#duo-threshold').value = saved.threshold;
    if (saved.max_rounds) $d('#duo-rounds').value = saved.max_rounds;
    $d('#duo-scenario').innerHTML = Object.entries(SCENARIOS).map(([k, sc]) => `<option value="${k}"${k === saved.scenario ? ' selected' : ''}>${esc(sc.label)}</option>`).join('');
    const showScenario = () => $d('#duo-scenario-wrap').classList.toggle('hidden', !$d('#duo-mock').checked);
    $d('#duo-mock').addEventListener('change', showScenario);
    showScenario();
    loadProjects();
    // projects created meanwhile show up when the screen is opened again
    document.querySelector('.nav-item[data-view="duo"]').addEventListener('click', loadProjects);
    fillAgentForm('writer');
    fillAgentForm('reviewer');
    $d('[data-robot="supervisor"]').innerHTML = robotSvg('supervisor');
    // the supervisor's look is customizable in Agents
    document.addEventListener('robots:changed', (e) => {
      if (e.detail?.name === 'supervisor') $d('[data-robot="supervisor"]').innerHTML = robotSvg('supervisor');
    });
    $d('#duo-run').onclick = startRun;
    $d('#duo-stop').onclick = () => api.stopRun(chat.runId);
    $d('#duo-logs').onclick = () => chat.runDir && api.openPath(chat.runDir);
    $d('#duo-back').onclick = () => {
      $d('#duo-chat').classList.add('hidden');
      $d('#duo-setup').classList.remove('hidden');
    };
    $d('#duo-edit-workflow').onclick = () => typeof showView === 'function' && showView('workflows');
    $d('#duo-messages').addEventListener('click', (e) => {
      const card = e.target.closest('.duo-doc-card');
      if (card) { chat.docView = +card.dataset.v; renderDoc(); }
      const b = e.target.closest('[data-approval]');
      if (b && chat.live) {
        const v = b.dataset.choice;
        const text = b.closest('.duo-ask')?.querySelector('textarea')?.value || '';
        api.resolveApproval(b.dataset.approval, v === 'true' ? true : v === 'false' ? false : v, text, chat.runId);
      }
    });
    api.onEvent(onEvent);
  }

  init();
})();
