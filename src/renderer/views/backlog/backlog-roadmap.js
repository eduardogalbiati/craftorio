// Backlog › Roadmap (#106): a project's ordered stages of runs (src/roadmap.js), each stage started
// when the previous one has finished and merged. Each item leads with its issues' titles (a list,
// one line per issue, linked; #110), then badges: its state (planned / running / waiting at a gate /
// done / failed / skipped), the workflow's short name, the mode (a one-click toggle on planned and
// failed items, saved at once), the complexity total of its `complexity:n` labels, a link to the
// run; and the Product Owner's reason (#105) under the titles. The other inputs are edited in an
// Edit form built from the workflow's input definitions (api.listWorkflows, loaded once) by
// WorkflowInputs (workflow-inputs.js, #116: human labels, pills, switches, show_if), with Save / Cancel. The plan is edited too:
// stages and items up/down or by drag, an issue dragged from one item to another, items removed, a
// stage renamed or given a note ("add note"). Start (optionally simulated), Pause, Stop, Clear;
// Retry / Skip on a failed item; Run this stage on a stage's head (#141: only its items, then the
// roadmap pauses; out of order after a confirmation). A Product Owner proposal (#105, JSON) is added or replaces the
// roadmap as planned; the plain queue's items can be moved in. Every edit saves the whole list of
// stages (api.saveRoadmap); the service keeps each item's runs by id.
// "Group by epic" (#138, shown when the backlog has epics) lists the items under their issues' epics,
// each with its stage and the epic's items done.
// Live roadmap (#164): a box under the last stage with its switch (on only while running: turning it
// on otherwise asks to start the roadmap) and the last refill; `liveBanner` is the banner backlog.js
// shows on top of every view while it is on.
// Rendered into #bl-list by backlog.js (mode 'roadmap'), which passes `ctx`
// ({ projectId, setData, render, setError }). Uses app.js globals (esc, state, errMsg, devMode, confirmDialog).
/* global api */
(() => {
  const STATE_LABEL = { planned: 'planned', running: 'running', paused: 'paused', done: 'done' };
  // an item's state: [pill colour, label]
  const ITEM_STATE = {
    planned: ['idle', 'planned'],
    running: ['running', 'running'],
    waiting: ['cancelled', 'waiting at a gate'],
    done: ['success', 'done'],
    failed: ['failed', 'failed'],
    skipped: ['interrupted', 'skipped'],
  };
  const ICON = {
    validated: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
  };
  const COMPLEXITY = /^complexity\s*[:=/-]?\s*(\d+)/i;
  // an item's issues: its `issues` list, or (an item stored before #163) the item itself as one issue
  const refs = (x) => (x.issues?.length ? x.issues : x.number ? [{ number: x.number, url: x.url, title: x.title, body: x.body, knownPullRequests: x.knownPullRequests }] : []);
  const editable = (x) => x.status === 'planned' || x.status === 'failed';
  const clone = (stages) => JSON.parse(JSON.stringify(stages || []));
  // inputs the Backlog fills itself when the run starts (as backlog.js's skipInput): never edited here
  const skipInput = (k, def) => k === 'task' || k === 'issue' || k === 'issues' || def.type === 'run' || ((def.type || 'string') === 'string' && /path|dir/i.test(k));

  // The workflows' input definitions (file → workflow), loaded once when the Roadmap is first drawn.
  let workflows = null;
  let loading = false;
  function loadWorkflows(rerender) {
    if (workflows || loading) return;
    loading = true;
    api.listWorkflows()
      .then((list) => { workflows = new Map((list || []).filter((w) => !w.error).map((w) => [w.file, w])); rerender?.(); })
      .catch(() => { workflows = new Map(); })
      .finally(() => { loading = false; });
  }
  const inputDefs = (x) => workflows?.get(x.workflow)?.inputs || {};
  let editing = null; // the item whose Edit form is open
  let adding = false; // its "add input" name + value pair is shown
  let noteEditing = null; // the stage whose note is being edited
  // #138: the items grouped by their issues' epics instead of by stage (remembered)
  const BY_EPIC_KEY = 'multiagent.roadmapByEpic';
  let byEpic = (() => { try { return localStorage.getItem(BY_EPIC_KEY) === '1'; } catch { return false; } })();

  /** The badge of an issue card: its place in the roadmap ("Roadmap: stage 2"). */
  function badge(i) {
    if (!i.roadmap) return '';
    return `<span class="badge bl-roadmap" title="${esc(`${i.roadmap.name}: ${i.roadmap.status}`)}">Roadmap: stage ${i.roadmap.stage}${i.roadmap.status === 'planned' ? '' : ` · ${esc(i.roadmap.status)}`}</span>`;
  }

  /** A workflow's short name for its badge ("local hero", "software dev"); the file is in the tooltip. */
  function shortWorkflow(file) {
    const base = String(file || '').replace(/\.ya?ml$/i, '');
    if (base === 'software-development') return 'software dev';
    return base.replace(/^software-development-/, '').replace(/[-_]+/g, ' ');
  }

  /** The sum of the item's issues' `complexity:n` labels (null when none has one). */
  function complexity(x, byNumber) {
    const known = refs(x).map((i) => (byNumber.get(i.number)?.labels || [])
      .map((l) => String(l?.name ?? l).match(COMPLEXITY)).find(Boolean)).filter(Boolean).map((m) => Number(m[1]));
    return known.length ? known.reduce((a, c) => a + c, 0) : null;
  }

  // The mode: a toggle with the workflow's enum values on an editable item, a badge otherwise.
  function modeHtml(x, locked) {
    const def = inputDefs(x).mode;
    const values = Array.isArray(def?.enum) ? def.enum.map(String) : x.inputs?.mode != null ? [String(x.inputs.mode)] : [];
    if (!values.length) return '';
    const value = String(x.inputs?.mode ?? def?.default ?? values[0]);
    // the workflow's labels for its values (`options`, e.g. auto → Automatic; WorkflowInputs, #116)
    const label = (v) => `${ICON[v] || ''}${esc(WorkflowInputs.optionLabel(def || {}, v))}`;
    const help = def?.description ? `. ${def.description}` : '';
    if (locked || values.length < 2) return `<span class="badge rm-mode rm-mode-${esc(value)}" title="${esc(`Mode: ${WorkflowInputs.optionLabel(def || {}, value)}${help}`)}">${label(value)}</span>`;
    return `<span class="seg sm rm-mode-seg" role="group" aria-label="Mode" title="${esc(`Mode (saved at once)${help}`)}">${values.map((v) =>
      `<button type="button" class="rm-mode-${esc(v)}${v === value ? ' active' : ''}" data-rm-mode="${esc(v)}" aria-pressed="${v === value}">${label(v)}</button>`).join('')}</span>`;
  }

  // The Product Owner's reason for the group and for the mode (#105): one line, expandable.
  function reasonHtml(x) {
    if (!x.reason && !x.modeReason) return '';
    const head = x.reason ? `<span class="muted">Why:</span> ${esc(x.reason)}` : `<span class="muted">Mode:</span> ${esc(x.modeReason)}`;
    return `<details class="rm-reason small"><summary title="The Product Owner's reason (click for all of it)">${head}</summary>
      ${x.reason && x.modeReason ? `<p><span class="muted">Mode:</span> ${esc(x.modeReason)}</p>` : ''}</details>`;
  }

  // The Edit form: the workflow's inputs (but the mode, which has its toggle) drawn by WorkflowInputs
  // (#116: human labels, pills / switches, show_if against the item's mode); inputs the workflow
  // does not define (added with "add input") as text.
  function formHtml(x) {
    const defs = inputDefs(x);
    const fields = Object.fromEntries(Object.entries(defs).filter(([k, def]) => k !== 'mode' && !skipInput(k, def || {})));
    for (const k of Object.keys(x.inputs || {})) if (k !== 'mode' && !defs[k]) fields[k] = {};
    const mode = x.inputs?.mode ?? defs.mode?.default;
    const grid = Object.keys(fields).length
      ? WorkflowInputs.formHtml(fields, {
        values: x.inputs || {}, context: { mode }, autofocus: !adding,
        id: (k) => `rm-f-${x.id}-${k}`, attrs: (k) => `data-rm-field="${esc(k)}"`,
      })
      : '<p class="small muted">This workflow has no other inputs.</p>';
    const add = adding
      ? `<div class="field rm-add"><label>New input</label><div class="row"><input type="text" data-rm-newname placeholder="name" aria-label="New input name" autofocus /><input type="text" data-rm-newvalue placeholder="value" aria-label="New input value" /></div></div>`
      : '<button class="link-btn small" type="button" data-rm-addinput>+ add input</button>';
    return `
      <div class="rm-form" role="group" aria-label="Edit the inputs of this item"${WorkflowInputs.scopeAttrs({ mode })}>
        <div class="rm-form-grid wi-grid">${grid}</div>
        ${add}
        <div class="rm-form-actions">
          <label class="check small dev-only"><input type="checkbox" data-rm-field-mock${x.mock ? ' checked' : ''} /><span>Simulation</span></label>
          <span class="spacer"></span>
          <button class="btn sm ghost" type="button" data-rm-cancel>Cancel</button>
          <button class="btn sm primary" type="button" data-rm-save>Save</button>
        </div>
      </div>`;
  }

  function itemHtml(x, s, n, byNumber) {
    const status = x.waiting ? 'waiting' : x.status;
    const [pill, stateLabel] = ITEM_STATE[status] || ['idle', status];
    const locked = !editable(x);
    const open = !locked && editing === x.id;
    const defs = inputDefs(x);
    const others = Object.entries(x.inputs || {}).filter(([k]) => k !== 'mode');
    const size = complexity(x, byNumber);
    const titles = refs(x).map((i) => {
      const title = i.title && i.title !== `#${i.number}` ? i.title : '';
      const text = i.url ? `<a class="rm-title" href="${esc(i.url)}" target="_blank" rel="noopener" draggable="false">${esc(title || 'Open the issue')}</a>` : `<span class="rm-title">${esc(title)}</span>`;
      return `<li class="rm-issue"${locked || open ? '' : ` draggable="true" data-drag-issue="${i.number}" data-from="${esc(x.id)}"`} title="${esc(`#${i.number} ${title}`.trim())}"><span class="rm-num mono">#${i.number}</span>${text}</li>`;
    }).join('');
    return `
      <div class="rm-item rm-${esc(status)}" data-item="${esc(x.id)}" data-stage="${s}"${locked || open ? '' : ' draggable="true" data-drag-item'}>
        <div class="rm-item-head">
          <ul class="rm-titles">${titles}</ul>
          <div class="rm-actions">
            ${x.status === 'failed' ? '<button class="btn sm primary" type="button" data-rm-item="retry">Retry</button><button class="btn sm ghost" type="button" data-rm-item="skip">Skip</button>' : ''}
            ${locked ? '' : `<button class="btn sm ghost" type="button" data-rm-move="up" title="Earlier in the stage (or into the previous stage)"${n === 0 && s === 0 ? ' disabled' : ''}>↑</button>
            <button class="btn sm ghost" type="button" data-rm-move="down" title="Later in the stage (or into the next stage)">↓</button>
            <button class="link-btn small" type="button" data-rm-remove title="Take this item out of the roadmap">remove</button>`}
          </div>
        </div>
        <div class="rm-meta">
          <span class="pill pill-${pill} rm-state">${esc(stateLabel)}</span>
          <span class="badge rm-wf" title="${esc(x.workflowName && x.workflowName !== x.workflow ? `${x.workflowName} (${x.workflow})` : x.workflow)}">${esc(shortWorkflow(x.workflow))}</span>
          ${modeHtml(x, locked)}
          ${size != null ? `<span class="badge rm-size" title="The sum of the issues' complexity:n labels">complexity ${size}</span>` : ''}
          ${x.mock ? '<span class="badge p-mock">simulated</span>' : ''}
          ${others.map(([k, v]) => `<span class="badge rm-input" title="${esc(defs[k]?.description || k)}">${esc(k)}: ${esc(v)}</span>`).join('')}
          ${x.runId ? `<button class="bl-run link-btn small" type="button" data-run="${esc(x.runId)}" data-workflow="${esc(x.workflowName || '')}" title="Open the run (Resume from step… is there)">run ${esc(x.runId)}</button>` : ''}
          ${locked || open ? '' : '<button class="link-btn small" type="button" data-rm-edit title="Edit this item\'s inputs">Edit</button>'}
        </div>
        ${reasonHtml(x)}
        ${x.error ? `<div class="small ${x.status === 'failed' ? 'error' : 'muted'}">${esc(x.error)}</div>` : ''}
        ${open ? formHtml(x) : ''}
      </div>`;
  }

  // "Stages 1–2", "Stages 1, 3", "Stage 2" (0-based indexes in)
  function stagesText(list) {
    const n = list.map((s) => s + 1);
    if (n.length === 1) return `Stage ${n[0]}`;
    return `Stages ${n.every((x, k) => !k || x === n[k - 1] + 1) ? `${n[0]}–${n[n.length - 1]}` : n.join(', ')}`;
  }

  // `scoped`: the index of the stage run on its own (#141), -1 when none; `r`: the roadmap.
  function stageHtml(stage, s, count, current, byNumber, scoped, r) {
    const done = stage.items.every((x) => x.status === 'done' || x.status === 'skipped');
    const noteOpen = noteEditing != null && noteEditing === stage.id;
    const note = noteOpen
      ? `<input type="text" class="rm-note small" data-rm-note value="${esc(stage.note || '')}" placeholder="Why this order" aria-label="Stage note" autofocus />`
      : stage.note ? `<p class="rm-note-text small muted">${esc(stage.note)} <button class="link-btn small" type="button" data-rm-addnote>edit</button></p>` : '';
    const runnable = r.state !== 'running' && stage.items.some((x) => x.status === 'planned');
    const runTitle = r.state === 'running' ? 'The roadmap is running: pause or stop it first' : runnable ? 'Run only this stage\'s items; the roadmap pauses when they are done' : 'No planned item in this stage';
    const stateBadge = s === scoped ? `<span class="badge ${r.state === 'running' ? 'live' : 'warn'}">${r.state === 'running' ? 'Running this stage only' : 'This stage only · paused'}</span>`
      : s === current ? '<span class="badge live">current</span>' : done ? '<span class="badge">done</span>' : '';
    return `
      <section class="rm-stage${s === current ? ' current' : ''}${s === scoped ? ' scoped' : ''}${done ? ' finished' : ''}" data-stage="${s}" data-drop-stage="${s}">
        <div class="rm-stage-head">
          <span class="muted small">Stage ${s + 1}</span>
          <input type="text" class="rm-name" data-rm-name value="${esc(stage.name)}" placeholder="Name (optional)" aria-label="Stage name" />
          ${stateBadge}
          ${stage.note || noteOpen ? '' : '<button class="link-btn small" type="button" data-rm-addnote>add note</button>'}
          <span class="spacer"></span>
          <button class="btn sm ghost rm-run-stage" type="button" data-rm-run-stage title="${esc(runTitle)}"${runnable ? '' : ' disabled'}><span aria-hidden="true">▶</span> Run this stage</button>
          <button class="btn sm ghost" type="button" data-rm-stage="up" title="Run this stage earlier"${s === 0 ? ' disabled' : ''}>↑</button>
          <button class="btn sm ghost" type="button" data-rm-stage="down" title="Run this stage later"${s === count - 1 ? ' disabled' : ''}>↓</button>
        </div>
        ${note}
        <div class="rm-items">${stage.items.map((x, n) => itemHtml(x, s, n, byNumber)).join('')}</div>
      </section>`;
  }

  // ---- Live roadmap (#164, src/live-roadmap.js) ----------------------------------------------------
  const clock = (at) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // the last refill in a few words: [text, tone] (tone: '' | 'warn' | 'error')
  function refillText(r) {
    const f = r.liveRefill;
    if (!f) return [r.state === 'running' ? 'no refill yet: it comes when the last stage ends' : 'no refill yet', ''];
    if (f.status === 'refilling') return ['refilling now: the Product Owner is picking the next issues…', ''];
    if (f.status === 'added') return [`last refill ${clock(f.at)} (+${plural(f.added || 0, 'stage')})`, ''];
    if (f.status === 'budget') return ['daily budget reached: no more refills', 'warn'];
    if (f.status === 'failed') return [`the last refill failed (${clock(f.at)})`, 'error'];
    return [String(f.message || '').replace(/^Live roadmap: /, ''), ''];
  }

  /** The banner at the top of the Backlog (every view) while the roadmap is live; '' when it is not. */
  function liveBanner(r) {
    if (!r?.live) return '';
    const [text, tone] = refillText(r);
    const idle = r.state !== 'running';
    return `<span class="bl-live-dot${idle ? ' idle' : ''}" aria-hidden="true"></span>
      <span class="bl-live-text"><b>Live roadmap</b>: refills itself from the backlog · <span class="${tone ? `${tone}-text` : ''}" title="${esc(r.liveRefill?.message || '')}">${esc(text)}</span>${idle ? ` · <span class="muted">roadmap ${esc(STATE_LABEL[r.state] || r.state)}</span>` : ''}</span>
      <span class="spacer"></span>
      <button class="btn sm ghost" type="button" data-live-off title="The current stages finish; nothing more is added">Turn off</button>`;
  }

  // The box under the last stage: the switch, what it does, and its state.
  function liveBox(r) {
    const [text, tone] = refillText(r);
    const since = r.live && r.liveSince ? ` · on since ${clock(r.liveSince)}${r.liveBy ? ` by ${esc(r.liveBy)}` : ''}` : '';
    const hint = r.live ? `${esc(text)}${since}` : r.state === 'running' ? 'Off: the roadmap ends with its last stage.' : 'Off. Turning it on starts the roadmap first.';
    return `
      <div class="rm-live${r.live ? ' on' : ''}" role="group" aria-label="Live roadmap">
        <label class="switch" title="${r.live ? 'Turn off: the current stages finish, nothing more is added' : 'Turn on: the roadmap refills itself from the backlog'}"><input type="checkbox" role="switch" data-rm-live aria-label="Live roadmap"${r.live ? ' checked' : ''} /><span></span></label>
        <div class="rm-live-body">
          <div><b>Live roadmap</b>${r.live ? ' <span class="badge rm-live-badge">LIVE</span>' : ''}</div>
          <div class="small muted">When the last stage ends, the Product Owner adds the next issues from the backlog and the roadmap goes on.</div>
          <div class="small ${tone ? `${tone === 'error' ? 'error' : 'warn-text'}` : 'muted'} rm-live-state" title="${esc(r.liveRefill?.message || '')}">${hint}</div>
        </div>
      </div>`;
  }

  // The switch: on asks to start a roadmap that is not running (live works on a running roadmap)
  // and says what a real refill costs; off goes at once.
  async function setLive(ctx, r, on) {
    try {
      if (on) {
        const simulated = r.state === 'running' ? !!r.simulated || !!state.simulationOnly : !!document.querySelector('#rm-simulate')?.checked && devMode();
        const cost = simulated ? 'Simulated: the Product Owner answers without a model call.' : 'Each refill is a Product Owner answer and real runs: they cost money (Settings › Live roadmap caps the daily spend).';
        if (r.state !== 'running') {
          if (!await confirmDialog('Start the roadmap and go live', `Only a running roadmap can go live: start it now? When its last stage ends, the Product Owner adds the next issues from the backlog, again and again. ${cost} Human gates still wait for you.`, 'Start and go live')) return;
          ctx.setData(await api.startRoadmap(ctx.projectId, simulated, null));
        } else if (!simulated && !await confirmDialog('Go live', `When the last stage ends, the Product Owner adds the next issues from the backlog, again and again. ${cost} Human gates still wait for you.`, 'Go live')) return;
      }
      ctx.setData(await api.setRoadmapLive(ctx.projectId, on));
    } catch (err) {
      failed(ctx, 'live', err);
    } finally {
      ctx.render();
    }
  }

  /** The Roadmap view (into #bl-list): its bar, the plain queue's items, the stages in order. `rerender` redraws once the workflows are loaded. */
  function html(data, rerender) {
    loadWorkflows(rerender);
    const r = data?.roadmap || { state: 'planned', stages: [] };
    const q = data?.queue?.items || [];
    const byNumber = new Map((data?.issues || []).map((i) => [i.number, i]));
    // a stage run on its own (#141) is the one in progress; the others keep their planned look
    const scoped = r.scope ? r.stages.findIndex((s) => s.id === r.scope.stage) : -1;
    const current = scoped >= 0 ? scoped : r.stages.findIndex((s) => s.items.some((x) => x.status !== 'done' && x.status !== 'skipped'));
    const stateBadge = `<span class="badge ${r.state === 'running' ? 'live' : r.state === 'paused' ? 'warn' : ''}">${esc(STATE_LABEL[r.state] || r.state)}${scoped >= 0 ? ` · stage ${scoped + 1} only` : ''}${r.simulated ? ' · simulated' : ''}</span>`;
    const bar = `
      <div class="bl-queue rm-bar">
        <span><b>Roadmap</b> ${stateBadge} ${r.stages.length} stage${r.stages.length === 1 ? '' : 's'}</span>
        ${r.error ? `<span class="${r.state === 'paused' ? 'warn-text' : 'error'} small">${esc(r.error)}</span>` : ''}
        <span class="spacer"></span>
        ${r.state !== 'running' && r.stages.length ? `<label class="check small dev-only"><input type="checkbox" id="rm-simulate"${state.simulationOnly || r.simulated ? ' checked' : ''} /><span>Simulated</span></label>
          <button class="btn sm primary" type="button" data-rm="start"${scoped >= 0 && r.state === 'paused' ? ` title="Resume stage ${scoped + 1} only"` : ''}>${r.state === 'paused' ? 'Resume' : 'Start'}</button>` : ''}
        ${r.state === 'running' ? '<button class="btn sm ghost" type="button" data-rm="pause" title="Nothing new starts; runs in progress go on">Pause</button>' : ''}
        ${r.state === 'running' || r.state === 'paused' ? '<button class="btn sm ghost" type="button" data-rm="stop" title="Back to a plan: nothing starts until Start">Stop</button>' : ''}
        ${r.stages.length ? '<button class="btn sm ghost" type="button" data-rm="clear">Clear</button>' : ''}
      </div>`;
    const queued = q.length ? `
      <div class="bl-queue rm-queued small"><span>${q.length} run${q.length === 1 ? '' : 's'} in the plain queue (${esc(q.flatMap((x) => refs(x)).map((i) => `#${i.number}`).join(', '))}): they start whenever a slot is free, not in order.</span>
        <span class="spacer"></span><button class="btn sm ghost" type="button" data-rm="from-queue">Move into the roadmap</button></div>` : '';
    const importBox = `
      <details class="rm-import"><summary class="small muted">Product Owner proposal…</summary>
        <p class="small muted">Paste the Product Owner's "Build a roadmap" answer (JSON: { "stages": [{ "name", "note", "items": [{ "workflow", "issues": [12, 13], "inputs", "mock", "reason", "mode_reason" }] }] }). It arrives as planned and never starts until Start.</p>
        <textarea id="rm-proposal" rows="5" class="mono small" spellcheck="false"></textarea>
        <div class="modal-actions"><button class="btn sm ghost" type="button" data-rm="replace">Replace the roadmap</button><button class="btn sm primary" type="button" data-rm="propose">Add to roadmap</button></div>
      </details>`;
    const epics = data?.epics || [];
    const grouped = byEpic && epics.length > 0 && r.stages.length > 0;
    const toggle = epics.length && r.stages.length ? `<label class="check small rm-by-epic" title="Show the roadmap's items under their issues' epics (the stages keep their order)"><input type="checkbox" data-rm-by-epic${grouped ? ' checked' : ''} /><span>Group by epic</span></label>` : '';
    const stages = !r.stages.length
      ? '<div class="empty-state"><b>No roadmap yet</b><p class="muted">Select issues, Assign workflow…, then Add to roadmap: each addition is a stage that starts when the previous one has finished and merged.</p></div>'
      : grouped ? byEpicHtml(r, epics, byNumber)
        : r.stages.map((s, n) => stageHtml(s, n, r.stages.length, current, byNumber, scoped, r)).join('');
    const liveHtml = r.stages.length ? liveBox(r) : '';
    return `<div class="rm">${bar.replace('<span class="spacer"></span>', `<span class="spacer"></span>${toggle}`)}${queued}${stages}${liveHtml}${importBox}</div>`;
  }

  // #138: the items under their issues' epics (an item of issues in two epics shows under both; "No
  // epic" last), each with its stage; editing stays in the stage view.
  function byEpicHtml(r, epics, byNumber) {
    const sections = [...epics.map((e) => ({ id: e.id, title: e.title })), { id: '', title: 'No epic' }].map((e) => {
      const rows = [];
      r.stages.forEach((stage, s) => stage.items.forEach((x, n) => {
        const ids = new Set(refs(x).map((i) => byNumber.get(i.number)?.epic || ''));
        if (ids.has(e.id)) rows.push(itemHtml(x, s, n, byNumber).replace('<div class="rm-meta">', `<div class="rm-meta"><span class="badge" title="Its stage in the roadmap">stage ${s + 1}</span>`));
      }));
      if (!rows.length) return '';
      const items = r.stages.flatMap((st) => st.items).filter((x) => refs(x).some((i) => (byNumber.get(i.number)?.epic || '') === e.id));
      const done = items.filter((x) => x.status === 'done').length;
      return `<section class="rm-stage rm-epic">
          <div class="rm-stage-head"><b title="${esc(e.title)}">${esc(e.title)}</b>${e.id ? ` <span class="badge bl-epic" title="Epic ${esc(e.id)}">${esc(e.id)}</span>` : ''}
            <span class="spacer"></span><span class="muted small">${done} of ${items.length} item${items.length === 1 ? '' : 's'} done</span></div>
          <div class="rm-items">${rows.join('')}</div>
        </section>`;
    }).join('');
    return sections;
  }

  // ---- edits: a copy of the stages, changed, then saved whole ------------------------------
  function locate(stages, el) {
    const box = el.closest('[data-item]');
    const s = Number((box || el.closest('[data-stage]')).dataset.stage);
    const n = box ? stages[s].items.findIndex((x) => x.id === box.dataset.item) : -1;
    return { s, n };
  }

  function moveItem(stages, s, n, dir) {
    const [item] = stages[s].items.splice(n, 1);
    const to = n + dir;
    if (to >= 0 && to <= stages[s].items.length) { stages[s].items.splice(to, 0, item); return; }
    // past the stage's edge: into the previous/next stage (a new last stage when there is none)
    const t = s + dir;
    if (t < 0) { stages[s].items.unshift(item); return; }
    if (!stages[t]) stages.push({ name: '', note: '', items: [] });
    if (dir < 0) stages[t].items.push(item); else stages[t].items.unshift(item);
  }

  // Why issue `d.issue` of item `d.from` can't join item `toId` ('' when it can; #163).
  function dropProblem(stages, d, toId) {
    const items = (stages || []).flatMap((s) => s.items || []);
    const from = items.find((x) => x.id === d.from);
    const to = items.find((x) => x.id === toId);
    if (!from || !refs(from).some((i) => i.number === d.issue)) return `#${d.issue} is no longer in that item: the roadmap changed.`;
    if (!to) return 'Drop the issue on another item to run them together.';
    if (to === from) return `#${d.issue} is already in this item.`;
    if (!editable(to)) return `This item is ${to.waiting ? 'waiting at a gate' : to.status}: only planned or failed items take issues.`;
    return '';
  }

  // Moves issue `number` from item `fromId` into item `toId` (a group while it has two or more); the
  // emptied item goes. Items of either shape (an `issues` list, or a single issue stored as the item);
  // both keep their first issue's fields at the top for older readers.
  function moveIssue(stages, number, fromId, toId) {
    if (dropProblem(stages, { issue: number, from: fromId }, toId)) return false;
    const items = stages.flatMap((s) => s.items);
    const from = items.find((x) => x.id === fromId);
    const to = items.find((x) => x.id === toId);
    const issue = refs(from).find((i) => i.number === number);
    const left = refs(from).filter((i) => i.number !== number);
    setIssues(to, [...refs(to), issue]);
    if (left.length) setIssues(from, left);
    else for (const s of stages) s.items = s.items.filter((x) => x !== from);
    return true;
  }

  function setIssues(item, issues) {
    const { number, url, title, body, knownPullRequests } = issues[0];
    Object.assign(item, { number, url, title, body, knownPullRequests, issues });
  }

  /** The inputs of the Edit form `form` applied to `item` (its fields, the new name + value pair, Simulation). */
  function applyForm(item, form) {
    const inputs = { ...item.inputs };
    for (const el of form.querySelectorAll('[data-rm-field]')) {
      const k = el.dataset.rmField;
      // a switch: true/false for a boolean, "true"/"false" for an enum of those strings
      if (el.type === 'checkbox') inputs[k] = el.dataset.wiFlag === 'text' ? String(el.checked) : el.checked;
      else if (el.value.trim() === '') delete inputs[k];
      else inputs[k] = el.value.trim();
    }
    const name = form.querySelector('[data-rm-newname]')?.value.trim();
    if (name) {
      if (!/^[\w.-]+$/.test(name)) throw new Error('An input name has letters, digits, "_", "." or "-" only.');
      inputs[name] = form.querySelector('[data-rm-newvalue]')?.value.trim() || '';
    }
    item.inputs = inputs;
    const mock = form.querySelector('[data-rm-field-mock]');
    if (mock) item.mock = mock.checked;
  }

  // An edit's error: in the screen's error line and the console, never an unhandled rejection (#163).
  function failed(ctx, what, err) {
    console.error(`roadmap ${what}:`, err);
    ctx.setError(errMsg(err));
  }

  async function save(ctx, stages) {
    try { ctx.setData(await api.saveRoadmap(ctx.projectId, stages)); } catch (e) { failed(ctx, 'save', e); }
    ctx.render();
  }

  // Run this stage (#141): only stage `s`'s items start, with Start's simulated choice and real-run
  // confirmation; earlier stages not done ask first (the Product Owner's order is a recommendation).
  async function runStage(ctx, r, s) {
    const stage = r.stages[s];
    if (!stage) return;
    const earlier = r.stages.slice(0, s).map((x, n) => (x.items.some((i) => i.status !== 'done' && i.status !== 'skipped') ? n : -1)).filter((n) => n >= 0);
    if (earlier.length && !await confirmDialog(`Run stage ${s + 1} out of order`, `${stagesText(earlier)} ${earlier.length > 1 ? 'are' : 'is'} not done: ${earlier.length > 1 ? 'their' : 'its'} issues may conflict with this stage's. They stay planned.`, 'Run this stage')) return;
    const simulated = !!document.querySelector('#rm-simulate')?.checked && devMode();
    const real = !simulated && stage.items.some((x) => !x.mock && editable(x));
    if (real && !await confirmDialog(`Run stage ${s + 1}`, 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you. The roadmap pauses when this stage is done.', 'Run')) return;
    ctx.setData(await api.startRoadmap(ctx.projectId, simulated, stage.id));
  }

  // The owner's buttons; true when the click was the roadmap's.
  async function onClick(e, ctx, data) {
    const r = data?.roadmap;
    if (!r) return false;
    const act = e.target.closest('[data-rm]')?.dataset.rm;
    const stages = clone(r.stages);
    try {
      if (act === 'start') {
        const simulated = !!document.querySelector('#rm-simulate')?.checked && devMode();
        // Resume on a stage run on its own (#141) goes on with that stage only
        const scope = r.state === 'paused' && r.scope ? r.scope.stage : null;
        const real = !simulated && r.stages.some((s) => (!scope || s.id === scope) && s.items.some((x) => !x.mock && editable(x)));
        if (real && !await confirmDialog('Start the roadmap', 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you.', 'Start')) return true;
        ctx.setData(await api.startRoadmap(ctx.projectId, simulated, scope));
      } else if (e.target.closest('[data-rm-run-stage]')) {
        await runStage(ctx, r, locate(stages, e.target).s);
      } else if (act === 'pause' || act === 'stop') {
        ctx.setData(await api.pauseRoadmap(ctx.projectId, act === 'stop'));
      } else if (act === 'clear') {
        if (!await confirmDialog('Clear the roadmap', 'Every stage is removed. Runs in progress go on.', 'Clear')) return true;
        ctx.setData(await api.clearRoadmap(ctx.projectId));
      } else if (act === 'from-queue') {
        ctx.setData(await api.roadmapFromQueue(ctx.projectId));
      } else if (act === 'propose' || act === 'replace') {
        const text = document.querySelector('#rm-proposal')?.value.trim();
        if (!text) return true;
        let proposal;
        try { proposal = JSON.parse(text); } catch { throw new Error('The proposal is not valid JSON.'); }
        if (act === 'replace' && r.stages.length && !await confirmDialog('Replace the roadmap', 'The current stages are removed and the proposal takes their place, planned.', 'Replace')) return true;
        const out = await api.proposeRoadmap(ctx.projectId, proposal, act === 'replace');
        ctx.setData(out);
        if (out.dropped?.length) ctx.setError(`Already in the roadmap, left out of the proposal: ${out.dropped.map((n) => `#${n}`).join(', ')}`);
      } else if (e.target.closest('[data-rm-item]')) {
        const box = e.target.closest('[data-item]');
        const action = e.target.closest('[data-rm-item]').dataset.rmItem;
        let out = await api.roadmapItem(ctx.projectId, box.dataset.item, action);
        // a retry that would redo an ended run's kept work asks first (#112, #170): resume that run or start from scratch
        if (out?.kept) {
          if (await keptWorkDialog(out.kept) !== 'scratch') return true;
          out = await api.roadmapItem(ctx.projectId, box.dataset.item, action, true);
        }
        ctx.setData(out);
      } else if (e.target.closest('[data-rm-mode]')) {
        // the mode toggle: saved at once, on planned and failed items only
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        item.inputs = { ...item.inputs, mode: e.target.closest('[data-rm-mode]').dataset.rmMode };
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-edit]')) {
        editing = e.target.closest('[data-item]').dataset.item;
        adding = false;
      } else if (e.target.closest('[data-rm-cancel]')) {
        editing = null;
        adding = false;
      } else if (e.target.closest('[data-rm-addinput]')) {
        adding = true;
      } else if (e.target.closest('[data-rm-save]')) {
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        applyForm(item, e.target.closest('.rm-form'));
        editing = null;
        adding = false;
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-addnote]')) {
        noteEditing = r.stages[locate(stages, e.target).s]?.id ?? null;
      } else if (e.target.closest('[data-rm-stage]')) {
        const { s } = locate(stages, e.target);
        const t = s + (e.target.closest('[data-rm-stage]').dataset.rmStage === 'up' ? -1 : 1);
        if (!stages[t]) return true;
        [stages[s], stages[t]] = [stages[t], stages[s]];
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-move]')) {
        const { s, n } = locate(stages, e.target);
        moveItem(stages, s, n, e.target.closest('[data-rm-move]').dataset.rmMove === 'up' ? -1 : 1);
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-remove]')) {
        const { s, n } = locate(stages, e.target);
        stages[s].items.splice(n, 1);
        await save(ctx, stages);
        return true;
      } else {
        return false;
      }
    } catch (err) {
      failed(ctx, 'edit', err);
    }
    ctx.render();
    // the form or note just opened: its first control gets the focus
    document.querySelector('.rm [autofocus]')?.focus();
    return true;
  }

  // The stage's name and note: saved when they change (the Edit form saves with its Save button).
  async function onChange(e, ctx, data) {
    const r = data?.roadmap;
    const el = e.target;
    if (r && el.matches('[data-rm-live]')) {
      await setLive(ctx, r, el.checked);
      return true;
    }
    if (el.matches('[data-rm-by-epic]')) {
      byEpic = el.checked;
      try { localStorage.setItem(BY_EPIC_KEY, byEpic ? '1' : ''); } catch { /* storage unavailable */ }
      ctx.render();
      return true;
    }
    if (!r || !el.closest('.rm-stage')) return false;
    const name = el.matches('[data-rm-name]');
    if (!name && !el.matches('[data-rm-note]')) return false;
    try {
      const stages = clone(r.stages);
      const { s } = locate(stages, el);
      if (name) stages[s].name = el.value;
      else { stages[s].note = el.value; noteEditing = null; }
      await save(ctx, stages);
    } catch (err) {
      failed(ctx, 'edit', err);
      ctx.render();
    }
    return true;
  }

  // Drag: an item onto another stage (or item: before it), an issue onto another item. While
  // dragging, the target under the cursor is marked (#163): the item an issue joins, the line where
  // an item lands, or a refused item with its reason (`data-drop-why`).
  let dragging = null;
  let over = null; // { key, ok }: the target marked last
  let marked = [];
  function clearMarks() {
    for (const el of marked) { el.classList.remove('rm-drop-target', 'rm-drop-before', 'rm-drop-end', 'rm-drop-denied'); delete el.dataset.dropWhy; }
    marked = [];
    over = null;
  }
  function mark(el, cls, why) {
    el.classList.add(cls);
    if (why) el.dataset.dropWhy = why;
    marked.push(el);
  }
  function onDragStart(e) {
    const issue = e.target.closest('[data-drag-issue]');
    const item = e.target.closest('[data-drag-item]');
    if (issue) dragging = { issue: Number(issue.dataset.dragIssue), from: issue.dataset.from };
    else if (item) dragging = { item: item.dataset.item };
    else return;
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(dragging));
  }
  function onDragOver(e, data) {
    const stageEl = dragging ? e.target.closest('[data-drop-stage]') : null;
    if (!stageEl) { clearMarks(); return; }
    const itemEl = e.target.closest('[data-item]');
    const key = itemEl ? `item:${itemEl.dataset.item}` : `stage:${stageEl.dataset.dropStage}`;
    if (over?.key !== key) {
      clearMarks();
      let ok = true;
      if (dragging.issue) {
        const why = dropProblem(data?.roadmap?.stages, dragging, itemEl?.dataset.item);
        ok = !why;
        // its own item stays unmarked while the drag has just started there; once the cursor has
        // left it, coming back shows why it is refused ("already in this item")
        const home = itemEl?.dataset.item === dragging.from;
        if (!home) dragging.left = true;
        if (!home || dragging.left) mark(itemEl || stageEl, ok ? 'rm-drop-target' : 'rm-drop-denied', why);
      } else if (itemEl?.dataset.item === dragging.item) {
        ok = false;
      } else if (itemEl) {
        mark(itemEl, 'rm-drop-before');
      } else {
        mark(stageEl, 'rm-drop-end');
      }
      over = { key, ok };
    }
    if (over.ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  }
  // The drag ended (dropped or cancelled): the marks go.
  function onDragEnd() {
    dragging = null;
    clearMarks();
  }
  async function onDrop(e, ctx, data) {
    const d = dragging;
    onDragEnd();
    const r = data?.roadmap;
    const stageEl = e.target.closest('[data-drop-stage]');
    if (!d || !r || !stageEl) return;
    e.preventDefault();
    try {
      const stages = clone(r.stages);
      const targetItem = e.target.closest('[data-item]')?.dataset.item;
      if (d.issue) {
        const why = dropProblem(stages, d, targetItem);
        if (why) { ctx.setError(why); ctx.render(); return; }
        moveIssue(stages, d.issue, d.from, targetItem);
      } else {
        const s = stages.findIndex((st) => st.items.some((x) => x.id === d.item));
        if (s < 0 || targetItem === d.item) return;
        const [item] = stages[s].items.splice(stages[s].items.findIndex((x) => x.id === d.item), 1);
        const t = Number(stageEl.dataset.dropStage);
        const at = targetItem ? stages[t].items.findIndex((x) => x.id === targetItem) : -1;
        stages[t].items.splice(at < 0 ? stages[t].items.length : at, 0, item);
      }
      await save(ctx, stages);
    } catch (err) {
      failed(ctx, 'drop', err);
      ctx.render();
    }
  }

  /** A new stage at the end with the assign dialog's issues: one item (group) or one per issue; `reason`/`modeReason`/`origin`: the Product Owner's. */
  async function addStage(ctx, data, { issues, workflow, workflowName, inputs, mock, group, reason, modeReason, origin }) {
    const stages = clone(data?.roadmap?.stages);
    const why = { ...(reason ? { reason } : {}), ...(modeReason ? { modeReason } : {}), ...(origin ? { origin } : {}) };
    const items = group ? [{ workflow, workflowName, inputs, mock, issues, ...why }] : issues.map((n) => ({ workflow, workflowName, inputs, mock, issues: [n], ...why }));
    stages.push({ name: '', note: '', items });
    ctx.setData(await api.saveRoadmap(ctx.projectId, stages));
  }

  window.BacklogRoadmap = {
    addStage,
    badge,
    dropProblem,
    html,
    liveBanner,
    moveIssue,
    onChange,
    onClick,
    onDragEnd,
    onDragOver,
    onDragStart,
    onDrop,
  };
})();
