// Backlog › Roadmap (#106): a project's ordered stages of runs (src/roadmap.js), each stage started
// when the previous one has finished and merged. Shows each stage's items (workflow, issues, state:
// planned / running / waiting at a gate / done / failed / skipped, a link to the run) and edits the
// plan: stages and items up/down or by drag, an issue dragged from one item to another, items
// removed, inputs and simulation edited, a stage renamed. Start (optionally simulated), Pause, Stop,
// Clear; Retry / Skip on a failed item. A Product Owner proposal (#105, JSON) is added or replaces
// the roadmap as planned; the plain queue's items can be moved in. Every edit saves the whole list
// of stages (api.saveRoadmap); the service keeps each item's runs by id.
// Rendered into #bl-list by backlog.js (mode 'roadmap'), which passes `ctx`
// ({ projectId, setData, render, setError, openRun }). Uses app.js globals (esc, state, errMsg, devMode, confirmDialog).
/* global api */
(() => {
  const STATE_LABEL = { planned: 'planned', running: 'running', paused: 'paused', done: 'done' };
  const ITEM_PILL = { planned: 'pending', running: 'running', done: 'success', failed: 'failed', skipped: 'cancelled' };
  const refs = (x) => (x.issues?.length ? x.issues : [x]);
  const editable = (x) => x.status === 'planned' || x.status === 'failed';
  const clone = (stages) => JSON.parse(JSON.stringify(stages || []));

  /** The badge of an issue card: its place in the roadmap ("Roadmap: stage 2"). */
  function badge(i) {
    if (!i.roadmap) return '';
    return `<span class="badge bl-roadmap" title="${esc(`${i.roadmap.name}: ${i.roadmap.status}`)}">Roadmap: stage ${i.roadmap.stage}${i.roadmap.status === 'planned' ? '' : ` · ${esc(i.roadmap.status)}`}</span>`;
  }

  function itemHtml(x, s, n) {
    const status = x.waiting ? 'waiting' : x.status;
    const locked = !editable(x);
    const inputs = Object.entries(x.inputs || {});
    const issues = refs(x).map((i) => `<span class="badge rm-issue"${locked ? '' : ` draggable="true" data-drag-issue="${i.number}" data-from="${esc(x.id)}"`} title="${esc(i.title || '')}">#${i.number}</span>`).join('');
    return `
      <div class="rm-item rm-${esc(status)}" data-item="${esc(x.id)}" data-stage="${s}"${locked ? '' : ' draggable="true" data-drag-item'}>
        <div class="rm-item-head">
          <span class="pill pill-${ITEM_PILL[x.status] || 'pending'}">${esc(status)}</span>
          <b class="small">${esc(x.workflowName || x.workflow)}</b>
          ${x.mock ? '<span class="badge p-mock">simulated</span>' : ''}
          <span class="rm-issues">${issues}</span>
          ${x.runId ? `<button class="bl-run link-btn small" type="button" data-run="${esc(x.runId)}" data-workflow="${esc(x.workflowName || '')}" title="Open the run (Resume from step… is there)">run ${esc(x.runId)}</button>` : ''}
          <span class="spacer"></span>
          ${x.status === 'failed' ? '<button class="btn sm primary" type="button" data-rm-item="retry">Retry</button><button class="btn sm ghost" type="button" data-rm-item="skip">Skip</button>' : ''}
          ${locked ? '' : `<button class="btn sm ghost" type="button" data-rm-move="up" title="Earlier in the stage (or into the previous stage)"${n === 0 && s === 0 ? ' disabled' : ''}>↑</button>
          <button class="btn sm ghost" type="button" data-rm-move="down" title="Later in the stage (or into the next stage)">↓</button>
          <button class="link-btn small" type="button" data-rm-remove title="Take this item out of the roadmap">remove</button>`}
        </div>
        ${x.error ? `<div class="small ${x.status === 'failed' ? 'error' : 'muted'}">${esc(x.error)}</div>` : ''}
        ${locked ? '' : `<details class="rm-edit"><summary class="small muted">Inputs${inputs.length ? `: ${esc(inputs.map(([k, v]) => `${k}=${v}`).join(', '))}` : ''}</summary>
          ${inputs.map(([k, v]) => `<label class="small">${esc(k)} <input type="text" data-rm-input="${esc(k)}" value="${esc(v)}" /></label>`).join('')}
          <label class="small">add input <input type="text" data-rm-newinput placeholder="name=value" /></label>
          <label class="check small dev-only"><input type="checkbox" data-rm-mock${x.mock ? ' checked' : ''} /><span>Simulation</span></label>
        </details>`}
      </div>`;
  }

  function stageHtml(stage, s, count, current) {
    const done = stage.items.every((x) => x.status === 'done' || x.status === 'skipped');
    return `
      <section class="rm-stage${s === current ? ' current' : ''}${done ? ' finished' : ''}" data-stage="${s}" data-drop-stage="${s}">
        <div class="rm-stage-head">
          <span class="muted small">Stage ${s + 1}</span>
          <input type="text" class="rm-name" data-rm-name value="${esc(stage.name)}" placeholder="Name (optional)" aria-label="Stage name" />
          ${s === current ? '<span class="badge live">current</span>' : done ? '<span class="badge">done</span>' : ''}
          <span class="spacer"></span>
          <button class="btn sm ghost" type="button" data-rm-stage="up" title="Run this stage earlier"${s === 0 ? ' disabled' : ''}>↑</button>
          <button class="btn sm ghost" type="button" data-rm-stage="down" title="Run this stage later"${s === count - 1 ? ' disabled' : ''}>↓</button>
        </div>
        <input type="text" class="rm-note small" data-rm-note value="${esc(stage.note || '')}" placeholder="Why this order (optional)" aria-label="Stage note" />
        <div class="rm-items">${stage.items.map((x, n) => itemHtml(x, s, n)).join('')}</div>
      </section>`;
  }

  /** The Roadmap view (into #bl-list): its bar, the plain queue's items, the stages in order. */
  function html(data) {
    const r = data?.roadmap || { state: 'planned', stages: [] };
    const q = data?.queue?.items || [];
    const current = r.stages.findIndex((s) => s.items.some((x) => x.status !== 'done' && x.status !== 'skipped'));
    const stateBadge = `<span class="badge ${r.state === 'running' ? 'live' : r.state === 'paused' ? 'warn' : ''}">${esc(STATE_LABEL[r.state] || r.state)}${r.simulated ? ' · simulated' : ''}</span>`;
    const bar = `
      <div class="bl-queue rm-bar">
        <span><b>Roadmap</b> ${stateBadge} ${r.stages.length} stage${r.stages.length === 1 ? '' : 's'}</span>
        ${r.error ? `<span class="${r.state === 'paused' ? 'warn-text' : 'error'} small">${esc(r.error)}</span>` : ''}
        <span class="spacer"></span>
        ${r.state !== 'running' && r.stages.length ? `<label class="check small dev-only"><input type="checkbox" id="rm-simulate"${state.simulationOnly || r.simulated ? ' checked' : ''} /><span>Simulated</span></label>
          <button class="btn sm primary" type="button" data-rm="start">${r.state === 'paused' ? 'Resume' : 'Start'}</button>` : ''}
        ${r.state === 'running' ? '<button class="btn sm ghost" type="button" data-rm="pause" title="Nothing new starts; runs in progress go on">Pause</button>' : ''}
        ${r.state === 'running' || r.state === 'paused' ? '<button class="btn sm ghost" type="button" data-rm="stop" title="Back to a plan: nothing starts until Start">Stop</button>' : ''}
        ${r.stages.length ? '<button class="btn sm ghost" type="button" data-rm="clear">Clear</button>' : ''}
      </div>`;
    const queued = q.length ? `
      <div class="bl-queue rm-queued small"><span>${q.length} run${q.length === 1 ? '' : 's'} in the plain queue (${esc(q.flatMap((x) => refs(x)).map((i) => `#${i.number}`).join(', '))}): they start whenever a slot is free, not in order.</span>
        <span class="spacer"></span><button class="btn sm ghost" type="button" data-rm="from-queue">Move into the roadmap</button></div>` : '';
    const importBox = `
      <details class="rm-import"><summary class="small muted">Product Owner proposal…</summary>
        <p class="small muted">Paste the Product Owner's "Build a roadmap" answer (JSON: { "stages": [{ "name", "note", "items": [{ "workflow", "issues": [12, 13], "inputs", "mock" }] }] }). It arrives as planned and never starts until Start.</p>
        <textarea id="rm-proposal" rows="5" class="mono small" spellcheck="false"></textarea>
        <div class="modal-actions"><button class="btn sm ghost" type="button" data-rm="replace">Replace the roadmap</button><button class="btn sm primary" type="button" data-rm="propose">Add to roadmap</button></div>
      </details>`;
    const stages = r.stages.length
      ? r.stages.map((s, n) => stageHtml(s, n, r.stages.length, current)).join('')
      : '<div class="empty-state"><b>No roadmap yet</b><p class="muted">Select issues, Assign workflow…, then Add to roadmap: each addition is a stage that starts when the previous one has finished and merged.</p></div>';
    return `<div class="rm">${bar}${queued}${stages}${importBox}</div>`;
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

  // Moves issue `number` from item `fromId` into item `toId` (a group while it has two or more).
  function moveIssue(stages, number, fromId, toId) {
    const items = stages.flatMap((s) => s.items);
    const from = items.find((x) => x.id === fromId);
    const to = items.find((x) => x.id === toId);
    if (!from || !to || from === to || !editable(to)) return false;
    const issue = refs(from).find((i) => i.number === number);
    if (!issue) return false;
    from.issues = refs(from).filter((i) => i.number !== number);
    to.issues = [...refs(to), issue];
    for (const s of stages) s.items = s.items.filter((x) => x.issues.length);
    return true;
  }

  async function save(ctx, stages) {
    try { ctx.setData(await api.saveRoadmap(ctx.projectId, stages)); } catch (e) { ctx.setError(errMsg(e)); }
    ctx.render();
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
        const real = !simulated && r.stages.some((s) => s.items.some((x) => !x.mock && editable(x)));
        if (real && !await confirmDialog('Start the roadmap', 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you.', 'Start')) return true;
        ctx.setData(await api.startRoadmap(ctx.projectId, simulated));
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
        ctx.setData(await api.roadmapItem(ctx.projectId, box.dataset.item, e.target.closest('[data-rm-item]').dataset.rmItem));
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
      ctx.setError(errMsg(err));
    }
    ctx.render();
    return true;
  }

  // Text fields and checkboxes: saved when they change.
  async function onChange(e, ctx, data) {
    const r = data?.roadmap;
    const el = e.target;
    if (!r || !el.closest('.rm-stage')) return false;
    const stages = clone(r.stages);
    const { s, n } = locate(stages, el);
    if (el.matches('[data-rm-name]')) stages[s].name = el.value;
    else if (el.matches('[data-rm-note]')) stages[s].note = el.value;
    else if (n < 0) return false;
    else if (el.matches('[data-rm-mock]')) stages[s].items[n].mock = el.checked;
    else if (el.matches('[data-rm-input]')) {
      const inputs = { ...stages[s].items[n].inputs };
      if (el.value.trim() === '') delete inputs[el.dataset.rmInput]; else inputs[el.dataset.rmInput] = el.value.trim();
      stages[s].items[n].inputs = inputs;
    } else if (el.matches('[data-rm-newinput]')) {
      const m = el.value.match(/^\s*([\w.-]+)\s*=(.*)$/);
      if (!m) { ctx.setError('Write a new input as name=value.'); ctx.render(); return true; }
      stages[s].items[n].inputs = { ...stages[s].items[n].inputs, [m[1]]: m[2].trim() };
    } else return false;
    await save(ctx, stages);
    return true;
  }

  // Drag: an item onto another stage (or item: before it), an issue onto another item.
  let dragging = null;
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
  function onDragOver(e) {
    if (dragging && e.target.closest('[data-drop-stage]')) e.preventDefault();
  }
  async function onDrop(e, ctx, data) {
    const d = dragging;
    dragging = null;
    const r = data?.roadmap;
    const stageEl = e.target.closest('[data-drop-stage]');
    if (!d || !r || !stageEl) return;
    e.preventDefault();
    const stages = clone(r.stages);
    const targetItem = e.target.closest('[data-item]')?.dataset.item;
    if (d.issue) {
      if (!targetItem || !moveIssue(stages, d.issue, d.from, targetItem)) return;
    } else {
      const s = stages.findIndex((st) => st.items.some((x) => x.id === d.item));
      if (s < 0 || targetItem === d.item) return;
      const [item] = stages[s].items.splice(stages[s].items.findIndex((x) => x.id === d.item), 1);
      const t = Number(stageEl.dataset.dropStage);
      const at = targetItem ? stages[t].items.findIndex((x) => x.id === targetItem) : -1;
      stages[t].items.splice(at < 0 ? stages[t].items.length : at, 0, item);
    }
    await save(ctx, stages);
  }

  /** A new stage at the end with the assign dialog's issues: one item (group) or one per issue. */
  async function addStage(ctx, data, { issues, workflow, workflowName, inputs, mock, group }) {
    const stages = clone(data?.roadmap?.stages);
    const items = group ? [{ workflow, workflowName, inputs, mock, issues }] : issues.map((n) => ({ workflow, workflowName, inputs, mock, issues: [n] }));
    stages.push({ name: '', note: '', items });
    ctx.setData(await api.saveRoadmap(ctx.projectId, stages));
  }

  window.BacklogRoadmap = { addStage, badge, html, onChange, onClick, onDragOver, onDragStart, onDrop };
})();
