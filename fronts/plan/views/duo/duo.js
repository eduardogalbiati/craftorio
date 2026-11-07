// Write & Review: runs the writer-reviewer workflow and shows it as a chat between the writer,
// the reviewer and the platform's supervisor. The chat is rebuilt from the run's events, live
// (run:event) or from a past run's events.jsonl (Workflows › Runs › "Open chat").
// The document type is the workflow's `document_skill` (duo-issue.js). From a Backlog issue
// (window.openDuoForIssue) the setup is prefilled and the run records the issue; once accepted,
// "Save to issue" (window.openDuoSaveToIssue, also in Run Details) previews and, on the owner's
// click, saves the document to it (backlog:save-doc). From a Discovery card
// (window.openDuoForCard, #257) the prompt is the card's document and the run's document goes back
// to the card when it finishes (DiscoveryRuns). Registers itself with registerView, with
// its Save to issue and guide dialogs; the chat look it shares with AI Arena and the run chat is
// chat.css, the models it offers chat-models.js.
// load: after views/duo/duo-issue.js (window.DuoIssue as it loads)
(() => {
  const $d = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const WORKFLOW = 'writer-reviewer';
  const FILE = 'writer-reviewer.yaml';

  const { PROVIDERS, EFFORTS, typeOf } = window.ChatModels;
  const BY_KEY = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [p.key, id]));
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
    writer: { provider: typeOf('claude-opus-5-5'), model: 'claude-opus-5-5', effort: 'high', ...saved.writer },
    reviewer: { provider: typeOf('gpt-6-luna'), model: 'gpt-6-luna', effort: 'high', ...saved.reviewer },
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
  // the writer and the reviewer wear the look saved for writer-reviewer's agents in Agents, if any
  const variantOf = (role) => (roles[role].internal ? 'supervisor'
    : window.AgentLooks?.forWorkflow('writer-reviewer', role) || Robots.variantFor(roles[role].provider, roles[role].model));
  // without a saved look, the provider's robot is painted in the role's colour (#227, agent-colors.js)
  const colorOf = (role) => (roles[role].internal || !window.AgentColors || window.AgentLooks?.forWorkflow('writer-reviewer', role) ? undefined
    : AgentColors.hexFor(role, AgentColors.defIn(state.workflows, 'writer-reviewer', role)));
  // The name plate shows the chosen model; the internal supervisor keeps its own generic plate.
  const plaqueOf = (role) => (roles[role].internal ? undefined : Robots.plaqueFor(roles[role].model));
  const robotSvg = (role, st = 'idle', opts = {}) => Robots.svg(variantOf(role), st, { mirror: MIRRORED[role], plaque: plaqueOf(role), color: colorOf(role), ...opts });
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
    const v = variantOf(role);
    const key = `${typeof v === 'string' ? v : `look-${v.body}-${v.screen}-${v.accent}-${v.head}-${v.eyes}-${v.logo}`}:${c.model}`;
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
      document_skill: $d('#duo-skill').value || '',
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
    if (!inputs.prompt || !inputs.goal) { err.textContent = t('duo.write_the_prompt_and_the_goal'); return; }
    // simulation only in developer mode (the checkbox is hidden otherwise); checked without it fails
    let mock;
    try { mock = wantsSimulation($d('#duo-mock')); } catch (e) { err.textContent = e.message; return; }
    const scenario = $d('#duo-scenario').value;
    // a prompt prefilled from an issue or a Discovery card is not kept as the next default
    const prefilled = fromIssue || fromCard;
    const own = prefilled ? { prompt: saved.prompt, goal: saved.goal, project: saved.project } : { prompt: inputs.prompt, goal: inputs.goal, project: $d('#duo-project').value };
    try { localStorage.setItem(LS, JSON.stringify({ writer: config.writer, reviewer: config.reviewer, ...own, threshold: inputs.threshold, max_rounds: inputs.max_rounds, scenario, skill: prefilled ? saved.skill : inputs.document_skill })); } catch { /* ignore */ }
    $d('#duo-run').disabled = true;
    try {
      starting = true; // the run's first events may arrive before startRun resolves
      // started from a Backlog issue: the run records it (workflow.started `issues`) and can save to it
      const forIssue = fromIssue
        ? { projectId: fromIssue.projectId, issues: [{ number: fromIssue.issue.number, url: fromIssue.issue.url, title: fromIssue.issue.title }] } : {};
      // images pasted into the prompt and the goal (#130), for the steps that read those inputs
      const pasted = { prompt: await PasteImage.collect($d('#duo-prompt')), goal: await PasteImage.collect($d('#duo-goal')) };
      const attachments = Object.fromEntries(Object.entries(pasted).filter(([, list]) => list.length));
      // #805 baseChoice: this screen does not ask about a local base behind origin: a toast and the run's log say it
      const payload = { file: FILE, inputs, mock, mockSequences: mock ? SCENARIOS[scenario]?.seq : null, baseChoice: 'continue', ...forIssue, ...(Object.keys(attachments).length ? { attachments } : {}) };
      let out = await api.startRun(payload);
      // an ended run of this issue kept commits in its worktree (#112, #170): resume it, or start from scratch
      if (out?.kept) {
        starting = false;
        if (await keptWorkDialog(out.kept) !== 'scratch') return;
        starting = true;
        out = await api.startRun({ ...payload, confirmed: true });
      }
      if (out.baseCheck) baseStartedToast(out.baseCheck);
      PasteImage.clear($d('#duo-prompt'));
      PasteImage.clear($d('#duo-goal'));
      bindLive(out.runId);
      // started for a Discovery card: its document goes back to the card when the run finishes
      if (fromCard) {
        window.DiscoveryRuns.started(out.runId, { projectId: fromCard.projectId, cardId: fromCard.cardId, source: 'write-review' });
        fromCard = null;
        renderIssueBanner();
      }
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
    sel.innerHTML = `<option value="">${t('duo.no_project_prompt_and_goal_only')}</option>` + projects.map((p) =>
      `<option value="${esc(p.id)}"${p.exists ? '' : ' disabled'}${p.id === current && p.exists ? ' selected' : ''}>${esc(p.name)}${p.exists ? '' : t('duo.folder_missing')}</option>`).join('');
    const hint = () => {
      const p = projects.find((x) => x.id === sel.value);
      $d('#duo-project-hint').textContent = p ? t('duo.folder_the_writer_and_the_reviewer', { folder: p.folder }) : t('duo.the_writer_and_the_reviewer_read');
    };
    sel.onchange = hint;
    hint();
  }

  // ---------------------------------------------------------------- from a Backlog issue (#103)
  // "Enrich in Write & Review" fills the setup with the issue (DuoIssue.enrichInputs): an enriched
  // issue by default, in the Backlog's project. Nothing starts by itself; the owner can edit it all.
  let fromIssue = null; // { projectId, platform, issue: { number, title, url, body, labels } }
  let fromCard = null; // a Discovery card instead (#257, openForCard): { projectId, cardId, title }
  const { DOC_TYPES, DEFAULT_ISSUE_SKILL } = window.DuoIssue;
  const docLabel = (skill) => DOC_TYPES.find((t) => t.skill === (skill || ''))?.label || skill;

  function fillSkills(skill) {
    const sel = $d('#duo-skill');
    const known = DOC_TYPES.some((t) => t.skill === skill);
    sel.innerHTML = DOC_TYPES.map((t) => `<option value="${esc(t.skill)}"${t.skill === skill ? ' selected' : ''}>${esc(t.label)}${t.skill ? ` (${esc(t.skill)})` : ''}</option>`).join('')
      + (skill && !known ? `<option value="${esc(skill)}" selected>${esc(skill)}</option>` : '');
  }

  function renderIssueBanner() {
    const box = $d('#duo-issue');
    box.classList.toggle('hidden', !fromIssue && !fromCard);
    if (fromCard) {
      box.innerHTML = `<span>${t('duo.for_the_discovery_card')} <b>${esc(fromCard.title)}</b>${t('duo.when_the_run_finishes_its_document')}</span>
      <button type="button" class="link-btn small" id="duo-card-clear" title="${t('duo.write_a_document_that_is_not')}">${t('duo.not_about_this_card')}</button>`;
      $d('#duo-card-clear').onclick = () => { fromCard = null; renderIssueBanner(); };
      return;
    }
    if (!fromIssue) { box.innerHTML = ''; return; }
    const i = fromIssue.issue;
    box.innerHTML = `<span>${t('duo.enriching_issue')} <a href="${esc(i.url)}" target="_blank" rel="noopener">#${esc(i.number)}</a> <b>${esc(i.title)}</b>${t('duo.once_you_accept_the_document_you')}</span>
      <button type="button" class="link-btn small" id="duo-issue-clear" title="${t('duo.write_a_document_that_is_not_2')}">${t('duo.not_about_this_issue')}</button>`;
    $d('#duo-issue-clear').onclick = () => { fromIssue = null; renderIssueBanner(); };
  }

  // A new document type: the prompt and the goal follow it while the owner has not edited them.
  function onSkillChange() {
    if (!fromIssue) return;
    const skill = $d('#duo-skill').value;
    const before = window.DuoIssue.enrichInputs(fromIssue.issue, fromIssue.skill);
    const next = window.DuoIssue.enrichInputs(fromIssue.issue, skill);
    if ($d('#duo-prompt').value.trim() === before.prompt.trim()) $d('#duo-prompt').value = next.prompt;
    if ($d('#duo-goal').value.trim() === before.goal.trim() && next.goal) $d('#duo-goal').value = next.goal;
    fromIssue.skill = skill;
  }

  async function openForIssue({ projectId, platform, issue, skill = DEFAULT_ISSUE_SKILL }) {
    if (typeof showView === 'function') showView('duo');
    $d('#duo-chat').classList.add('hidden');
    $d('#duo-setup').classList.remove('hidden');
    fromIssue = { projectId, platform, issue, skill };
    fromCard = null;
    const inputs = window.DuoIssue.enrichInputs(issue, skill);
    await prefill({ projectId, skill, prompt: inputs.prompt, goal: inputs.goal });
  }
  window.openDuoForIssue = openForIssue;

  // The setup filled for an issue or a card, in its project, the cursor at the top of the prompt.
  async function prefill({ projectId, skill, prompt: text, goal }) {
    fillSkills(skill);
    $d('#duo-prompt').value = text;
    $d('#duo-goal').value = goal;
    $d('#duo-error').textContent = '';
    renderIssueBanner();
    await loadProjects();
    const sel = $d('#duo-project');
    if ([...sel.options].some((o) => o.value === projectId && !o.disabled)) { sel.value = projectId; sel.onchange(); }
    const prompt = $d('#duo-prompt');
    prompt.focus({ preventScroll: true });
    prompt.setSelectionRange(0, 0);
    prompt.scrollTop = 0;
  }

  // ---------------------------------------------------------------- from a Discovery card (#257)
  // "Open in Write & Review" on a card in Shape (views/discovery/discovery.js) fills the setup with
  // the card's document as the prompt. Nothing starts by itself; the run started here is told to
  // DiscoveryRuns, which records its document on the card when it finishes.
  async function openForCard({ projectId, cardId, title, prompt, goal, skill = '' }) {
    if (typeof showView === 'function') showView('duo');
    $d('#duo-chat').classList.add('hidden');
    $d('#duo-setup').classList.remove('hidden');
    fromIssue = null;
    fromCard = { projectId, cardId, title };
    await prefill({ projectId, skill, prompt, goal });
  }
  window.openDuoForCard = openForCard;

  // ---------------------------------------------------------------- chat state
  const chat = { runId: null, live: false, running: false };
  function resetChat(runId, live) {
    Object.assign(chat, {
      runId, live, running: live, seq: 0, runDir: null, mock: false, issue: null, docSkill: '',
      threshold: 8, maxRounds: 5, round: 0, scores: [], docs: [], docView: -1,
      interventions: 0, usage: {}, sessions: new Map(), openStep: null, typing: null, cost: 0,
    });
    $d('#duo-setup').classList.add('hidden');
    $d('#duo-chat').classList.remove('hidden');
    $d('#duo-messages').innerHTML = '';
    $d('#duo-checks').innerHTML = '';
    $d('#duo-interventions').textContent = '0/6';
    $d('#duo-round').textContent = '0';
    $d('#duo-chat-status').textContent = live ? t('duo.starting') : t('duo.loading');
    $d('#duo-stop').classList.toggle('hidden', !live);
    setSuperPill('watch', 'watching');
    renderScores();
    renderDoc();
    ['writer', 'reviewer', 'supervisor'].forEach((role) => { delete $d(`[data-cast="${role}"]`).dataset.state; });
  }

  function clock(ts) {
    return new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: TimeZone.current() });
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
      .map((s) => `<span class="${chat.threshold <= s ? 'pass' : ''}" style="height:${Math.max(3, s * 2.6)}px" title="${s}/10"></span>`).join('');
  }

  function renderDoc() {
    $d('#duo-versions').innerHTML = chat.docs.map((_, i) => `<button type="button" class="${i === chat.docView ? 'active' : ''}" data-v="${i}">v${i + 1}</button>`).join('');
    $d('#duo-versions').querySelectorAll('button').forEach((b) => (b.onclick = () => { chat.docView = +b.dataset.v; renderDoc(); }));
    $d('#duo-doc-body').innerHTML = chat.docView < 0 ? `<p class="muted">${t('duo.no_draft_yet')}</p>` : md(chat.docs[chat.docView]);
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
    addToChat(`<div class="duo-fail${MIRRORED[role] ? ' left' : ''}"><span class="duo-robot ${role}${chat.live ? '' : ' still'}" aria-hidden="true">${robotSvg(role, 'error')}</span><span class="duo-fail-text">${esc(text)}</span></div>`);
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
      writer: { provider: BY_KEY[i.writer_provider] || typeOf('claude'), model: i.writer_model || '', effort: i.writer_effort || '' },
      reviewer: { provider: BY_KEY[i.reviewer_provider] || typeOf('codex'), model: i.reviewer_model || '', effort: i.reviewer_effort || '' },
      supervisor: { internal: true },
    };
    // the issue it enriches (started from the Backlog): its accepted document can be saved to it
    const issue = (Array.isArray(ev.issues) ? ev.issues : ev.issue ? [ev.issue] : [])[0] || null;
    Object.assign(chat, { threshold: +i.threshold || 8, maxRounds: +i.max_rounds || 5, runDir: ev.run_dir, mock: !!ev.mock, issue, docSkill: i.document_skill || '' });
    ['writer', 'reviewer', 'supervisor'].forEach((role) => setCast(role, 'idle'));
    $d('#duo-round').textContent = `0/${chat.maxRounds}`;
    $d('#duo-chat-title').innerHTML = `<span style="color:var(--writer)">${esc(roles.writer.model)}</span> <span class="muted">⇄</span> <span style="color:var(--reviewer)">${esc(roles.reviewer.model)}</span>`;
    addToChat(`<div class="duo-msg user"><div class="duo-bubble">
      <div class="duo-meta"><b>${t('duo.you')}</b><span class="time">${clock(ev.ts)}</span></div>
      ${issue ? `<p><b>${t('duo.issue')}</b> <a href="${esc(issue.url)}" target="_blank" rel="noopener">#${esc(issue.number)}</a> ${esc(issue.title || '')}</p>` : ''}
      ${chat.docSkill ? `<p><b>${t('duo.document')}</b> ${esc(docLabel(chat.docSkill))} <span class="mono small">${esc(chat.docSkill)}</span></p>` : ''}
      <p><b>${t('duo.prompt')}</b> <span class="duo-msg-text">${esc(i.prompt)}</span></p>
      <p><b>${t('duo.goal')}</b> <span class="duo-msg-text">${esc(i.goal)}</span></p></div></div>`);
    const project = i.project_path ? (projects.find((p) => p.folder === i.project_path)?.name || i.project_path) : '';
    note(`Run started${ev.mock ? ` · <b>${t('duo.simulation')}</b>` : ''}${issue ? ` · about issue <b>#${esc(issue.number)}</b>` : ''}${project ? ` · project <b>${esc(project)}</b> ${t('duo.read_only')}` : ''} · approve at ${chat.threshold}/10 · max ${chat.maxRounds} rounds`);
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
        <button type="button" class="duo-doc-card" data-v="${chat.docView}">${ICON_DOC}<span><b>${t('duo.document_md_v')}${chat.docs.length}</b><small>${words} ${t('duo.words_click_to_view')}</small></span></button>`, ev.ts, 'write');
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
      message('supervisor', `${o.ready ? `<div class="duo-ready">${t('duo.ready')}</div>` : `<div class="duo-not-ready">${t('duo.not_ready_yet')}</div>`}
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
    // with "Accept and save to issue #n" when the run is about an issue (gateChoices in app.js, #125)
    const choices = gateChoices(ev);
    const buttons = choices.map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : ''}" data-approval="${esc(ev.approval_id)}" data-choice="${esc(c.id)}"${c.intent ? ` data-intent="${esc(c.intent)}" title="${esc(c.title)}"` : ''}${off}>${esc(c.label)}</button>`).join('')
      // #183: "Interact with Oracle" at the end of the row
      + (window.GateOracle?.gateOracleButtonHtml({ ...ev, run_id: ev.run_id || chat.runId }) || '');
    const field = ev.feedback ? `<label class="duo-ask-label">${esc(ev.feedback.label)}</label>
      <textarea class="duo-ask-text" rows="2" placeholder="${esc(ev.feedback.placeholder)}"${off}></textarea>` : '';
    chat.labels = Object.fromEntries(choices.map((c) => [c.intent ? `${c.id}:${c.intent}` : String(c.id), c.label]));
    message('supervisor', `<div class="duo-ask" data-gate="${esc(ev.approval_id)}"><p class="duo-msg-text">${esc(ev.message)}</p>${field}<div class="row gate-choices">${buttons}</div></div>`, ev.ts);
    $d('#duo-chat-status').textContent = t('duo.the_supervisor_is_waiting_for_you');
    if (chat.live) document.querySelector(`[data-gate="${ev.approval_id}"] textarea`)?.focus({ preventScroll: true });
  }

  // The user's answer, as their own message.
  function onApprovalResolved(ev) {
    const gate = document.querySelector(`[data-gate="${ev.approval_id}"]`);
    const choice = String(ev.choice ?? ev.approved);
    if (gate) {
      gate.querySelectorAll('button, textarea').forEach((x) => { x.disabled = true; });
      gate.querySelectorAll('button').forEach((x) => { x.classList.remove('primary'); x.classList.toggle('chosen', x.dataset.choice === choice && (x.dataset.intent || '') === (ev.intent || '')); });
      gate.querySelector('textarea')?.remove();
      gate.querySelector('.duo-ask-label')?.remove();
    }
    const label = (ev.intent && chat.labels?.[`${choice}:${ev.intent}`]) || chat.labels?.[choice] || choice;
    addToChat(`<div class="duo-msg user reply"><div class="duo-bubble">
      <div class="duo-meta"><b>${t('duo.you')}</b><span class="time">${clock(ev.ts)}</span></div>
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
      note(`<b>${t('duo.done')}</b>${last != null ? ` · ${last.toFixed(1)}/10` : ''} ${t('duo.after_rounds_saved_to', { count: rounds })} <span class="mono">${t('duo.document_md')}</span> · ${cost} · ${dur}`, 'done');
      ['writer', 'reviewer', 'supervisor'].forEach((r) => setCast(r, 'done'));
      setSuperPill('success', 'done');
      addCheck('ok', 'Run finished');
      $d('#duo-chat-status').textContent = t('duo.finished');
      // accepted and about an issue: Save to issue, now or later (a replayed run keeps it)
      if (chat.issue) {
        note(`<button type="button" class="btn sm primary" data-save-issue title="${t(chat.mock ? 'duo.preview_then_confirm_simulated' : 'duo.preview_then_confirm_on_platform')}">${t('duo.save_to_issue_number', { number: esc(chat.issue.number) })}</button>
          <span class="muted small">${chat.mock ? t('duo.simulated_run_preview_only_nothing_is') : t('duo.replace_its_description_or_add_it')}</span>`, 'done duo-save-row');
      }
    } else {
      note(`<b>${esc(ev.status)}</b> · ${esc(String(ev.error || '').slice(0, 220))} · ${cost} · ${dur}`, 'failed');
      setSuperPill(ev.status === 'cancelled' ? 'cancelled' : 'failed', ev.status);
      addCheck('warn', `Run ${ev.status}`);
      $d('#duo-chat-status').textContent = ev.status === 'cancelled' ? t('duo.cancelled') : t('duo.failed');
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
    if (!finished && !chat.live) $d('#duo-chat-status').textContent = t('duo.interrupted');
    if (!chat.live) $d('#duo-messages').scrollTop = 0;
  }
  window.openDuoRun = openRun;
  // true while this screen shows the live run (its gates are answered in the chat, not in a dialog)
  window.duoShowsRun = (runId) => chat.live && chat.runId === runId
    && !$d('#view-duo').classList.contains('hidden') && !$d('#duo-chat').classList.contains('hidden');
  // the run this screen shows (live or replayed), for desktop notifications
  window.duoShownRunId = () => (!$d('#view-duo').classList.contains('hidden') && !$d('#duo-chat').classList.contains('hidden') ? chat.runId : null);

  // ---------------------------------------------------------------- Save to issue (#103)
  // The accepted document back to its issue (backlog:save-doc): a preview first (never calls the
  // CLI), then the owner's click saves it. A simulated run only previews. Replace is the default for
  // an enriched issue (or a free-form document), a comment for the other document types (an RFC…).
  const saveMode = () => document.querySelector('input[name="duo-save-mode"]:checked')?.value || 'replace';
  const cleanError = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let saveRun = null; // { runId, issue, mock }

  async function previewSave() {
    const { runId } = saveRun;
    $d('#duo-save-error').textContent = '';
    $d('#duo-save-preview').innerHTML = `<p class="muted">${t('duo.loading_the_preview')}</p>`;
    try {
      const p = await api.saveDocToIssue(runId, saveMode(), true);
      if (saveRun?.runId !== runId) return;
      $d('#duo-save-command').textContent = p.command;
      $d('#duo-save-preview').innerHTML = md(p.body);
    } catch (e) {
      $d('#duo-save-preview').innerHTML = '';
      $d('#duo-save-error').textContent = cleanError(e);
    }
  }

  // target: { runId, issue: { number, url, title }, mock, docSkill } (the chat's run, or one from Run Details)
  function openSave(target = chat.issue ? { runId: chat.runId, issue: chat.issue, mock: chat.mock, docSkill: chat.docSkill } : null) {
    if (!target?.issue) return;
    const { issue, mock, docSkill } = target;
    saveRun = { runId: target.runId, issue, mock: !!mock };
    const def = !docSkill || docSkill === DEFAULT_ISSUE_SKILL ? 'replace' : 'comment';
    document.querySelectorAll('input[name="duo-save-mode"]').forEach((r) => { r.checked = r.value === def; });
    $d('#duo-save-title').textContent = t('duo.save_to_issue_number_2', { number: issue.number });
    $d('#duo-save-issue').innerHTML = `<a href="${esc(issue.url)}" target="_blank" rel="noopener">#${esc(issue.number)}</a> ${esc(issue.title || '')}`;
    $d('#duo-save-note').textContent = mock
      ? t('duo.simulated_run_this_is_only_a')
      : t('duo.saving_changes_the_issue_on_github');
    $d('#btn-duo-save-ok').classList.toggle('hidden', !!mock);
    $d('#btn-duo-save-ok').disabled = false;
    $d('#btn-duo-save-ok').textContent = t('duo.save_to_issue_number_2', { number: issue.number });
    $d('#duo-save-command').textContent = '';
    $d('#duo-save-modal').classList.remove('hidden');
    previewSave();
  }
  window.openDuoSaveToIssue = openSave;
  const closeSave = () => { $d('#duo-save-modal').classList.add('hidden'); saveRun = null; };

  async function confirmSave() {
    if (!saveRun || saveRun.mock) return;
    const { runId, issue } = saveRun;
    const ok = $d('#btn-duo-save-ok');
    ok.disabled = true;
    $d('#duo-save-error').textContent = '';
    try {
      const r = await api.saveDocToIssue(runId, saveMode(), false);
      closeSave();
      if (chat.runId === runId) {
        const where = r.saved?.commentUrl || issue.url;
        note(`Saved to issue <a href="${esc(where)}" target="_blank" rel="noopener">#${esc(issue.number)}</a> · ${r.mode === 'comment' ? t('duo.as_a_comment') : t('duo.description_replaced_the_original_is_kept')}${r.refreshError ? t('duo.the_backlog_could_not_read_it', { refreshError: esc(r.refreshError) }) : ''}`, 'done');
        addCheck('ok', `Saved to issue #${issue.number} (${r.mode})`);
      } else if (typeof showToast === 'function') {
        // saved from the Run screen or Run Details (#125): Run Details lists it with the issue's link
        showToast(t('duo.saved_to_issue_number', { number: issue.number }), r.mode === 'comment' ? t('duo.as_a_comment_2') : t('duo.description_replaced_the_original_is_kept_2'), runId);
      }
      // the Backlog shows the new body, task progress and labels
      if (typeof window.refreshBacklog === 'function' && !$d('#view-backlog')?.classList.contains('hidden')) window.refreshBacklog();
    } catch (e) {
      // the CLI's message (no auth, issue closed or deleted, network); the document stays in the run folder
      $d('#duo-save-error').textContent = t('duo.e_the_document_is_still_in', { e: cleanError(e) });
      ok.disabled = false;
    }
  }

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
    $d('#duo-help-close').focus({ preventScroll: true });
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
    document.querySelector('.nav-item[data-view="duo"]')?.addEventListener('click', loadProjects);
    fillAgentForm('writer');
    fillAgentForm('reviewer');
    $d('[data-robot="supervisor"]').innerHTML = robotSvg('supervisor');
    // the supervisor's look and the workflow agents' looks are customizable in Agents
    document.addEventListener('robots:changed', (e) => {
      if (e.detail?.name === 'supervisor') $d('[data-robot="supervisor"]').innerHTML = robotSvg('supervisor');
      if (e.detail?.name === 'workflow-agents') { fillAgentForm('writer'); fillAgentForm('reviewer'); }
    });
    $d('#duo-run').onclick = startRun;
    $d('#duo-stop').onclick = () => api.stopRun(chat.runId);
    $d('#duo-logs').onclick = () => chat.runDir && api.openPath(chat.runDir);
    $d('#duo-back').onclick = () => {
      $d('#duo-chat').classList.add('hidden');
      $d('#duo-setup').classList.remove('hidden');
    };
    $d('#duo-edit-workflow').onclick = () => typeof showView === 'function' && showView('workflows');
    fillSkills(saved.skill || '');
    $d('#duo-skill').onchange = onSkillChange;
    document.querySelectorAll('input[name="duo-save-mode"]').forEach((r) => (r.onchange = previewSave));
    $d('#btn-duo-save-cancel').onclick = closeSave;
    $d('#btn-duo-save-ok').onclick = confirmSave;
    $d('#duo-save-modal').addEventListener('click', (e) => { if (e.target.id === 'duo-save-modal') closeSave(); });
    $d('#duo-messages').addEventListener('click', (e) => {
      if (e.target.closest('[data-save-issue]')) { openSave(); return; }
      const card = e.target.closest('.duo-doc-card');
      if (card) { chat.docView = +card.dataset.v; renderDoc(); }
      const b = e.target.closest('[data-approval]');
      if (b && chat.live) {
        const v = b.dataset.choice;
        const field = b.closest('.duo-ask')?.querySelector('textarea');
        const text = field?.value || '';
        // images pasted into the feedback (#130) go with it
        PasteImage.collect(field).then((images) => api.resolveApproval(b.dataset.approval, v === 'true' ? true : v === 'false' ? false : v, text, chat.runId, b.dataset.intent || null, ...(images.length ? [images] : [])));
      }
    });
    api.onEvent(onEvent);
  }

  registerView({
    // #648: out of the menu (write-doc replaces Write & Review); kept to open the old runs
    id: 'duo',
    markup: () => `
      <section id="view-duo" class="view hidden">
        <!-- Setup -->
        <div id="duo-setup" class="duo-setup">
          <div class="page-head">
            <div>
              <h1>${t('duo.write_review')} <span class="duo-lab">${t('duo.lab')}</span> <button id="duo-help-open" class="duo-help-btn" type="button" title="${t('duo.how_write_review_works')}" aria-label="${t('duo.how_write_review_works')}">?</button></h1>
              <p class="muted small">${t('duo.a_writer_drafts_a_reviewer_scores')} <span class="mono">${t('duo.writer_reviewer')}</span> ${t('duo.workflow_past_runs_are_in_workflows')}</p>
            </div>
            <button id="duo-edit-workflow" class="btn ghost sm" type="button" title="${t('duo.open_the_workflow_yaml')}">${t('duo.writer_reviewer_yaml')}</button>
          </div>

          <div class="duo-brief">
            <!-- prefilled from a Backlog issue ("Enrich in Write & Review", duo.js openDuoForIssue) -->
            <div id="duo-issue" class="duo-issue hidden"></div>
            <div class="field duo-skill">
              <label for="duo-skill">${t('duo.document_type')} <span class="muted">${t('duo.optional')}</span></label>
              <div class="row">
                <select id="duo-skill"></select>
                <span class="muted small">${t('duo.the_writer_and_the_reviewer_load')}</span>
              </div>
            </div>
            <div class="field">
              <label for="duo-prompt">${t('duo.prompt')} <span class="req">*</span></label>
              <textarea id="duo-prompt" rows="3" placeholder="${t('duo.what_should_be_written_e_g')}">${t('duo.write_a_one_page_prd_for')}</textarea>
            </div>
            <div class="field">
              <label for="duo-goal">${t('duo.goal')} <span class="req">*</span></label>
              <textarea id="duo-goal" rows="2" placeholder="${t('duo.when_is_the_document_good_enough')}">${t('duo.a_pm_can_hand_it_to')}</textarea>
            </div>
            <div class="field duo-project">
              <label for="duo-project">${t('duo.project')} <span class="muted">${t('duo.optional')}</span></label>
              <div class="row">
                <select id="duo-project"></select>
                <span id="duo-project-hint" class="muted small">${t('duo.the_writer_and_the_reviewer_read')}</span>
              </div>
            </div>
            <div class="duo-rules">
              <label>${t('duo.approve_at')} <input id="duo-threshold" type="number" min="1" max="10" step="0.5" value="8" /> / 10</label>
              <label>${t('duo.max_rounds')} <input id="duo-rounds" type="number" min="1" max="10" value="5" /></label>
              <span class="muted small">${t('duo.if_the_rounds_run_out_the')}</span>
            </div>
          </div>

          <div class="duo-agents">
            <div class="duo-agent writer">
              <div class="duo-agent-head">
                <span class="duo-robot xl writer" data-robot="writer"></span>
                <div><b>${t('duo.writer')}</b><div class="muted small">${t('duo.drafts_the_document_and_applies_the')}</div></div>
              </div>
              <div class="duo-agent-form">
                <div class="field"><label>${t('duo.provider')}</label><select data-role="writer" data-field="provider"></select></div>
                <div class="field"><label>${t('duo.model')}</label><select data-role="writer" data-field="model"></select></div>
                <div class="field"><label>${t('duo.effort')}</label><div class="seg duo-effort" data-role="writer"></div></div>
              </div>
            </div>

            <div class="duo-link" aria-hidden="true">
              <svg viewBox="0 0 48 24"><path d="M4 8h36l-5-5M44 16H8l5 5" /></svg>
              <span class="muted small">${t('duo.draft')}<br />${t('duo.score_notes')}</span>
            </div>

            <div class="duo-agent reviewer">
              <div class="duo-agent-head">
                <span class="duo-robot xl reviewer" data-robot="reviewer"></span>
                <div><b>${t('duo.reviewer')}</b><div class="muted small">${t('duo.scores_each_draft_0_10_against')}</div></div>
              </div>
              <div class="duo-agent-form">
                <div class="field"><label>${t('duo.provider')}</label><select data-role="reviewer" data-field="provider"></select></div>
                <div class="field"><label>${t('duo.model')}</label><select data-role="reviewer" data-field="model"></select></div>
                <div class="field"><label>${t('duo.effort')}</label><div class="seg duo-effort" data-role="reviewer"></div></div>
              </div>
            </div>
          </div>

          <div class="duo-agent supervisor">
            <div class="duo-agent-head">
              <span class="duo-robot xl supervisor" data-robot="supervisor"></span>
              <div class="spacer"><b>${t('duo.supervisor')}</b><div class="muted small">${t('duo.the_platform_s_own_agent_watches')}</div></div>
            </div>
          </div>

          <div class="duo-actions">
            <span id="duo-error" class="error duo-error"></span>
            <label class="duo-switch dev-only" id="duo-scenario-wrap" title="${t('duo.what_the_simulated_agents_do')}">${t('duo.scenario')} <select id="duo-scenario"></select></label>
            <label class="duo-switch dev-only" title="${t('duo.simulated_agents_no_cli_is_called')}"><input id="duo-mock" type="checkbox" /> <span>${t('duo.simulation_no_model_calls')}</span></label>
            <button id="duo-run" class="btn primary btn-icon" type="button">
              <svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
              ${t('duo.run')}
            </button>
          </div>
        </div>

        <!-- Conversation -->
        <div id="duo-chat" class="duo-chat hidden">
          <div class="duo-chat-main">
            <header class="duo-chat-head">
              <button id="duo-back" class="icon-btn" type="button" title="${t('duo.back_to_setup')}"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
              <div class="duo-pair">
                <span class="duo-cast"><span class="duo-robot head writer" data-cast="writer"></span><span data-cast-state="writer">${t('duo.idle')}</span></span>
                <span class="duo-cast"><span class="duo-robot head reviewer" data-cast="reviewer"></span><span data-cast-state="reviewer">${t('duo.idle')}</span></span>
                <span class="duo-cast"><span class="duo-robot head supervisor" data-cast="supervisor"></span><span data-cast-state="supervisor">${t('duo.idle')}</span></span>
              </div>
              <div class="duo-chat-title">
                <b id="duo-chat-title">${t('duo.writer_reviewer_2')}</b>
                <div id="duo-chat-status" class="muted small">${t('duo.starting')}</div>
              </div>
              <div class="spacer"></div>
              <div class="duo-round"><label class="muted small">${t('duo.round')}</label> <b id="duo-round" class="mono">0/5</b></div>
              <div class="duo-scores" id="duo-scores" title="${t('duo.reviewer_score_per_round')}"></div>
              <button id="duo-help-open2" class="duo-help-btn sm" type="button" title="${t('duo.how_write_review_works')}" aria-label="${t('duo.how_write_review_works')}">?</button>
              <button id="duo-logs" class="btn ghost sm" type="button" title="${t('duo.open_the_run_folder_events_drafts')}">${t('duo.run_folder')}</button>
              <button id="duo-stop" class="btn danger sm hidden" type="button">${t('duo.stop')}</button>
            </header>
            <div id="duo-messages" class="duo-messages"></div>
          </div>

          <aside class="duo-side">
            <section class="duo-doc">
              <div class="duo-side-head"><h2>${t('duo.document')}</h2><div id="duo-versions" class="seg sm"></div></div>
              <article id="duo-doc-body" class="duo-doc-body md md-compact">${t('duo.no_draft_yet')}</article>
            </section>
            <section class="duo-super-panel">
              <div class="duo-side-head">
                <h2>${t('duo.supervisor')}</h2>
                <span id="duo-super-state" class="pill pill-running">${t('duo.watching')}</span>
              </div>
              <ul id="duo-checks" class="duo-checks"></ul>
              <div class="muted small">${t('duo.interventions')} <b id="duo-interventions" class="mono">0/6</b></div>
            </section>
          </aside>
        </div>
      </section>`,
    modals: () => `
  <div id="duo-save-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="duo-save-title">
    <div class="modal-card duo-save-card">
      <h3 id="duo-save-title">${t('duo.save_to_issue')}</h3>
      <p id="duo-save-issue" class="muted small"></p>
      <fieldset class="bl-grouping">
        <legend class="small">${t('duo.how')}</legend>
        <label class="check"><input type="radio" name="duo-save-mode" value="replace" checked /><span>${t('duo.replace_the_description_the_document_becomes')}</span></label>
        <label class="check"><input type="radio" name="duo-save-mode" value="comment" /><span>${t('duo.add_as_a_comment_the_issue')}</span></label>
      </fieldset>
      <div class="small muted">${t('duo.command')} <span id="duo-save-command" class="mono"></span></div>
      <div id="duo-save-preview" class="md duo-save-preview"></div>
      <p id="duo-save-note" class="small"></p>
      <p id="duo-save-error" class="error small"></p>
      <div class="modal-actions">
        <button type="button" id="btn-duo-save-cancel" class="btn ghost">${t('common.cancel')}</button>
        <button type="button" id="btn-duo-save-ok" class="btn primary">${t('duo.save_to_issue')}</button>
      </div>
    </div>
  </div>

  <div id="duo-help" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="duo-help-title">
    <div class="modal-card duo-help-card">
      <div class="duo-help-head">
        <h3 id="duo-help-title">${t('duo.how_write_review_works')}</h3>
        <button id="duo-help-close" class="icon-btn" type="button" title="${t('duo.close_esc')}" aria-label="${t('common.close')}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
      <div class="duo-help-body">
        <p class="duo-help-lead">${t('duo.three_ai_agents_write_a_document')} <b class="c-writer">${t('duo.writer_2')}</b> ${t('duo.drafts_it_a')} <b class="c-reviewer">${t('duo.reviewer_2')}</b> ${t('duo.scores_it_against_your_goal_and')} <b class="c-supervisor">${t('duo.supervisor_2')}</b> ${t('duo.checks_the_result_and_asks_you')}</p>
        <div class="duo-help-cast" id="duo-help-cast"></div>

        <h4>${t('duo.n1_set_up_a_run')}</h4>
        <ul>
          <li><b>${t('duo.prompt')}</b>${t('duo.what_to_write_a_prd_a')}</li>
          <li><b>${t('duo.goal')}</b>${t('duo.when_the_document_is_good_enough')}</li>
          <li><b>${t('duo.project')}</b> ${t('duo.optional_the_writer_and_the_reviewer')} <b>${t('duo.read_only_2')}</b> ${t('duo.there_they_can_t_create_edit')}</li>
          <li><b>${t('duo.approve_at')}</b>${t('duo.the_minimum_score_0_10_for')} <b>${t('duo.max_rounds')}</b>${t('duo.how_many_reviews_before_you_are')}</li>
          <li><b>${t('duo.writer_and_reviewer')}</b>${t('duo.pick_the_cli_claude_code_codex')} <b>${t('duo.supervisor_2')}</b> ${t('duo.is_the_platform_s_own_agent')}</li>
        </ul>

        <h4>${t('duo.n2_the_flow')}</h4>
        <div class="duo-help-flow">
          <span class="c-writer">${t('duo.write')}</span><i>→</i><span class="c-reviewer">${t('duo.review')}</span><i>→</i><span class="c-ok">${t('duo.score_approve_at')}</span><i>→</i><span class="c-supervisor">${t('duo.supervisor_check')}</span><i>→</i><span class="c-you">${t('duo.you_decide')}</span><i>→</i><span class="c-ok">${t('duo.done')}</span>
        </div>
        <ul>
          <li>${t('duo.below_the_score_the_reviewer_s')}</li>
          <li>${t('duo.the')} <b>${t('duo.engine')}</b> ${t('duo.decides_whether_a_draft_passes_from')}</li>
          <li>${t('duo.if_the_rounds_run_out_the_2')}</li>
          <li>${t('duo.when_a_draft_passes_the_supervisor')}</li>
        </ul>

        <h4>${t('duo.n3_talking_to_the_supervisor')}</h4>
        <ul>
          <li>${t('duo.the_supervisor')} <b>${t('duo.always_asks_you')}</b> ${t('duo.before_the_run_ends')} <b>${t('duo.accept')}</b> ${t('duo.the_document')} <b>${t('duo.send_it_back')}</b> ${t('duo.to_the_writer_or')} <b>${t('duo.stop_2')}</b>.</li>
          <li>${t('duo.you_can_also_type')} <b>${t('duo.instructions')}</b>${t('duo.e_g_keep_the_pricing_and')}</li>
          <li>${t('duo.nothing_crosses_these_questions_automatically_th')}</li>
        </ul>

        <h4>${t('duo.n4_reading_the_chat')}</h4>
        <ul>
          <li><b>${t('duo.robots')}</b>${t('duo.one_per_model_claude_chatgpt_grok')}</li>
          <li><b>${t('duo.writer')}</b> ${t('duo.messages_carry_the_draft')}<i>${t('duo.document_md_vn')}</i>${t('duo.click_it_or_use_v1_v2')} <b>${t('duo.document')}</b> ${t('duo.panel_to_read_any_version')}</li>
          <li><b>${t('duo.reviewer')}</b> ${t('duo.messages_show_the_score_and_its')} <span class="sev major">${t('duo.major')}</span> ${t('duo.notes_block_approval_and')} <span class="sev minor">${t('duo.minor')}</span> ${t('duo.notes_don_t_the_header_chart')}</li>
          <li>${t('duo.the')} <b>${t('duo.supervisor')}</b> ${t('duo.panel_lists_what_it_checked_and')} <b>${t('duo.stop')}</b> ${t('duo.ends_the_run_and')} <b>${t('duo.run_folder')}</b> ${t('duo.opens_its_files')}</li>
        </ul>

        <h4>${t('duo.n5_when_something_goes_wrong')}</h4>
        <ul>
          <li>${t('duo.if_an_agent_s_answer_doesn')}</li>
          <li>${t('duo.if_it_still_fails_the_supervisor')}</li>
          <li>${t('duo.real_runs_check_before_starting_that')}</li>
        </ul>

        <h4>${t('duo.n6_where_the_results_are')}</h4>
        <ul>
          <li>${t('duo.in_the_run_folder')} <b>${t('duo.document_md')}</b> ${t('duo.the_last_version_and')} <b>${t('duo.drafts_v1_md_v2_md')}</b>${t('duo.plus_the_full_log_of_the')} <b>${t('duo.artifacts')}</b>.</li>
          <li>${t('duo.every_run_is_in')} <b>${t('duo.workflows_runs')}</b>${t('duo.and_under_the_project_when_you')} <b>${t('duo.open_chat')}</b> ${t('duo.replays_the_conversation_or_follows_it')}</li>
          <li>${t('duo.under_the_hood_it_s_the')} <span class="mono">${t('duo.writer_reviewer')}</span> ${t('duo.workflow_workflows_definitions_which_you_can')}</li>
        </ul>

        <h4>${t('duo.n7_simulation_developer_mode')}</h4>
        <ul>
          <li>${t('duo.turn_on')} <b>${t('duo.settings_execution_developer_mode')}</b> ${t('duo.to_see_the')} <b>${t('duo.simulation_2')}</b> ${t('duo.checkbox_checked_by_default_simulated_agents')}</li>
          <li>${t('duo.the')} <b>${t('duo.scenario')}</b> ${t('duo.picker_sets_what_the_simulated_agents')}</li>
          <li>${t('duo.real_runs_use_your_clis_plans')}</li>
        </ul>
      </div>
    </div>
  </div>`,
    mount() {
      // the screen is a preview: a badge after its label (drawn by CSS, so the entry's name stays its label)
      document.querySelector('.nav-item[data-view="duo"]')?.insertAdjacentHTML('beforeend', '<span class="nav-badge nav-lab" aria-hidden="true"></span>');
      init();
    },
  });
})();
