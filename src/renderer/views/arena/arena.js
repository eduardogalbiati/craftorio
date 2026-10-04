// AI Arena: runs the ai-arena workflow with up to five user-picked models and shows it as a chat
// between the contenders, the synthesizer, the verifier and the platform's supervisor. Like Write &
// Review (views/duo/), the chat is rebuilt from the run's events, live (run:event) or from a past
// run's events.jsonl (Workflows › Runs › "Open chat"). Styles: chat.css + arena.css; models:
// chat-models.js. Registers itself with registerView, with its guide dialog.
(() => {
  const $a = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const WORKFLOW = 'ai-arena';
  const FILE = 'ai-arena.yaml';
  const { PROVIDERS, EFFORTS } = window.ChatModels;
  const BY_KEY = Object.fromEntries(Object.entries(PROVIDERS).map(([id, p]) => [p.key, id]));
  const MIN = 2;
  const MAX = 5;
  const SLOT_COLORS = ['var(--ar-c1)', 'var(--ar-c2)', 'var(--ar-c3)', 'var(--ar-c4)', 'var(--ar-c5)'];
  // The workflow's defaults (contender_1 … contender_4; the 5th slot is off).
  const DEFAULTS = [
    { provider: 'claude-code', model: 'claude-opus-5-5', effort: 'high' },
    { provider: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' },
    { provider: 'codex-cli', model: 'gpt-6-luna', effort: 'high' },
    { provider: 'grok-cli', model: 'grok-4.7', effort: 'high' },
  ];
  const EXTRA = { provider: 'claude-code', model: 'claude-haiku-4-5', effort: 'high' };
  // Simulation scenarios (developer mode), as the engine's mockSequences.
  const SCENARIOS = {
    happy: { label: 'The verifier passes the first synthesis', seq: {} },
    fix: { label: 'The verifier finds issues once (one round of fixes)', seq: { verdict: ['issues', 'pass'] } },
    format: { label: 'A critique comes back in the wrong format (asked again)', seq: { invalid_answers: { critique: 1 } } },
  };
  const PHASES = [['compete', 'Compete'], ['critique', 'Critique'], ['synthesize', 'Synthesize'], ['verify', 'Verify'], ['review', 'You']];
  const ICON_DOC = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></svg>';
  const LS = 'multiagent.arena';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } })();
  const setup = {
    contenders: (Array.isArray(saved.contenders) && saved.contenders.length >= MIN ? saved.contenders.slice(0, MAX) : DEFAULTS)
      .filter((c) => PROVIDERS[c.provider]).map((c) => ({ ...c })),
  };
  if (setup.contenders.length < MIN) setup.contenders = DEFAULTS.map((c) => ({ ...c }));

  // A model id's CLI when the run does not say it (e.g. runs of older ai-arena versions).
  const providerOfModel = (m = '') => (/claude/i.test(m) ? 'claude-code' : /grok/i.test(m) ? 'grok-cli' : /gpt|codex|^o\d/i.test(m) ? 'codex-cli' : '');

  // ---------------------------------------------------------------- roles and robots
  // roles: agent name → { kind, name, color, side, provider, model, effort, internal }
  let roles = {};
  const INTERNAL = () => ({
    synthesizer: { kind: 'synthesizer', name: 'Synthesizer', color: 'var(--ar-synth)', side: 'right', provider: 'claude-code', model: 'claude-opus-5-5' },
    verifier: { kind: 'verifier', name: 'Verifier', color: 'var(--ar-verify)', side: 'right', provider: 'codex-cli', model: 'gpt-6-luna' },
    supervisor: { kind: 'supervisor', name: 'Supervisor', color: 'var(--supervisor)', side: 'left', internal: true },
  });
  const contenders = () => Object.keys(roles).filter((r) => roles[r].kind === 'contender');
  const roleOf = (agent) => (agent === '_supervisor' ? 'supervisor' : roles[agent] ? agent : null);
  const plate = (model) => (model ? Robots.plaqueFor(model) : '');
  const robotSvg = (r, st = 'idle', opts = {}) => Robots.svg(r.internal ? 'supervisor' : Robots.variantFor(r.provider, r.model), st,
    { mirror: r.side === 'left', plaque: r.internal ? undefined : plate(r.model), ...opts });
  const avatar = (role) => `<span class="duo-robot still" aria-hidden="true">${robotSvg(roles[role], 'idle', { bubble: false })}</span>`;
  const styleOf = (role) => `style="--role:${roles[role]?.color || 'var(--accent)'}"`;
  // Display names: the model's plate ("Opus 5.5"), numbered when two contenders use the same model.
  function nameContenders() {
    const list = contenders();
    const count = {};
    list.forEach((r) => { const p = plate(roles[r].model) || r; count[p] = (count[p] || 0) + 1; });
    const seen = {};
    list.forEach((r) => {
      const p = plate(roles[r].model) || r;
      seen[p] = (seen[p] || 0) + 1;
      roles[r].name = count[p] > 1 ? `${p} #${seen[p]}` : p;
    });
  }

  // ---------------------------------------------------------------- setup form
  function renderSetup() {
    const box = $a('#arena-contenders');
    const n = setup.contenders.length;
    $a('#arena-count').textContent = `${n} of ${MAX}`;
    box.innerHTML = setup.contenders.map((c, i) => `
      <div class="ar-card" style="--role:${SLOT_COLORS[i]}" data-slot="${i}">
        ${n > MIN ? `<button type="button" class="ar-remove" data-remove="${i}" title="Remove this model" aria-label="Remove this model">×</button>` : ''}
        <div class="ar-card-head"><span class="duo-robot" data-slot-robot="${i}"></span></div>
        <div class="ar-card-title">Contender ${i + 1}</div>
        <div class="field"><label>Provider</label><select data-field="provider">${Object.entries(PROVIDERS).map(([k, p]) => `<option value="${k}"${k === c.provider ? ' selected' : ''}>${p.label}</option>`).join('')}</select></div>
        <div class="field"><label>Model</label><select data-field="model">${PROVIDERS[c.provider].models.map((m) => `<option${m === c.model ? ' selected' : ''}>${m}</option>`).join('')}</select></div>
        <div class="field"><label>Effort</label><div class="seg duo-effort">${EFFORTS.map((e) => `<button type="button" data-effort="${e}" class="${e === c.effort ? 'active' : ''}">${e}</button>`).join('')}</div></div>
      </div>`).join('') + (n < MAX ? '<button type="button" class="ar-add" id="arena-add"><b>+</b>Add a model</button>' : '');
    setup.contenders.forEach((c, i) => {
      $a(`[data-slot-robot="${i}"]`).innerHTML = robotSvg({ ...c, side: 'left' }, 'idle');
      const card = $a(`.ar-card[data-slot="${i}"]`);
      card.querySelector('[data-field="provider"]').onchange = (e) => { c.provider = e.target.value; c.model = PROVIDERS[c.provider].models[0]; renderSetup(); };
      card.querySelector('[data-field="model"]').onchange = (e) => { c.model = e.target.value; renderSetup(); };
      card.querySelectorAll('[data-effort]').forEach((b) => (b.onclick = () => { c.effort = b.dataset.effort; renderSetup(); }));
    });
    box.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => { setup.contenders.splice(+b.dataset.remove, 1); renderSetup(); }));
    const add = $a('#arena-add');
    if (add) {
      add.onclick = () => {
        // the next default model nobody picked yet, else a small one
        const used = new Set(setup.contenders.map((c) => c.model));
        setup.contenders.push({ ...(DEFAULTS.find((d) => !used.has(d.model)) || EXTRA) });
        renderSetup();
      };
    }
  }

  function readSetup() {
    const inputs = {
      task: $a('#arena-task').value.trim(),
      project_path: projects.find((p) => p.id === $a('#arena-project').value)?.folder || '',
      document_skill: $a('#arena-skill').value || 'prd-writing',
      attachments: attachmentsInput(),
      peer_review: $a('#arena-peer').checked ? 'yes' : 'no',
      lenses: $a('#arena-lenses').checked ? 'on' : 'off',
    };
    for (let i = 0; i < MAX; i++) {
      const c = setup.contenders[i];
      inputs[`contender_${i + 1}_provider`] = c ? PROVIDERS[c.provider].key : 'none';
      if (c) Object.assign(inputs, { [`contender_${i + 1}_model`]: c.model, [`contender_${i + 1}_effort`]: c.effort });
    }
    return inputs;
  }

  async function startRun() {
    const err = $a('#arena-error');
    err.textContent = '';
    const inputs = readSetup();
    if (!inputs.task) { err.textContent = 'Write the request first.'; return; }
    if (setup.contenders.length < MIN) { err.textContent = `Pick at least ${MIN} models.`; return; }
    // simulation only in developer mode (the checkbox is hidden otherwise); checked without it fails
    let mock;
    try { mock = wantsSimulation($a('#arena-mock')); } catch (e) { err.textContent = e.message; return; }
    const scenario = $a('#arena-scenario').value;
    try {
      localStorage.setItem(LS, JSON.stringify({
        contenders: setup.contenders, task: inputs.task, skill: inputs.document_skill, peer: inputs.peer_review, lenses: inputs.lenses,
        scenario, project: $a('#arena-project').value,
      }));
    } catch { /* ignore */ }
    $a('#arena-run').disabled = true;
    try {
      starting = true; // the run's first events may arrive before startRun resolves
      // images pasted into the request (#130): the run's `attachments`, not the text input of that name
      const images = await PasteImage.collect($a('#arena-task'));
      const { runId } = await api.startRun({ file: FILE, inputs, mock, mockSequences: mock ? SCENARIOS[scenario]?.seq : null, ...(images.length ? { attachments: { task: images } } : {}) });
      PasteImage.clear($a('#arena-task'));
      bindLive(runId);
    } catch (e) {
      starting = false;
      buffer = [];
      err.textContent = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      $a('#arena-run').disabled = false;
    }
  }

  // Projects (Projects view): the chosen one's folder is the models' working folder, read-only.
  let projects = [];
  async function loadProjects() {
    try { projects = await api.listProjects(); } catch { projects = []; }
    const sel = $a('#arena-project');
    const current = sel.value || saved.project || '';
    sel.innerHTML = '<option value="">No project (the request only)</option>' + projects.map((p) =>
      `<option value="${esc(p.id)}"${p.exists ? '' : ' disabled'}${p.id === current && p.exists ? ' selected' : ''}>${esc(p.name)}${p.exists ? '' : ' (folder missing)'}</option>`).join('');
    const hint = () => {
      const p = projects.find((x) => x.id === sel.value);
      $a('#arena-project-hint').textContent = p ? `${p.folder}: read-only for the models; the final document stays in the run folder (workspace).` : 'The models read its files (read-only); the final document stays in the run folder (workspace).';
    };
    sel.onchange = hint;
    hint();
  }
  // Document types: the bundled document skills, plus any workspace skill named *-writing.
  const DOC_TYPES = [
    ['prd-writing', 'PRD'], ['design-doc-writing', 'Design doc'], ['rfc-writing', 'RFC'],
    ['adr-writing', 'ADR'], ['test-plan-writing', 'Test plan'], ['design-sketch', 'Design sketch'],
  ];
  async function loadSkills() {
    let list = [];
    try { list = await api.listSkills(); } catch { /* the bundled types only */ }
    const sel = $a('#arena-skill');
    const current = sel.value || saved.skill || 'prd-writing';
    const known = new Set(DOC_TYPES.map(([id]) => id));
    const extra = list.map((s) => s.id).filter((id) => id && /-writing$/.test(id) && !known.has(id)).map((id) => [id, id]);
    const types = [...DOC_TYPES, ...extra];
    if (!types.some(([id]) => id === current)) types.push([current, current]);
    sel.innerHTML = types.map(([id, label]) => `<option value="${esc(id)}"${id === current ? ' selected' : ''}>${esc(label)}${label === id ? '' : ` (${esc(id)})`}</option>`).join('');
  }

  // ---------------------------------------------------------------- reference documents
  // Text files the user attaches: read here and sent as the `attachments` input, each one after
  // a "===== Attached file: <name> =====" line (the chat splits them back by that line).
  const MAX_FILE = 200 * 1024;
  const MAX_TOTAL = 400 * 1024;
  const attachments = [];
  const ATTACH_HEAD = (name) => `===== Attached file: ${name} =====`;
  const fmtSize = (n) => (n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);
  function renderAttachments() {
    $a('#arena-attachments').innerHTML = attachments.map((a, i) =>
      `<span class="ar-chip" title="${esc(a.name)}"><span>${esc(a.name)}</span><small>${fmtSize(a.size)}</small><button type="button" data-unattach="${i}" title="Remove" aria-label="Remove ${esc(a.name)}">×</button></span>`).join('');
    $a('#arena-attach-hint').classList.toggle('hidden', attachments.length > 0);
    $a('#arena-attachments').querySelectorAll('[data-unattach]').forEach((b) => (b.onclick = () => { attachments.splice(+b.dataset.unattach, 1); renderAttachments(); }));
  }
  async function addFiles(files) {
    const err = $a('#arena-error');
    err.textContent = '';
    const problems = [];
    for (const f of files) {
      if (f.size > MAX_FILE) { problems.push(`${f.name} is larger than ${fmtSize(MAX_FILE)}`); continue; }
      let text;
      try { text = await f.text(); } catch { problems.push(`${f.name} could not be read`); continue; }
      // binary files (PDF, Word, images) read as text are full of NUL/replacement characters
      if (/\u0000/.test(text) || (text.match(/�/g) || []).length > 20) { problems.push(`${f.name} is not a text file (export it to Markdown or plain text)`); continue; }
      const total = attachments.reduce((n, a) => n + a.size, 0);
      if (total + f.size > MAX_TOTAL) { problems.push(`${f.name}: attachments are limited to ${fmtSize(MAX_TOTAL)} in total`); continue; }
      const i = attachments.findIndex((a) => a.name === f.name);
      const item = { name: f.name, size: f.size, text };
      if (i >= 0) attachments[i] = item; else attachments.push(item);
    }
    renderAttachments();
    if (problems.length) err.textContent = `Not attached: ${problems.join('; ')}.`;
  }
  const attachmentsInput = () => attachments.map((a) => `${ATTACH_HEAD(a.name)}\n${a.text.trim()}`).join('\n\n');
  // the run's attachments input back into { name, text } (chat and replays)
  function splitAttachments(s) {
    const parts = String(s || '').split(/^===== Attached file: (.+?) =====$/m);
    const out = [];
    for (let i = 1; i < parts.length; i += 2) out.push({ name: parts[i], text: parts[i + 1].trim() });
    return out;
  }

  // ---------------------------------------------------------------- chat state
  const chat = { runId: null, live: false, running: false };
  function resetChat(runId, live) {
    roles = INTERNAL();
    Object.assign(chat, {
      runId, live, running: live, seq: 0, runDir: null, mock: false, peer: true,
      order: [], proposals: {}, finals: [], attachments: [], docTab: null, scores: {}, posted: new Set(),
      working: new Map(), sessions: new Map(), usage: {}, invalid: {}, phase: null, phasesDone: new Set(), skipped: new Set(),
      interventions: 0, cost: 0, supervised: null, labels: {},
    });
    $a('#arena-setup').classList.add('hidden');
    $a('#arena-chat').classList.remove('hidden');
    $a('#arena-messages').innerHTML = '';
    $a('#arena-checks').innerHTML = '';
    $a('#arena-cast').innerHTML = '';
    $a('#arena-interventions').textContent = '0/6';
    $a('#arena-chat-title').textContent = 'AI Arena';
    $a('#arena-chat-status').textContent = live ? 'starting…' : 'loading…';
    $a('#arena-stop').classList.toggle('hidden', !live);
    setSuperPill('watch', 'watching');
    renderPhases();
    renderDocs();
    renderBoard();
  }

  const clock = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const fmtDur = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${Math.round((ms || 0) / 1000)}s`);
  const words = (t) => String(t || '').split(/\s+/).filter(Boolean).length;

  function addToChat(html) {
    const box = $a('#arena-messages');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    const working = box.querySelector('.ar-working');
    if (working) working.insertAdjacentHTML('beforebegin', html);
    else box.insertAdjacentHTML('beforeend', html);
    if (stick && chat.live) box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- header
  function renderCast() {
    $a('#arena-cast').innerHTML = Object.keys(roles).map((r) =>
      `<span class="duo-cast" title="${esc(roles[r].name)}"><span class="duo-robot head" data-arena-cast="${esc(r)}"></span><span data-arena-cast-state="${esc(r)}">idle</span></span>`).join('');
    Object.keys(roles).forEach((r) => setCast(r, roles[r].state || 'idle', true));
    const n = contenders().length;
    $a('#arena-chat-title').textContent = n ? `AI Arena · ${n} models` : 'AI Arena';
  }

  function setCast(role, st, force) {
    const r = roles[role];
    if (!r || (r.state === st && !force)) return;
    r.state = st;
    const el = document.querySelector(`[data-arena-cast="${role}"]`);
    if (!el) return;
    el.innerHTML = robotSvg(r, st, { bubble: false });
    document.querySelector(`[data-arena-cast-state="${role}"]`).textContent = st;
  }

  function renderPhases() {
    $a('#arena-phases').innerHTML = PHASES.map(([id, label]) => {
      const cls = chat.phase === id ? 'now' : chat.skipped?.has(id) ? 'skip' : chat.phasesDone?.has(id) ? 'done' : '';
      return `<span class="${cls}">${label}</span>`;
    }).join('<i>›</i>');
  }
  function enterPhase(id) {
    if (chat.phase && chat.phase !== id) chat.phasesDone.add(chat.phase);
    // the critique is skipped when peer review is off (or only one proposal came in)
    if (id !== 'compete' && id !== 'critique' && !chat.phasesDone.has('critique')) chat.skipped.add('critique');
    chat.phase = id;
    renderPhases();
  }

  function setSuperPill(kind, text) {
    const pill = $a('#arena-super-state');
    pill.className = `pill pill-${kind}`;
    pill.textContent = text;
  }

  // ---------------------------------------------------------------- the models at work
  // A fan-out has several models working at once: one row shows every robot that is busy.
  const DOING = { thinking: 'thinking', writing: 'writing', reading: 'reading' };
  function setWorking(role, st) {
    if (!roles[role]) return;
    if (st) chat.working.set(role, st);
    else chat.working.delete(role);
    setCast(role, st || 'idle');
    renderWorking();
  }
  function renderWorking() {
    const box = $a('#arena-messages');
    box.querySelector('.ar-working')?.remove();
    const busy = [...chat.working.entries()];
    if (!busy.length) {
      if (chat.running) $a('#arena-chat-status').textContent = 'running';
      return;
    }
    const label = busy.length === 1 ? `${roles[busy[0][0]].name} is ${DOING[busy[0][1]] || 'working'}` : `${busy.length} models are working`;
    $a('#arena-chat-status').textContent = `${label}…`;
    if (!chat.live) return;
    // the row sits on the right only when every busy robot does; its robots face the other side
    const right = busy.every(([r]) => roles[r].side === 'right');
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 240;
    box.insertAdjacentHTML('beforeend', `<div class="ar-working${busy.length === 1 ? ' solo' : ''}${right ? ' right' : ''}">${busy.map(([r, st]) =>
      `<figure ${styleOf(r)}><span class="duo-robot" aria-hidden="true">${robotSvg(roles[r], st, { mirror: !right })}</span><figcaption><b>${esc(roles[r].name)}</b> · ${esc(DOING[st] || st)}</figcaption></figure>`).join('')}
      <span class="duo-dots"><i></i><i></i><i></i></span></div>`);
    if (stick) box.scrollTop = box.scrollHeight;
  }

  // ---------------------------------------------------------------- messages
  function footOf(key) {
    const u = chat.usage[key];
    if (!u || !u.ms) return '';
    return `${fmtK(u.input)} in / ${fmtK(u.output)} out · $${u.cost.toFixed(2)} · ${fmtDur(u.ms)}`;
  }

  function message(role, body, ts, usageKey) {
    const r = roles[role];
    const tag = r.internal ? '' : `<span class="tag">${esc(r.model)}${r.effort ? ` · ${esc(r.effort)}` : ''}</span>`;
    const foot = usageKey ? footOf(usageKey) : '';
    const cls = role === 'supervisor' ? 'supervisor' : `ar-msg ar-${r.side}`;
    addToChat(`<div class="duo-msg ${cls}" ${styleOf(role)}>${avatar(role)}<div class="duo-bubble">
      <div class="duo-meta"><b>${esc(r.name)}</b>${tag}<span class="time">${clock(ts)}</span></div>
      ${body}${foot ? `<div class="duo-foot">${esc(foot)}</div>` : ''}</div></div>`);
    // a failure stops shaking once someone answers it
    document.querySelectorAll('#arena-messages .duo-fail .duo-robot').forEach((x) => x.classList.add('still'));
  }

  function failRow(role, text) {
    if (!roles[role]) return;
    addToChat(`<div class="duo-fail${roles[role].side === 'left' ? ' left' : ''}"><span class="duo-robot${chat.live ? '' : ' still'}" aria-hidden="true">${robotSvg(roles[role], 'error')}</span><span class="duo-fail-text">${esc(text)}</span></div>`);
    chat.working.delete(role);
    renderWorking();
    setCast(role, 'error');
  }

  const note = (html, cls = 'plain') => addToChat(`<div class="duo-note ${cls}"><span>${html}</span></div>`);
  const addCheck = (cls, text) => $a('#arena-checks').insertAdjacentHTML('beforeend', `<li class="${cls}">${esc(text)}</li>`);
  const docCard = (role, tab, title, text) => `<button type="button" class="duo-doc-card ar-doc-card" ${styleOf(role)} data-tab="${esc(tab)}">${ICON_DOC}<span><b>${esc(title)}</b><small>${words(text)} words · click to view</small></span></button>`;
  // "Proposal N" → the contender who wrote it (the run's shuffled order, see arena-shuffle.js)
  const authorOf = (n) => chat.order[n - 1];
  const proposalLabel = (n) => {
    const a = authorOf(n);
    return a && roles[a] ? `<span class="ar-author" ${styleOf(a)}>Proposal ${n} · ${esc(roles[a].name)}</span>` : `<span class="ar-author">Proposal ${n}</span>`;
  };

  // ---------------------------------------------------------------- side panel
  function renderDocs() {
    const tabs = [
      ...chat.attachments.map((a, i) => ({ id: `a:${i}`, role: null, label: `📎 ${a.name}` })),
      ...contenders().filter((r) => chat.proposals[r] != null).map((r) => ({ id: `p:${r}`, role: r, label: roles[r].name })),
      ...chat.finals.map((_, i) => ({ id: `f:${i}`, role: 'synthesizer', label: `Final v${i + 1}` })),
    ];
    $a('#arena-doc-tabs').innerHTML = tabs.map((t) => `<button type="button" ${styleOf(t.role)} class="${t.id === chat.docTab ? 'active' : ''}" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('');
    const [kind, key] = String(chat.docTab || '').split(/:(.*)/);
    const text = kind === 'p' ? chat.proposals[key] : kind === 'f' ? chat.finals[+key] : kind === 'a' ? chat.attachments[+key]?.text : null;
    $a('#arena-doc-body').innerHTML = text == null ? '<p class="muted">No proposal yet.</p>' : md(text);
  }
  function showDoc(tab) {
    chat.docTab = tab;
    renderDocs();
    $a('#arena-doc-body').scrollTop = 0;
  }

  // Average score each contender's proposal got from the others (the models never see this).
  function renderBoard() {
    const list = contenders();
    const avg = (r) => (chat.scores[r]?.length ? chat.scores[r].reduce((a, b) => a + b, 0) / chat.scores[r].length : null);
    const best = Math.max(-1, ...list.map((r) => avg(r) ?? -1));
    $a('#arena-board').innerHTML = !list.length ? '<p class="muted small">No contenders yet.</p>' : list.map((r) => {
      const v = avg(r);
      const n = chat.scores[r]?.length || 0;
      return `<div class="ar-board-row${v != null && v === best ? ' best' : ''}" ${styleOf(r)} title="${n} score${n === 1 ? '' : 's'} from the other models">
        <span class="name">${esc(roles[r].name)}</span><span class="bar"><i style="width:${v == null ? 0 : Math.min(100, v * 10)}%"></i></span>
        <span class="val">${v == null ? '—' : v.toFixed(1)}</span></div>`;
    }).join('') + (chat.peer ? '' : '<p class="muted small">Peer review is off for this run.</p>');
  }

  // ---------------------------------------------------------------- events → chat
  function apply(ev) {
    if (ev.seq && ev.seq <= chat.seq) return; // already shown (replay + live overlap)
    if (ev.seq) chat.seq = ev.seq;
    switch (ev.type) {
      case 'workflow.started': return onStarted(ev);
      case 'session.opened': return onSession(ev);
      case 'step.started': return onStepStarted(ev);
      case 'session.stream': return onStream(ev);
      case 'session.message_received': return onMessage(ev);
      case 'log': return onLog(ev);
      case 'supervisor.started':
        chat.supervised = ev.step_id;
        setWorking('supervisor', 'reading');
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
    // the contenders are the agents of the compete step (contender_1 … in this version)
    const names = String(ev.steps?.find((s) => s.id === 'compete')?.agent || '').split(' · ').filter(Boolean);
    const internal = roles;
    roles = {};
    names.forEach((name, idx) => {
      const n = /^contender_(\d)$/.exec(name)?.[1];
      const model = n ? i[`contender_${n}_model`] : '';
      roles[name] = {
        kind: 'contender', color: SLOT_COLORS[(n ? +n - 1 : idx) % SLOT_COLORS.length], side: 'left',
        provider: (n && BY_KEY[i[`contender_${n}_provider`]]) || providerOfModel(model), model: model || '', effort: n ? i[`contender_${n}_effort`] : '',
      };
    });
    Object.assign(roles, internal);
    nameContenders();
    Object.assign(chat, { runDir: ev.run_dir, mock: !!ev.mock, peer: i.peer_review !== 'no', attachments: splitAttachments(i.attachments) });
    if (chat.attachments.length) renderDocs();
    renderCast();
    renderBoard();
    addToChat(`<div class="duo-msg user"><div class="duo-bubble">
      <div class="duo-meta"><b>You</b><span class="time">${clock(ev.ts)}</span></div>
      <p><b>Request</b> <span class="duo-msg-text">${esc(i.task)}</span></p>${chat.attachments.length ? `<p>${chat.attachments.map((a, k) =>
        `<button type="button" class="ar-chip" data-tab="a:${k}" title="Open ${esc(a.name)}">📎 <span>${esc(a.name)}</span></button>`).join('')}</p>` : ''}</div></div>`);
    const project = i.project_path ? (projects.find((p) => p.folder === i.project_path)?.name || i.project_path) : '';
    note(`Run started${ev.mock ? ' · <b>simulation</b>' : ''} · ${names.length} models · document <b>${esc(i.document_skill || 'prd-writing')}</b>`
      + `${chat.peer ? ' · blind peer review' : ''}${i.lenses === 'on' ? ' · different lenses' : ''}${project ? ` · project <b>${esc(project)}</b> (read-only)` : ''}`);
    addCheck('ok', `Run started${ev.mock ? ' (simulation, no model calls)' : ''}`);
    $a('#arena-chat-status').textContent = 'running';
  }

  // Runs of older ai-arena versions have no contender inputs: the sessions say which model each one is.
  function onSession(ev) {
    const s = ev.session || {};
    chat.sessions.set(ev.session_id, s.agent);
    const r = roles[s.agent];
    if (!r || r.internal || !s.model) return;
    if (r.model === s.model && r.provider) return;
    r.model = s.model;
    r.provider = BY_KEY[s.provider] || providerOfModel(s.model) || r.provider;
    nameContenders();
    renderCast();
    renderBoard();
  }

  function onStepStarted(ev) {
    const id = ev.step_id;
    if (PHASES.some(([p]) => p === id)) enterPhase(id);
    const agents = String(ev.agent || '').split(' · ').filter((a) => roles[a]);
    agents.forEach((a) => { chat.usage[`${id}:${a}`] = { input: 0, output: 0, cost: 0, ms: 0 }; chat.invalid[a] = 0; });
    if (id === 'compete') note(`<b>Compete</b> · ${agents.length} models write their own proposal in parallel, without seeing each other's work`);
    if (id === 'critique') {
      const map = chat.order.map((a, k) => `${k + 1} = ${esc(roles[a]?.name || a)}`).join(', ');
      note(`<b>Blind critique</b> · each model scores the others' proposals, anonymized${map ? ` (only you know: ${map})` : ''}`);
    }
    if (id === 'synthesize' && ev.visit > 1) note(`<b>New synthesis</b> · v${ev.visit}`);
    agents.forEach((a) => setWorking(a, id === 'compete' ? 'thinking' : 'reading'));
  }

  // What the CLI streams says what the robot is doing: reasoning, using a tool, writing.
  function onStream(ev) {
    const role = roleOf(chat.sessions.get(ev.session_id));
    if (!role || !chat.working.has(role)) return;
    const st = { thinking: 'thinking', text: 'writing', tool_call: 'reading' }[ev.item?.kind];
    if (st && st !== chat.working.get(role)) setWorking(role, st);
  }

  function parseJson(text) {
    const src = String(text || '');
    const blocks = [...src.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
    const first = src.indexOf('{');
    const last = src.lastIndexOf('}');
    if (first >= 0 && last > first) blocks.push(src.slice(first, last + 1));
    for (const b of blocks) { try { return JSON.parse(b); } catch { /* next */ } }
    return null;
  }

  function onMessage(ev) {
    const stepId = String(ev.step_id || '').split(':')[0];
    const role = roleOf(chat.sessions.get(ev.session_id));
    const key = `${stepId}:${role}`;
    const u = (chat.usage[key] ??= { input: 0, output: 0, cost: 0, ms: 0 });
    u.input += (ev.usage?.input || 0) + (ev.usage?.cache_read || 0) + (ev.usage?.cache_write || 0);
    u.output += ev.usage?.output || 0;
    u.cost += ev.cost_usd || 0;
    u.ms += ev.duration_ms || 0;
    chat.cost += ev.cost_usd || 0;
    if (!role || roles[role].kind !== 'contender') return;
    // fan-out answers are shown as each model finishes, not when the whole step does
    if (stepId === 'compete') {
      setWorking(role, null);
      postProposal(role, ev.text, ev.ts);
    }
    if (stepId === 'critique') {
      setWorking(role, null);
      const o = parseJson(ev.text);
      // only a complete answer: an incomplete one is rejected and asked again
      if (o && Array.isArray(o.evaluations) && Array.isArray(o.best_ideas) && typeof o.self_revision === 'string') postCritique(role, o, ev.ts);
    }
  }

  function postProposal(role, text, ts) {
    if (chat.proposals[role] != null) return;
    chat.proposals[role] = String(text || '');
    if (!chat.docTab) chat.docTab = `p:${role}`;
    renderDocs();
    setCast(role, 'done');
    message(role, `<p class="duo-msg-text">My proposal is ready.</p>${docCard(role, `p:${role}`, `proposal · ${roles[role].name}`, text)}`, ts, `compete:${role}`);
  }

  function postCritique(role, o, ts) {
    if (chat.posted.has(role)) return;
    chat.posted.add(role);
    const evals = (o.evaluations || []).map((e) => {
      const score = +e.score || 0;
      const target = authorOf(+e.proposal);
      if (target && target !== role) (chat.scores[target] ??= []).push(score);
      const list = (items, cls, sign) => (items || []).map((x) => `<li><span class="${cls}">${sign}</span> ${esc(x)}</li>`).join('');
      const details = list(e.strengths, 'ar-plus', '+') + list(e.weaknesses, 'ar-minus', '−') + list(e.errors, 'ar-err', '!');
      return `<li class="ar-eval" ${target ? styleOf(target) : ''}>${proposalLabel(+e.proposal)}
        <span class="duo-score-bar"><i style="width:${Math.min(100, score * 10)}%"></i></span><span class="ar-eval-num">${score.toFixed(1)}</span>
        ${details ? `<details><summary>strengths and weaknesses</summary><ul>${details}</ul></details>` : ''}</li>`;
    }).join('');
    const ideas = (o.best_ideas || []).map((x) => `<li>${esc(x)}</li>`).join('');
    message(role, `<p class="duo-msg-text">My scores for the other proposals:</p>${evals ? `<ul class="ar-evals">${evals}</ul>` : ''}
      ${ideas ? `<details><summary class="muted small">Best ideas I saw</summary><ul>${ideas}</ul></details>` : ''}
      ${o.self_revision ? `<p class="muted small"><b>What I would change in mine:</b> <span class="duo-msg-text">${esc(o.self_revision)}</span></p>` : ''}`, ts, `critique:${role}`);
    renderBoard();
  }

  function onLog(ev) {
    const msg = String(ev.message || '');
    const m = /^Invalid output in (\w+)(?: \((\w+)\))?/.exec(msg);
    if (m) {
      const role = roleOf(m[2]) || { synthesize: 'synthesizer', verify: 'verifier' }[m[1]];
      if (!role) return;
      // the engine asks again twice, then the step (or this model's part of it) fails
      const last = (chat.invalid[role] = (chat.invalid[role] || 0) + 1) >= 3;
      failRow(role, `Answer rejected: ${msg.replace(/^Invalid output in \w+(?: \([^)]*\))?: /, '').slice(0, 160)}. ${last ? 'Gave up.' : 'Asked again.'}`);
      addCheck('warn', `${roles[role].name}'s answer did not match its format; ${last ? 'gave up' : 'asked again'}`);
      if (chat.live && !last) setWorking(role, 'thinking');
      return;
    }
    // a model of a fan-out step that did not deliver (the step goes on with the others)
    const f = /^\[(compete|critique)\] (\w+) failed: (.*)$/s.exec(msg);
    if (f && roles[f[2]]) {
      failRow(f[2], `${roles[f[2]].name} dropped out of the ${f[1]}: ${f[3].slice(0, 180)}`);
      addCheck('warn', `${roles[f[2]].name} dropped out of the ${f[1]}`);
      return;
    }
    if (ev.level === 'error' && /attempt \d+\/\d+ failed/.test(msg)) addCheck('warn', msg.slice(0, 160));
  }

  function onDecision(ev) {
    chat.interventions++;
    $a('#arena-interventions').textContent = `${chat.interventions}/6`;
    const what = {
      retry: 'I asked for a new attempt.', fix_output: 'I fixed the answer so the run can continue.', goto: `I moved the run to "${esc(ev.goto)}".`,
      ask_human: 'This needs you: see the question below.', fail: 'I could not recover this step.',
    }[ev.action] || '';
    setWorking('supervisor', null);
    message('supervisor', `<p><span class="duo-msg-text">${esc(ev.explanation)}</span></p>
      ${ev.instruction ? `<p class="duo-msg-text">${esc(ev.instruction)}</p>` : ''}<p class="muted small">${what}</p>`, ev.ts);
    addCheck('act', `Intervened on ${ev.step_id}: ${ev.action}`);
  }

  function onStepFinished(ev) {
    const id = ev.step_id;
    const o = ev.output || {};
    if (id === 'compete' || id === 'critique') {
      contenders().forEach((r) => chat.working.delete(r));
      renderWorking();
    }
    if (ev.error) {
      const role = { synthesize: 'synthesizer', verify: 'verifier' }[id];
      // a failure the supervisor already explained in the chat needs no second row
      if (chat.supervised !== id) {
        if (role) failRow(role, `${roles[role].name} failed: ${String(o.error || 'unknown error').slice(0, 200)}`);
        else if (id === 'compete' || id === 'critique') note(`<b>${esc(id)} failed</b> · ${esc(String(o.error || '').slice(0, 220))}`, 'failed');
      }
      chat.supervised = null;
      return;
    }
    if (id === 'compete') {
      // proposals of models whose message was missed (e.g. a replay that starts mid-run)
      for (const [r, res] of Object.entries(o.results || {})) postProposal(r, res?.text, ev.ts);
      chat.order = arenaShuffle(o.succeeded || [], chat.runId);
      const n = (o.succeeded || []).length;
      addCheck(n > 1 ? 'ok' : 'warn', `${n} proposal${n === 1 ? '' : 's'} delivered${o.failed?.length ? `, ${o.failed.length} dropped out` : ''}`);
      renderBoard();
    }
    if (id === 'critique') {
      for (const [r, res] of Object.entries(o.results || {})) postCritique(r, res, ev.ts);
      addCheck('ok', `Blind critique: ${Object.keys(o.results || {}).length} reviews`);
    }
    if (id === 'synthesize') {
      setWorking('synthesizer', null);
      setCast('synthesizer', 'done');
      chat.finals.push(String(o.text || ''));
      const v = chat.finals.length;
      showDoc(`f:${v - 1}`);
      message('synthesizer', `<p class="duo-msg-text">${v === 1 ? 'I merged the proposals: the best one is the base, with the best ideas of the others grafted in (see the appendix for what came from where).' : 'Here is the new version.'}</p>
        ${docCard('synthesizer', `f:${v - 1}`, `final.md · v${v}`, o.text)}`, ev.ts, 'synthesize:synthesizer');
      addCheck('ok', `Final document v${v}`);
    }
    if (id === 'verify') {
      setWorking('verifier', null);
      const pass = o.verdict === 'pass';
      setCast('verifier', pass ? 'done' : 'idle');
      const issues = (o.issues || []).map((x) => `<li>${esc(typeof x === 'string' ? x : JSON.stringify(x))}</li>`).join('');
      message('verifier', `${pass ? '<div class="duo-ready">✓ Pass</div>' : '<div class="duo-not-ready">↺ Issues found</div>'}
        ${!pass && issues ? `<ul class="ar-issues">${issues}</ul>` : ''}<p class="muted small">${pass ? 'The final document is consistent with the skill and the proposals.' : 'The synthesizer fixes them once; what is still open goes to you.'}</p>`, ev.ts, 'verify:verifier');
      addCheck(pass ? 'ok' : 'warn', pass ? 'Verifier: pass' : `Verifier: ${(o.issues || []).length} issue(s)`);
    }
  }

  // The human gate is the supervisor asking the user: its question, the choices and a free text
  // that goes to the next synthesis (the run-wide `feedback`).
  function onApproval(ev) {
    enterPhase('review');
    chat.working.clear();
    renderWorking();
    Object.keys(roles).forEach((r) => setCast(r, 'waiting'));
    const off = chat.live ? '' : ' disabled';
    const choices = ev.choices || [{ id: true, label: 'Approve' }, { id: false, label: 'Reject' }];
    const buttons = choices.map((c, i) => `<button type="button" class="btn sm ${i === 0 ? 'primary' : ''}" data-approval="${esc(ev.approval_id)}" data-choice="${esc(c.id)}"${off}>${esc(c.label)}</button>`).join('');
    const field = ev.feedback ? `<label class="duo-ask-label">${esc(ev.feedback.label)}</label>
      <textarea class="duo-ask-text" rows="2" placeholder="${esc(ev.feedback.placeholder)}"${off}></textarea>` : '';
    chat.labels = Object.fromEntries(choices.map((c) => [String(c.id), c.label]));
    message('supervisor', `<div class="duo-ask" data-gate="${esc(ev.approval_id)}"><p class="duo-msg-text">${esc(ev.message)}</p>${field}<div class="row">${buttons}</div></div>`, ev.ts);
    $a('#arena-chat-status').textContent = 'The supervisor is waiting for you';
    if (chat.live) document.querySelector(`#arena-messages [data-gate="${ev.approval_id}"] textarea`)?.focus({ preventScroll: true });
  }

  function onApprovalResolved(ev) {
    const gate = document.querySelector(`#arena-messages [data-gate="${ev.approval_id}"]`);
    const choice = String(ev.choice ?? ev.approved);
    if (gate) {
      gate.querySelectorAll('button, textarea').forEach((x) => { x.disabled = true; });
      gate.querySelectorAll('button').forEach((x) => { x.classList.remove('primary'); x.classList.toggle('chosen', x.dataset.choice === choice); });
      gate.querySelector('textarea')?.remove();
      gate.querySelector('.duo-ask-label')?.remove();
    }
    addToChat(`<div class="duo-msg user reply"><div class="duo-bubble">
      <div class="duo-meta"><b>You</b><span class="time">${clock(ev.ts)}</span></div>
      <p><b>${esc(chat.labels?.[choice] || choice)}</b></p>${ev.feedback ? `<p class="duo-msg-text">${esc(ev.feedback)}</p>` : ''}</div></div>`);
    if (ev.feedback) addCheck('act', `Your instruction: ${ev.feedback.slice(0, 120)}`);
    Object.keys(roles).forEach((r) => setCast(r, 'idle'));
  }

  function onFinished(ev) {
    chat.running = false;
    chat.working.clear();
    renderWorking();
    if (chat.phase) chat.phasesDone.add(chat.phase);
    chat.phase = null;
    renderPhases();
    $a('#arena-stop').classList.add('hidden');
    const s = ev.summary || {};
    const cost = `$${(s.cost_usd ?? chat.cost).toFixed(2)}`;
    const dur = fmtDur(s.duration_ms || 0);
    if (ev.status === 'success') {
      note(`<b>Done</b> · ${chat.finals.length ? `final document saved to <span class="mono">arena/final.md</span>` : 'finished'} · ${cost} · ${dur}`, 'done');
      Object.keys(roles).forEach((r) => setCast(r, 'done'));
      setSuperPill('success', 'done');
      addCheck('ok', 'Run finished');
      $a('#arena-chat-status').textContent = 'Finished';
    } else {
      note(`<b>${esc(ev.status)}</b> · ${esc(String(ev.error || '').slice(0, 220))} · ${cost} · ${dur}`, 'failed');
      setSuperPill(ev.status === 'cancelled' ? 'cancelled' : 'failed', ev.status);
      addCheck('warn', `Run ${ev.status}`);
      $a('#arena-chat-status').textContent = ev.status === 'cancelled' ? 'Cancelled' : 'Failed';
    }
  }

  // ---------------------------------------------------------------- live / history
  let starting = false;
  let buffer = [];
  // Events of the run this screen started, or of an ai-arena run started elsewhere while nothing
  // is running here. A past run is replayed from its events.jsonl (openRun).
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
    if (typeof showView === 'function') showView('arena');
    resetChat(runId, false);
    let events = [];
    try { events = await api.runEvents(runId); } catch (e) { note(`Could not load the run: ${esc(e.message || e)}`, 'failed'); return; }
    for (const ev of events) apply(ev);
    const finished = events.some((e) => e.type === 'workflow.finished');
    chat.live = running && !finished;
    chat.running = chat.live;
    $a('#arena-stop').classList.toggle('hidden', !chat.live);
    renderWorking();
    if (!finished && !chat.live) $a('#arena-chat-status').textContent = 'Interrupted';
    if (!chat.live) $a('#arena-messages').scrollTop = 0;
  }
  window.openArenaRun = openRun;
  // true while this screen shows the live run (its gate is answered in the chat, not in a dialog)
  window.arenaShowsRun = (runId) => chat.live && chat.runId === runId
    && !$a('#view-arena').classList.contains('hidden') && !$a('#arena-chat').classList.contains('hidden');
  // the run this screen shows (live or replayed), for desktop notifications
  window.arenaShownRunId = () => (!$a('#view-arena').classList.contains('hidden') && !$a('#arena-chat').classList.contains('hidden') ? chat.runId : null);

  // ---------------------------------------------------------------- help ("?")
  function openHelp() {
    const cast = setup.contenders.slice(0, 3).map((c, i) => [{ ...c, side: 'left' }, ['thinking', 'writing', 'reading'][i], `Contender ${i + 1}`, SLOT_COLORS[i]]);
    const internal = INTERNAL();
    cast.push([internal.synthesizer, 'writing', 'Synthesizer', internal.synthesizer.color], [internal.verifier, 'reading', 'Verifier', internal.verifier.color], [internal.supervisor, 'waiting', 'Supervisor', internal.supervisor.color]);
    $a('#arena-help-cast').innerHTML = cast.map(([r, st, name, color]) =>
      `<figure><span class="duo-robot" aria-hidden="true">${robotSvg(r, st)}</span><figcaption><b style="color:${color}">${name}</b> · ${st}</figcaption></figure>`).join('');
    $a('#arena-help').classList.remove('hidden');
    $a('#arena-help-close').focus({ preventScroll: true });
  }
  const closeHelp = () => { $a('#arena-help').classList.add('hidden'); $a('#arena-help-cast').innerHTML = ''; };

  function init() {
    if (!$a('#view-arena')) return;
    $a('#arena-help-open').onclick = openHelp;
    $a('#arena-help-open2').onclick = openHelp;
    $a('#arena-help-close').onclick = closeHelp;
    $a('#arena-help').addEventListener('click', (e) => { if (e.target.id === 'arena-help') closeHelp(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$a('#arena-help').classList.contains('hidden')) closeHelp(); });
    if (saved.task) $a('#arena-task').value = saved.task;
    $a('#arena-attach').onclick = () => $a('#arena-files').click();
    $a('#arena-files').onchange = async (e) => { await addFiles([...e.target.files]); e.target.value = ''; };
    // drop files anywhere on the request card
    const drop = $a('#view-arena .duo-brief');
    drop.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $a('#arena-drop').classList.add('drag'); } });
    drop.addEventListener('dragleave', (e) => { if (!drop.contains(e.relatedTarget)) $a('#arena-drop').classList.remove('drag'); });
    drop.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      $a('#arena-drop').classList.remove('drag');
      addFiles([...e.dataTransfer.files]);
    });
    renderAttachments();
    if (saved.peer) $a('#arena-peer').checked = saved.peer !== 'no';
    if (saved.lenses) $a('#arena-lenses').checked = saved.lenses === 'on';
    $a('#arena-scenario').innerHTML = Object.entries(SCENARIOS).map(([k, sc]) => `<option value="${k}"${k === saved.scenario ? ' selected' : ''}>${esc(sc.label)}</option>`).join('');
    const showScenario = () => $a('#arena-scenario-wrap').classList.toggle('hidden', !$a('#arena-mock').checked);
    $a('#arena-mock').addEventListener('change', showScenario);
    showScenario();
    loadProjects();
    loadSkills();
    // projects and skills created meanwhile show up when the screen is opened again
    document.querySelector('.nav-item[data-view="arena"]').addEventListener('click', () => { loadProjects(); loadSkills(); });
    renderSetup();
    const internal = INTERNAL();
    for (const k of ['synthesizer', 'verifier', 'supervisor']) $a(`[data-arena-robot="${k}"]`).innerHTML = robotSvg({ ...internal[k], side: 'left' });
    $a('#arena-run').onclick = startRun;
    $a('#arena-stop').onclick = () => api.stopRun(chat.runId);
    $a('#arena-logs').onclick = () => chat.runDir && api.openPath(chat.runDir);
    $a('#arena-back').onclick = () => {
      $a('#arena-chat').classList.add('hidden');
      $a('#arena-setup').classList.remove('hidden');
    };
    $a('#arena-edit-workflow').onclick = () => typeof showView === 'function' && showView('workflows');
    const openTab = (e) => { const t = e.target.closest('[data-tab]'); if (t) showDoc(t.dataset.tab); };
    $a('#arena-doc-tabs').addEventListener('click', openTab);
    $a('#arena-messages').addEventListener('click', (e) => {
      openTab(e);
      const b = e.target.closest('[data-approval]');
      if (b && chat.live) {
        const v = b.dataset.choice;
        const field = b.closest('.duo-ask')?.querySelector('textarea');
        const text = field?.value || '';
        // images pasted into the feedback (#130) go with it
        PasteImage.collect(field).then((images) => api.resolveApproval(b.dataset.approval, v === 'true' ? true : v === 'false' ? false : v, text, chat.runId, ...(images.length ? [null, images] : [])));
      }
    });
    api.onEvent(onEvent);
  }

  registerView({
    id: 'arena',
    nav: { label: 'AI Arena', order: 130, title: 'Up to five models write the same document, critique each other, and the best parts are merged',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>' },
    markup: `
      <section id="view-arena" class="view hidden">
        <!-- Setup -->
        <div id="arena-setup" class="duo-setup">
          <div class="page-head">
            <div>
              <h1>AI Arena <span class="duo-lab">lab</span> <button id="arena-help-open" class="duo-help-btn" type="button" title="How the AI Arena works" aria-label="How the AI Arena works">?</button></h1>
              <p class="muted small">Up to five models write the same document in parallel, blindly critique each other, and a synthesizer merges the best of each. Runs the <span class="mono">ai-arena</span> workflow; past runs are in Workflows › Runs.</p>
            </div>
            <button id="arena-edit-workflow" class="btn ghost sm" type="button" title="Open the workflow YAML">ai-arena.yaml</button>
          </div>

          <div class="duo-brief">
            <div class="field">
              <label for="arena-task">Request <span class="req">*</span></label>
              <textarea id="arena-task" rows="3" placeholder="What should the models write? E.g. a PRD for an appointment-booking app for small clinics.">Write a PRD for an appointment-booking app for small clinics: problem, users, scope, non-goals, rollout and success metrics.</textarea>
            </div>
            <div class="field ar-attach" id="arena-drop">
              <label>Reference documents <span class="muted">(optional)</span></label>
              <div class="row">
                <button id="arena-attach" class="btn sm" type="button" title="Attach text files: Markdown, plain text, JSON, YAML, CSV, HTML, code">
                  <svg class="icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
                  Attach files
                </button>
                <input id="arena-files" type="file" multiple hidden accept=".md,.markdown,.txt,.json,.yaml,.yml,.csv,.tsv,.html,.htm,.xml,.rst,.adoc,.log,.sql,.js,.ts,.py,.go,.java,.cs,text/*" />
                <div id="arena-attachments" class="ar-chips"></div>
                <span id="arena-attach-hint" class="muted small">or drop files here. Every model reads them (e.g. an existing PRD to improve, research notes, a spec).</span>
              </div>
            </div>
            <div class="field duo-project">
              <label for="arena-project">Project <span class="muted">(optional)</span></label>
              <div class="row">
                <select id="arena-project"></select>
                <span id="arena-project-hint" class="muted small">The models read its files (read-only) and a copy of the final document is saved in it.</span>
              </div>
            </div>
            <div class="duo-rules ar-rules">
              <label title="The skill that defines the document's structure and scoring rubric">Document <select id="arena-skill"></select></label>
              <label class="duo-switch" title="Each model scores the other proposals (anonymized) before the synthesis: better quality, higher cost"><input id="arena-peer" type="checkbox" checked /> <span>Blind peer review</span></label>
              <label class="duo-switch" title="Each model writes under a different forced lens (user value, lean MVP, risk first, feasibility, evidence) for more divergent proposals"><input id="arena-lenses" type="checkbox" /> <span>Different lenses</span></label>
            </div>
          </div>

          <div class="ar-section-head">
            <h2>Contenders <span id="arena-count" class="muted small"></span></h2>
            <span class="muted small">Pick 2 to 5 models. Mixing families (Claude, GPT, Grok) gives more distinct proposals.</span>
          </div>
          <div id="arena-contenders" class="ar-contenders"></div>

          <div class="ar-internal">
            <div class="duo-agent ar-internal-card" style="--role: var(--ar-synth)">
              <div class="duo-agent-head">
                <span class="duo-robot md" data-arena-robot="synthesizer"></span>
                <div><b>Synthesizer</b><div class="muted small">Did not compete. Picks the best proposal as the base and grafts the best ideas of the others.</div></div>
              </div>
            </div>
            <div class="duo-agent ar-internal-card" style="--role: var(--ar-verify)">
              <div class="duo-agent-head">
                <span class="duo-robot md" data-arena-robot="verifier"></span>
                <div><b>Verifier</b><div class="muted small">Another model family checks the final document; one round of fixes at most.</div></div>
              </div>
            </div>
            <div class="duo-agent ar-internal-card" style="--role: var(--supervisor)">
              <div class="duo-agent-head">
                <span class="duo-robot md" data-arena-robot="supervisor"></span>
                <div><b>Supervisor</b><div class="muted small">Steps in when a turn fails and asks you to accept, redo or discard the final document.</div></div>
              </div>
            </div>
          </div>

          <div class="duo-actions">
            <span id="arena-error" class="error duo-error"></span>
            <label class="duo-switch dev-only" id="arena-scenario-wrap" title="What the simulated agents do">Scenario <select id="arena-scenario"></select></label>
            <label class="duo-switch dev-only" title="Simulated agents: no CLI is called and nothing is spent"><input id="arena-mock" type="checkbox" /> <span>Simulation (no model calls)</span></label>
            <button id="arena-run" class="btn primary btn-icon" type="button">
              <svg class="icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>
              Run
            </button>
          </div>
        </div>

        <!-- Conversation -->
        <div id="arena-chat" class="duo-chat hidden">
          <div class="duo-chat-main">
            <header class="duo-chat-head">
              <button id="arena-back" class="icon-btn" type="button" title="Back to setup"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6" /></svg></button>
              <div id="arena-cast" class="duo-pair ar-cast"></div>
              <div class="duo-chat-title">
                <b id="arena-chat-title">AI Arena</b>
                <div id="arena-chat-status" class="muted small">starting…</div>
              </div>
              <div class="spacer"></div>
              <div id="arena-phases" class="ar-phases"></div>
              <button id="arena-help-open2" class="duo-help-btn sm" type="button" title="How the AI Arena works" aria-label="How the AI Arena works">?</button>
              <button id="arena-logs" class="btn ghost sm" type="button" title="Open the run folder (events, proposals, final document)">Run folder</button>
              <button id="arena-stop" class="btn danger sm hidden" type="button">Stop</button>
            </header>
            <div id="arena-messages" class="duo-messages"></div>
          </div>

          <aside class="duo-side">
            <section class="duo-doc">
              <div class="duo-side-head"><h2>Documents</h2></div>
              <div id="arena-doc-tabs" class="ar-doc-tabs"></div>
              <article id="arena-doc-body" class="duo-doc-body md md-compact">No proposal yet.</article>
            </section>
            <section class="ar-board-panel">
              <div class="duo-side-head"><h2>Peer scores</h2><span class="muted small">average, 0–10</span></div>
              <div id="arena-board" class="ar-board"></div>
            </section>
            <section class="duo-super-panel">
              <div class="duo-side-head">
                <h2>Supervisor</h2>
                <span id="arena-super-state" class="pill pill-running">watching</span>
              </div>
              <ul id="arena-checks" class="duo-checks"></ul>
              <div class="muted small">Interventions <b id="arena-interventions" class="mono">0/6</b></div>
            </section>
          </aside>
        </div>
      </section>`,
    modals: `
  <div id="arena-help" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="arena-help-title">
    <div class="modal-card duo-help-card">
      <div class="duo-help-head">
        <h3 id="arena-help-title">How the AI Arena works</h3>
        <button id="arena-help-close" class="icon-btn" type="button" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </div>
      <div class="duo-help-body">
        <p class="duo-help-lead">Up to five models get the same request and write their own version of the document, without seeing each other's work. They then score each other's proposals blindly, a <b class="c-synth">synthesizer</b> merges the best of each into one document, a <b class="c-verify">verifier</b> checks it, and the <b class="c-supervisor">supervisor</b> asks you what to do with it.</p>
        <div class="duo-help-cast" id="arena-help-cast"></div>

        <h4>1. Set up a run</h4>
        <ul>
          <li><b>Request</b>: what to write (a PRD, an ADR, a tech spec…).</li>
          <li><b>Project</b> (optional): the models read its files (<b>read-only</b>) to ground their proposals; the final document stays in the run folder (workspace), not in the project. Without a project they work from the request only.</li>
          <li><b>Reference documents</b> (optional): text files (Markdown, plain text, JSON, YAML, CSV…) that every model reads, e.g. an existing PRD to improve, research notes or a spec. Attach them with the button or drop them on the card; up to 200 KB each, 400 KB in total. PDF and Word files must be exported to text first. They show up in the chat and in the <b>Documents</b> panel.</li>
          <li><b>Document</b>: the type of document, i.e. the skill with its structure and scoring rubric: <b>PRD</b>, <b>Design doc</b>, <b>RFC</b>, <b>ADR</b>, <b>Test plan</b> or <b>Design sketch</b>. Your own skills named <span class="mono">*-writing</span> show up too.</li>
          <li><b>Blind peer review</b>: each model scores the others' proposals, anonymized as "Proposal 1, 2…", before the synthesis. Better quality, more turns.</li>
          <li><b>Different lenses</b>: each contender writes with a forced emphasis (user value, lean MVP, risk first, feasibility, evidence), so the proposals diverge more.</li>
          <li><b>Contenders</b>: 2 to 5 models. Pick the CLI (Claude Code, Codex, Grok), the model and the effort of each. The synthesizer, the verifier and the supervisor are fixed.</li>
        </ul>

        <h4>2. The flow</h4>
        <div class="duo-help-flow">
          <span>Compete</span><i>→</i><span>Critique</span><i>→</i><span class="c-synth">Synthesize</span><i>→</i><span class="c-verify">Verify</span><i>→</i><span class="c-you">You decide</span><i>→</i><span class="c-ok">Done</span>
        </div>
        <ul>
          <li>All contenders work <b>in parallel</b>; the run goes on if at least two deliver a proposal.</li>
          <li>The models never learn who wrote which proposal. <b>You</b> do: the chat and the <b>Peer scores</b> panel show the real author of each proposal.</li>
          <li>If the verifier finds issues, the synthesizer fixes them once, then the supervisor asks you.</li>
        </ul>

        <h4>3. Your decision</h4>
        <ul>
          <li><b>Accept</b> the document, <b>redo the synthesis</b> (twice at most) or <b>discard</b> it.</li>
          <li>When you redo it, you can type <b>instructions</b>, e.g. "Use Proposal 2 as the base". They go to the synthesizer and the verifier.</li>
          <li>Nothing crosses this question automatically: the run waits for you.</li>
        </ul>

        <h4>4. Where the results are</h4>
        <ul>
          <li>In the run folder: <b>arena/proposals/</b> (one per contender), <b>arena/reviews/</b> and <b>arena/final.md</b>. Click a proposal in the chat, or use the tabs of the <b>Documents</b> panel, to read it.</li>
          <li>Every run is in <b>Workflows › Runs</b>; <b>Open chat</b> replays it, or follows it while it runs.</li>
          <li>With <b>Settings › Execution › Developer mode</b>, <b>Simulation</b> runs the whole flow with simulated agents (no CLI calls, no cost).</li>
        </ul>
      </div>
    </div>
  </div>`,
    mount() {
      // the screen is a preview: a badge after its label
      document.querySelector('.nav-item[data-view="arena"]').insertAdjacentHTML('beforeend', '<span class="nav-badge">lab</span>');
      init();
    },
  });
})();
