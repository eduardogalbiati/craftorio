// AI Arena: runs the ai-arena workflow with up to five user-picked models and shows it as a chat
// between the contenders, the synthesizer, the verifier and the platform's supervisor. Like Write &
// Review (duo.js), the chat is rebuilt from the run's events, live (run:event) or from a past run's
// events.jsonl (Workflows › Runs › "Open chat"). Styles: duo.css + arena.css.
// load: after duo.js robots.js (window.ChatModels as it loads, window.Robots in its init)
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
      const { runId } = await api.startRun({ file: FILE, inputs, mock, mockSequences: mock ? SCENARIOS[scenario]?.seq : null });
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
    if (chat.live) document.querySelector(`#arena-messages [data-gate="${ev.approval_id}"] textarea`)?.focus();
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
    $a('#arena-help-close').focus();
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
        const text = b.closest('.duo-ask')?.querySelector('textarea')?.value || '';
        api.resolveApproval(b.dataset.approval, v === 'true' ? true : v === 'false' ? false : v, text, chat.runId);
      }
    });
    api.onEvent(onEvent);
  }

  init();
})();
