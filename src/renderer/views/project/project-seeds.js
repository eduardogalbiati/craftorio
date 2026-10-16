/* global api */
// The Seeds section of a project's Architecture tab (#360): one row per analysis seed (seeds:list)
// led by its name and status (Never run, Running with the Oracle's progress, Stale with the commits
// since its last run, Up to date, Tool available (runs free), or the last run's error), its last
// run's date and cost, and the actions Run (after the cost estimate; a real model cost asks first),
// Open result, History, Tool command (record the deterministic tool once it exists) and "Make it a
// tool" (seeds:makeTool: the Product Owner's issue, a preview in simulation). A result page is shown
// in a sandboxed frame (no script, no same-origin, no top navigation) whose srcdoc starts with a CSP
// that blocks the network. Mounted by project.js below the Architecture tab (#project-seeds); uses
// app.js globals (api, state, esc, errMsg, fmtUsd, showToast).

(function () {
  const RESULT_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';
  const POLL_MS = 3000;
  let cur = null; // { id, box, rows, error, running: Set, history: Map, notes: Map, editing, open, timer }

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const shortDate = (d) => {
    const iso = String(d || '').replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z.*$/, '$1T$2:$3:$4.$5Z');
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toLocaleString() : String(d || '');
  };
  // the page in standards mode with the CSP first (the page's own doctype dropped: one after content is ignored)
  const framed = (html) => `<!doctype html>${RESULT_CSP}${String(html).replace(/^\s*<!doctype[^>]*>/i, '')}`;
  const costText =(r) => (r.simulated ? 'simulated' : r.source === 'tool' || r.costUsd === 0 ? 'free' : r.costUsd == null ? 'cost unknown' : fmtUsd(r.costUsd));

  // the row's status: [text, badge class]
  function statusOf(row) {
    if (cur.running.has(row.id) || row.running) {
      const last = row.running?.last;
      return [`Running${row.tool ? ' the tool' : ': the Oracle reads the project'}${last ? ` · ${last}` : '…'}`, 'live'];
    }
    if (row.error) return [`Failed: ${row.error}`, 'warn'];
    if (row.tool) return ['Tool available · runs free', 'cat-monitor'];
    if (!row.lastRun) return ['Never run', ''];
    if (row.commitsSince > 0) return [`Stale · ${plural(row.commitsSince, 'commit')} since`, 'warn'];
    return ['Up to date', 'cat-monitor'];
  }

  function rowHtml(row) {
    const [status, cls] = statusOf(row);
    const id = esc(row.id);
    const busy = cur.running.has(row.id) || !!row.running;
    const history = cur.history.get(row.id);
    const note = cur.notes.get(row.id);
    const editing = cur.editing === row.id;
    return `<li class="arch-finding seed-row" data-testid="seed-${id}">
      <div class="row arch-finding-head">
        <b class="seed-name">${esc(row.name)}</b>
        <span class="badge ${cls}" data-testid="seed-status-${id}">${esc(status)}</span>
        <span class="spacer"></span>
        <button type="button" class="btn sm primary" data-seed-run="${id}" data-testid="seed-run-${id}" ${busy ? 'disabled' : ''}>Run</button>
        <button type="button" class="btn sm ghost" data-seed-open="${id}" data-testid="seed-open-${id}" ${row.lastRun ? '' : 'disabled'}>Open result</button>
        <button type="button" class="btn sm ghost" data-seed-history="${id}" data-testid="seed-history-${id}" aria-expanded="${!!history}">History</button>
        <button type="button" class="btn sm ghost" data-seed-make-tool="${id}" data-testid="seed-make-tool-${id}">Make it a tool</button>
      </div>
      <div class="small muted seed-summary" title="${esc(row.summary)}">${esc(row.summary)}</div>
      <div class="small muted">${row.lastRun ? `Last run ${esc(shortDate(row.lastRun.date))} · ${esc(costText(row.lastRun))}` : `Cost: ${esc(row.cost || 'one Oracle turn')}`}
        · <button type="button" class="link-btn" data-seed-tool-edit="${id}" data-testid="seed-tool-edit-${id}">${row.tool ? `Tool: <span class="mono">${esc(row.tool)}</span>` : 'Tool command'}</button></div>
      ${editing ? `<div class="seed-tool-edit" data-testid="seed-tool-form-${id}">
        <label class="small" for="seed-tool-input-${id}">The command that prints the seed's JSON model, run in the project's folder (empty: run the Oracle)</label>
        <input type="text" id="seed-tool-input-${id}" class="mono" data-seed-tool-input="${id}" value="${esc(row.tool || '')}" spellcheck="false" placeholder="node tools/${id}.js --json" />
        <div class="row"><button type="button" class="btn sm primary" data-seed-tool-save="${id}">Save</button><button type="button" class="btn sm ghost" data-seed-tool-cancel="${id}">Cancel</button></div>
      </div>` : ''}
      ${note ? `<div class="small" role="status" data-testid="seed-note-${id}">${note}</div>` : ''}
      ${history ? `<ul class="seed-history" data-testid="seed-history-list-${id}">${history.length ? history.map((h) => `<li class="row small"><span>${esc(shortDate(h.date))}</span><span class="badge">${esc(h.source)}</span><span class="muted">${esc(costText(h))}</span><button type="button" class="link-btn" data-seed-open="${id}" data-seed-date="${esc(h.date)}">Open</button></li>`).join('') : '<li class="small muted">No run yet.</li>'}</ul>` : ''}
    </li>`;
  }

  function frameHtml() {
    const o = cur.open;
    if (!o) return '';
    if (o.error) return `<div class="usage-unavailable" role="alert">Could not open the result: ${esc(o.error)}</div>`;
    if (!o.html) return '<p class="small muted" role="status">Opening the result…</p>';
    return `<div class="seed-result" data-testid="seed-result">
      <div class="row arch-finding-head"><b>${esc(o.name)}</b><span class="muted small">${esc(shortDate(o.date))}</span><span class="spacer"></span><button type="button" class="btn sm ghost" data-seed-close>Close</button></div>
      <iframe class="seed-frame" data-testid="seed-frame" title="${esc(o.name)} result" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(framed(o.html))}"></iframe>
    </div>`;
  }

  function render() {
    if (!cur?.box) return;
    const body = cur.error
      ? `<div class="usage-unavailable" role="alert">Could not read the seeds: ${esc(cur.error)}</div>`
      : !cur.rows ? '<p class="small muted" role="status">Loading the seeds…</p>'
        : !cur.rows.length ? '<div class="empty-state"><b>No analysis seed</b><p class="muted">Add one under the workspace\'s seeds/ folder (seeds/&lt;name&gt;/seed.md).</p></div>'
          : `<ul class="arch-findings">${cur.rows.map(rowHtml).join('')}</ul>`;
    // the tool command being typed survives a re-render
    const draft = cur.editing ? cur.box.querySelector(`[data-seed-tool-input="${cur.editing}"]`)?.value : undefined;
    cur.box.innerHTML = `<section class="seeds" data-testid="seeds-section" aria-label="Seeds">
      <h3 class="arch-sub">Seeds <span class="muted small">analyses the Oracle runs read-only on this project</span></h3>
      ${body}
      ${frameHtml()}
    </section>`;
    const input = draft != null && cur.box.querySelector(`[data-seed-tool-input="${cur.editing}"]`);
    if (input) input.value = draft;
  }

  // a poll's update: only the status badges and Run buttons (an open result or a typed command stays);
  // the whole section when a row is missing
  function patchRows() {
    for (const row of cur.rows || []) {
      const badge = cur.box.querySelector(`[data-testid="seed-status-${row.id}"]`);
      const btn = cur.box.querySelector(`[data-seed-run="${row.id}"]`);
      if (!badge || !btn) { render(); return; }
      const [status, cls] = statusOf(row);
      badge.textContent = status;
      badge.className = `badge ${cls}`.trim();
      btn.disabled = cur.running.has(row.id) || !!row.running;
    }
  }

  async function load({ patch = false } = {}) {
    const c = cur;
    try {
      const rows = await api.listSeeds({ projectId: c.id });
      if (cur !== c) return;
      c.rows = rows || [];
      c.error = null;
    } catch (e) {
      if (cur !== c) return;
      c.error = errMsg(e);
    }
    if (patch && !c.error) patchRows();
    else render();
  }

  // while a seed runs, the list is read again for the Oracle's progress
  function poll() {
    if (cur.timer || !cur.running.size) return;
    const c = cur;
    c.timer = setTimeout(async () => {
      c.timer = null;
      if (cur !== c || !c.running.size) return;
      await load({ patch: true });
      poll();
    }, POLL_MS);
  }

  const rowOf = (seedId) => (cur.rows || []).find((r) => r.id === seedId) || null;

  async function run(seedId) {
    const c = cur;
    if (c.running.has(seedId)) return;
    let estimate = null;
    try { estimate = await api.seedEstimate({ projectId: c.id, seedId }); } catch (e) { showToast(`Could not estimate the seed's cost: ${errMsg(e)}`); return; }
    // a real model call costs money: say how much first (a tool or a simulated run is free)
    if (!estimate?.free && !state.simulationOnly) {
      const cost = estimate?.costUsd != null ? `about ${fmtUsd(estimate.costUsd)}` : 'an unknown amount (no earlier run)';
      if (!confirm(`The Oracle will run the seed ${seedId} read-only on this project in one turn. This calls a real model and costs ${cost}. Continue?`)) return;
    }
    c.running.add(seedId);
    c.notes.delete(seedId);
    render();
    poll();
    try {
      const out = await api.runSeed({ projectId: c.id, seedId });
      if (out?.refused) c.notes.set(seedId, esc(out.refused.text || `Refused: ${out.refused.reason}`));
    } catch (e) {
      const row = rowOf(seedId);
      if (row) row.error = errMsg(e);
    } finally {
      c.running.delete(seedId);
    }
    if (cur !== c) return;
    if (c.history.has(seedId)) c.history.set(seedId, await api.seedHistory({ projectId: c.id, seedId }).catch(() => []));
    await load();
  }

  async function open(seedId, date) {
    const c = cur;
    const row = rowOf(seedId);
    const at = date || row?.lastRun?.date;
    if (!at) return;
    c.open = { seedId, date: at, name: row?.name || seedId, html: null, error: null };
    render();
    try {
      const out = await api.seedResult({ projectId: c.id, seedId, date: at });
      if (cur !== c || c.open?.date !== at) return;
      c.open.html = String(out?.html || '');
    } catch (e) {
      if (cur !== c) return;
      c.open.error = errMsg(e);
    }
    render();
  }

  async function toggleHistory(seedId) {
    const c = cur;
    if (c.history.has(seedId)) { c.history.delete(seedId); render(); return; }
    try {
      c.history.set(seedId, (await api.seedHistory({ projectId: c.id, seedId })) || []);
    } catch (e) {
      c.notes.set(seedId, `Could not read the history: ${esc(errMsg(e))}`);
    }
    if (cur === c) render();
  }

  async function makeTool(seedId) {
    const c = cur;
    c.notes.set(seedId, 'Filing the tool issue…');
    render();
    try {
      const out = await api.makeSeedTool({ projectId: c.id, seedId });
      c.notes.set(seedId, out?.preview
        ? `Preview only (simulation): nothing was filed. The issue would be “${esc(out.title)}”.`
        : out?.url ? `Filed <a href="${esc(out.url)}" target="_blank" rel="noopener">${esc(out.title)}</a>: the Product Owner plans it like any item.` : `Filed “${esc(out?.title || '')}”.`);
    } catch (e) {
      c.notes.set(seedId, `Could not file the tool issue: ${esc(errMsg(e))}`);
    }
    if (cur === c) render();
  }

  async function saveTool(seedId) {
    const c = cur;
    const input = c.box.querySelector(`[data-seed-tool-input="${seedId}"]`);
    try {
      const out = await api.setSeedTool({ projectId: c.id, seedId, command: String(input?.value || '').trim() || null });
      c.editing = null;
      showToast(out?.tool ? `The seed ${seedId} now runs ${out.tool}` : `The seed ${seedId} runs the Oracle again`);
      await load();
    } catch (e) {
      c.notes.set(seedId, `Could not save the tool command: ${esc(errMsg(e))}`);
      render();
    }
  }

  /** The Seeds section of project `id` in `box`. */
  async function show(id, box) {
    if (cur?.id !== id) {
      if (cur?.timer) clearTimeout(cur.timer);
      cur = { id, box, rows: null, error: null, running: new Set(), history: new Map(), notes: new Map(), editing: null, open: null, timer: null };
    }
    cur.box = box;
    render();
    await load();
  }

  // a click → its action, or null
  function clickAction(e) {
    const t = e.target;
    const pick = (attr) => t.closest(`[${attr}]`)?.getAttribute(attr);
    let id;
    if ((id = pick('data-seed-run'))) return () => run(id);
    if ((id = pick('data-seed-open'))) {
      const date = t.closest('[data-seed-date]')?.getAttribute('data-seed-date') || null;
      return () => open(id, date);
    }
    if ((id = pick('data-seed-history'))) return () => toggleHistory(id);
    if ((id = pick('data-seed-make-tool'))) return () => makeTool(id);
    if ((id = pick('data-seed-tool-edit'))) return () => { cur.editing = id; render(); };
    if ((id = pick('data-seed-tool-save'))) return () => saveTool(id);
    if (pick('data-seed-tool-cancel') != null) return () => { cur.editing = null; render(); };
    if (t.closest('[data-seed-close]')) return () => { cur.open = null; render(); };
    return null;
  }

  /** A click inside the section; true when it was the section's. */
  function onClick(e) {
    if (!cur?.box?.contains(e.target)) return false;
    const action = clickAction(e);
    if (!action) return false;
    action();
    return true;
  }

  window.ProjectSeeds = {
    onClick,
    show,
  };
})();
