// Artifacts panel: one run's artifacts as a list with an in-place preview, the same source as the
// Artifacts screen (artifacts:list → runArtifacts in src/runs.js). One component for the Run
// screen's Artifacts tab (#109) and the approval gate's side panel (#108):
// - grouped by kind (documents, screenshots and evidence, handoff notes, decisions, other files),
//   newest first in a group; `flat: true` lists them newest first without groups (the gate);
// - a click previews the file without leaving the screen: markdown rendered, images (a before/after
//   pair side by side when the folder's screenshots.json pairs them), TSV as a table, JSON and text
//   as text; "Open in Artifacts" goes to the full screen at that file (openArtifactsAt in app.js);
// - extras (the gate): changed files (a click opens that file's diff) and notes (the developer's
//   test_notes / evidence_plan), shown above the files;
// - live: ArtifactsPanel.refreshRun(runId) reloads every mounted panel of that run (app.js calls
//   it on file.saved, handoff.saved, decision.logged, step.finished, workflow.finished).
// Uses app.js's helpers (esc, api, artKindIcon, fmtSize, markdownHtml, renderJsonText,
// renderDelimited, errMsg, openArtifactsAt, dateOf).
(() => {
  const GROUPS = [
    ['documents', 'Documents'],
    ['evidence', 'Screenshots and evidence'],
    ['handoffs', 'Handoff notes'],
    ['decisions', 'Decisions'],
    ['other', 'Other files'],
  ];
  const panels = new Set();
  const lists = new Map(); // runId -> { run, files, at } (the last listing)
  const slash = (p) => String(p || '').replace(/\\/g, '/');
  const dirOf = (p) => slash(p).replace(/\/[^/]*$/, '');
  const baseOf = (p) => slash(p).split('/').pop();

  function groupOf(f) {
    const rel = slash(f.rel || f.name);
    if (/(^|\/)handoffs\//i.test(rel)) return 'handoffs';
    if (/(^|\/)decisions\.tsv$/i.test(rel)) return 'decisions';
    if (f.kind === 'image' || /(^|\/)(screenshots|evidence)\//i.test(rel)) return 'evidence';
    if (f.kind === 'markdown' || f.location === 'external') return 'documents';
    return 'other';
  }
  const newest = (a, b) => String(b.mtime || '').localeCompare(String(a.mtime || ''));

  async function fetchList(runId) {
    const [r] = (await api.listArtifacts({ runId })) || [];
    const entry = { run: r || null, files: r?.artifacts || [], at: Date.now() };
    lists.set(runId, entry);
    return entry;
  }

  function mount(root, opts = {}) {
    const p = {
      root, runId: null, flat: !!opts.flat, extras: opts.extras || null, onCount: opts.onCount || null,
      files: null, run: null, error: null, sel: null, doc: null, seq: 0,
      setRun(runId) {
        if (runId === p.runId) return;
        p.runId = runId || null;
        p.sel = null; p.doc = null; p.files = null; p.run = null;
        const cached = runId && lists.get(runId);
        if (cached) { p.files = cached.files; p.run = cached.run; }
        p.onCount?.(p.count());
        p.render();
        if (runId) p.load();
      },
      setExtras(extras) { p.extras = extras; if (!p.sel) p.render(); },
      count: () => (p.files ? p.files.length : 0),
      async load() {
        const runId = p.runId;
        if (!runId) return;
        try {
          const entry = await fetchList(runId);
          if (runId !== p.runId) return;
          p.files = entry.files; p.run = entry.run; p.error = null;
        } catch (e) {
          if (runId !== p.runId) return;
          p.error = errMsg(e);
          p.files = p.files || [];
        }
        p.onCount?.(p.count());
        if (!p.sel) p.render();
      },
      render() { root.innerHTML = p.sel ? previewHtml(p) : listHtml(p); if (p.sel) paintPreview(p); },
      select(sel) { p.sel = sel; p.doc = null; p.render(); if (sel.path) readInto(p, sel); },
      destroy() { panels.delete(p); root.innerHTML = ''; },
    };
    root.classList.add('ap');
    root.addEventListener('click', (e) => onClick(p, e));
    panels.add(p);
    if (opts.runId) p.setRun(opts.runId);
    return p;
  }

  // ---------------------------------------------------------------- list
  function fileHtml(f) {
    const who = [f.step, f.agent].filter(Boolean).join(' · ');
    return `<button type="button" class="ap-file${f.exists === false ? ' missing' : ''}" data-ap-file="${esc(f.path)}" title="${esc(f.path)}">
      ${artKindIcon(f.kind)}
      <span class="ap-file-main"><span class="ap-file-name">${esc(f.name)}${f.location === 'external' ? ' <span class="badge">project copy</span>' : ''}${f.exists === false ? ' <span class="badge">deleted</span>' : ''}</span>
      <span class="ap-file-sub muted">${esc(who || slash(f.rel || ''))}</span></span>
      <span class="ap-file-size muted">${esc(fmtSize(f.size))}</span></button>`;
  }

  function extrasHtml(x) {
    if (!x) return '';
    const out = [];
    if (x.changes) {
      const list = Array.isArray(x.changes) ? x.changes : [];
      out.push(`<div class="ap-group"><div class="ap-group-head">Changed files${list.length ? ` <span class="muted">${list.length}</span>` : ''}</div>
        ${typeof x.changes === 'string' ? `<p class="muted small ap-pad">${esc(x.changes)}</p>` : !list.length ? '<p class="muted small ap-pad">No changes against the base.</p>'
    : list.map((c) => `<button type="button" class="ap-file ap-change" data-ap-change="${esc(c.file)}" title="Show the diff of ${esc(c.file)}">
            <span class="ap-file-main"><span class="ap-file-name mono">${esc(baseOf(c.file))}</span><span class="ap-file-sub muted mono">${esc(dirOf(c.file) === slash(c.file) ? '' : dirOf(c.file))}</span></span>
            <span class="ap-file-size">${c.added == null ? '<span class="muted">binary</span>' : `<span class="ap-add">+${c.added}</span> <span class="ap-del">−${c.deleted}</span>`}</span></button>`).join('')}</div>`);
    }
    if (x.notes?.length) {
      out.push(`<div class="ap-group"><div class="ap-group-head">From the developer</div>${x.notes.map((n, i) => `<button type="button" class="ap-file" data-ap-note="${i}">
        ${artKindIcon('markdown')}<span class="ap-file-main"><span class="ap-file-name">${esc(n.title)}</span><span class="ap-file-sub muted">${esc(String(n.text).split('\n')[0].slice(0, 90))}</span></span></button>`).join('')}</div>`);
    }
    return out.join('');
  }

  function listHtml(p) {
    const head = `<div class="ap-head"><span class="muted small">${p.files ? `${p.files.length} artifact${p.files.length === 1 ? '' : 's'}` : ''}</span>
      ${p.runId ? '<button type="button" class="btn sm ghost" data-ap-full title="All of this run\'s files in the Artifacts screen">Open in Artifacts</button>' : ''}</div>`;
    if (!p.runId) return '<p class="empty muted">Select a run to see its artifacts.</p>';
    const extras = extrasHtml(p.extras);
    if (p.files == null) return `${head}${extras}<p class="muted small ap-pad">Loading…</p>`;
    const error = p.error ? `<p class="error small ap-pad">Could not load artifacts: ${esc(p.error)}</p>` : '';
    if (!p.files.length) {
      return `${head}${extras}${error}<div class="ap-empty"><b>No artifacts yet</b><p class="muted small">Handoff notes, the decision log, documents the steps save and the evidence step's screenshots appear here as the run produces them.</p></div>`;
    }
    if (p.flat) return `${head}${extras}${error}<div class="ap-group">${extras ? '<div class="ap-group-head">Run files</div>' : ''}${[...p.files].sort(newest).map(fileHtml).join('')}</div>`;
    const groups = GROUPS.map(([id, label]) => {
      const files = p.files.filter((f) => groupOf(f) === id).sort(newest);
      return files.length ? `<div class="ap-group" data-group="${id}"><div class="ap-group-head">${esc(label)} <span class="muted">${files.length}</span></div>${files.map(fileHtml).join('')}</div>` : '';
    }).join('');
    return `${head}${extras}${error}${groups}`;
  }

  // ---------------------------------------------------------------- preview
  function previewHtml(p) {
    const s = p.sel;
    const meta = s.path ? (p.files || []).find((f) => f.path === s.path) || {} : {};
    const name = s.title || meta.name || baseOf(s.path);
    return `<div class="ap-bar"><button type="button" class="btn sm ghost" data-ap-back title="Back to the list">← Artifacts</button>
      ${s.path ? artKindIcon(meta.kind) : ''}<b class="ap-title" title="${esc(s.path || name)}">${esc(name)}</b>
      ${s.path ? '<button type="button" class="btn sm ghost" data-ap-full>Open in Artifacts</button>' : ''}</div>
      <div class="ap-body"></div>`;
  }

  async function readInto(p, sel) {
    const seq = ++p.seq;
    let doc;
    try { doc = await api.readArtifact(sel.path); } catch (e) { doc = { error: errMsg(e) }; }
    // an image the folder's screenshots.json pairs with another: both, side by side
    if (doc.image) doc.pair = await pairOf(p, sel.path).catch(() => null);
    if (seq !== p.seq || p.sel !== sel) return;
    p.doc = doc;
    paintPreview(p);
  }

  async function pairOf(p, file) {
    const dir = dirOf(file);
    const manifest = (p.files || []).find((f) => f.name === 'screenshots.json' && dirOf(f.path) === dir);
    if (!manifest) return null;
    const list = JSON.parse((await api.readArtifact(manifest.path)).text || '[]');
    const name = baseOf(file);
    const shot = (Array.isArray(list) ? list : []).find((s) => s && s.before && (baseOf(s.path) === name || baseOf(s.before) === name));
    if (!shot) return null;
    const pathOf = (rel) => (p.files || []).find((f) => dirOf(f.path) === dir && f.name === baseOf(rel))?.path;
    const [after, before] = [pathOf(shot.path), pathOf(shot.before)];
    if (!after || !before) return null;
    const read = async (x) => (x === file ? null : (await api.readArtifact(x)).image);
    return { caption: shot.caption || '', before: (await read(before)) || null, after: (await read(after)) || null, beforePath: before, afterPath: after };
  }

  function paintPreview(p) {
    const body = p.root.querySelector('.ap-body');
    if (!body) return;
    const s = p.sel;
    if (s.text != null) { body.innerHTML = `<article class="md">${markdownHtml(s.text)}</article>`; return; }
    const d = p.doc;
    if (!d) { body.innerHTML = '<p class="muted small ap-pad">Loading…</p>'; return; }
    if (d.error) { body.innerHTML = `<p class="error small ap-pad">${esc(d.error)}</p>`; return; }
    const meta = (p.files || []).find((f) => f.path === s.path) || d;
    const notice = d.truncated ? '<div class="art-notice">This file is larger than 5 MB: only the first 5 MB are shown.</div>' : '';
    if (d.image && d.pair) {
      const img = (src, which) => `<figure><figcaption class="muted small">${which}</figcaption><img src="${esc(src || d.image)}" alt="${esc(which)}" /></figure>`;
      const mine = (x) => (x === s.path ? d.image : null);
      body.innerHTML = `<div class="ap-pair">${img(mine(d.pair.beforePath) || d.pair.before, 'Before')}${img(mine(d.pair.afterPath) || d.pair.after, 'After')}</div>${d.pair.caption ? `<p class="muted small ap-pad">${esc(d.pair.caption)}</p>` : ''}`;
      return;
    }
    if (d.image) { body.innerHTML = `<div class="art-image"><img src="${esc(d.image)}" alt="${esc(meta.name || '')}" /></div>`; return; }
    if (d.binary || d.text == null || meta.kind === 'other') { body.innerHTML = `${notice}<p class="muted small ap-pad">Preview not available for this file: open it in Artifacts.</p>`; return; }
    if (meta.kind === 'markdown') { body.innerHTML = `${notice}<article class="md">${markdownHtml(d.text)}</article>`; return; }
    if (meta.kind === 'json') { body.innerHTML = `${notice}<pre class="art-code json">${renderJsonText(d.text, /\.jsonl$/i.test(s.path))}</pre>`; return; }
    if (meta.kind === 'table') { body.innerHTML = `${notice}${renderDelimited(d.text, /\.csv$/i.test(s.path) ? ',' : '\t')}`; return; }
    body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`;
  }

  // ---------------------------------------------------------------- clicks
  function onClick(p, e) {
    const t = e.target;
    const file = t.closest('[data-ap-file]');
    if (file) { p.select({ path: file.dataset.apFile }); return; }
    const note = t.closest('[data-ap-note]');
    if (note) { const n = p.extras?.notes?.[+note.dataset.apNote]; if (n) p.select({ title: n.title, text: String(n.text) }); return; }
    const change = t.closest('[data-ap-change]');
    if (change) { p.extras?.onChange?.(change.dataset.apChange); return; }
    if (t.closest('[data-ap-back]')) { p.sel = null; p.doc = null; p.render(); return; }
    if (t.closest('[data-ap-full]')) {
      const path = p.sel?.path || [...(p.files || [])].sort(newest)[0]?.path;
      if (path) openArtifactsAt({ projectId: p.run?.project?.id || '', path, mock: !!p.run?.mock });
      else showToast('No artifacts yet', 'This run has not produced files yet.');
    }
  }

  // Reloads the panels of a run (throttled: a burst of events makes one listing).
  const timers = new Map();
  function refreshRun(runId) {
    // a gate card rebuilt or answered took its panel away
    for (const p of panels) if (!p.root.isConnected) panels.delete(p);
    if (!runId || timers.has(runId) || ![...panels].some((p) => p.runId === runId)) return;
    const last = lists.get(runId)?.at || 0;
    timers.set(runId, setTimeout(() => {
      timers.delete(runId);
      lists.delete(runId);
      for (const p of panels) if (p.runId === runId) p.load();
    }, Math.max(300, 1500 - (Date.now() - last))));
  }

  window.ArtifactsPanel = { groupOf, mount, refreshRun };
})();
