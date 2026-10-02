// Artifacts panel: one run's artifacts as a list with an in-place preview, the same source as the
// Artifacts screen (artifacts:list → runArtifacts in src/runs.js). One component for the Run
// screen's Artifacts tab (#109) and the approval gate's side panel (#108):
// - grouped by kind (documents, screenshots and evidence, handoff notes, decisions, other files),
//   newest first in a group; `flat: true` lists them newest first without groups (the gate);
// - the run's screenshots first (#146, artifacts:evidence → src/evidence.js): the final set by issue,
//   each original/modified pair side by side ("Original (main)", "Modified (<branch> @<sha>)") with
//   its caption, older rounds and steps in a collapsed History; "No screenshots in this run"; a
//   legacy run (screenshots/ + screenshots.json) shows as one set;
// - a click previews the file without leaving the screen: markdown rendered, images (with their pair
//   when the evidence manifest has one), TSV as a table, JSON and text as text; "Open in Artifacts"
//   goes to the full screen at that file (openArtifactsAt in app.js);
// - every image opens on click (or Enter) in the shared image viewer (image-viewer.js, #145);
//   ArtifactsPanel.openImage does the same for the Artifacts screen;
// - right-click (or Shift+F10) on a file or an open image: the copy menu (artifact-menu.js, #114);
// - extras (the gate): changed files (a click opens that file's diff) and notes (the developer's
//   test_notes / evidence_plan), shown above the files; the gate right after a screenshots step
//   (extras.capture, #144) leads with that step's latest round only, its failed captures, the other
//   rounds in History, or "No screenshots: <reason>";
// - live: ArtifactsPanel.refreshRun(runId) reloads every mounted panel of that run (app.js calls
//   it on file.saved, handoff.saved, decision.logged, step.finished, workflow.finished).
// Uses app.js's helpers (esc, api, artKindIcon, fmtSize, markdownHtml, renderJsonText,
// renderDelimited, errMsg, openArtifactsAt, dateOf) and ImageViewer.
(() => {
  const GROUPS = [
    ['documents', 'Documents'],
    ['evidence', 'Screenshots and evidence'],
    ['handoffs', 'Handoff notes'],
    ['decisions', 'Decisions'],
    ['other', 'Other files'],
  ];
  const panels = new Set();
  const lists = new Map(); // runId -> { run, files, evidence, at } (the last listing)
  const thumbs = new Map(); // <file>|<captured_at> -> data URL (screenshots, read once)
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
    const [[r] = [], evidence] = await Promise.all([
      api.listArtifacts({ runId }).then((x) => x || []),
      api.runEvidence ? api.runEvidence(runId).catch(() => null) : null,
    ]);
    const entry = { run: r || null, files: r?.artifacts || [], evidence: evidence || null, at: Date.now() };
    lists.set(runId, entry);
    return entry;
  }

  function mount(root, opts = {}) {
    const p = {
      root, runId: null, flat: !!opts.flat, extras: opts.extras || null, onCount: opts.onCount || null,
      files: null, run: null, evidence: undefined, error: null, sel: null, doc: null, seq: 0, historyOpen: false,
      setRun(runId) {
        if (runId === p.runId) return;
        p.runId = runId || null;
        p.sel = null; p.doc = null; p.files = null; p.run = null; p.evidence = undefined; p.historyOpen = false;
        const cached = runId && lists.get(runId);
        if (cached) { p.files = cached.files; p.run = cached.run; p.evidence = cached.evidence; }
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
          p.files = entry.files; p.run = entry.run; p.evidence = entry.evidence; p.error = null;
        } catch (e) {
          if (runId !== p.runId) return;
          p.error = errMsg(e);
          p.files = p.files || [];
        }
        p.onCount?.(p.count());
        if (!p.sel) p.render();
      },
      render() { root.innerHTML = p.sel ? previewHtml(p) : listHtml(p); if (p.sel) paintPreview(p); else paintThumbs(p); },
      select(sel) { p.sel = sel; p.doc = null; p.render(); if (sel.path) readInto(p, sel); },
      destroy() { panels.delete(p); root.innerHTML = ''; },
    };
    root.classList.add('ap');
    root.addEventListener('click', (e) => onClick(p, e));
    root.addEventListener('contextmenu', (e) => onContextMenu(p, e));
    // a focused image opens with Enter (or Space), like a click
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-iv-thumb]')) { e.preventDefault(); onClick(p, { target: e.target }); }
    });
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
      // changesReported: no git diff (a simulated run has no worktree, #115), the developer's files_changed
      const reported = x.changesReported || null;
      const label = reported === 'simulated' ? 'simulated' : 'reported by the developer';
      out.push(`<div class="ap-group"><div class="ap-group-head">Changed files${list.length ? ` <span class="muted">${list.length}</span>` : ''}${reported ? ` <span class="badge" title="No git diff for this run: the files the developer step reported">${label}</span>` : ''}</div>
        ${typeof x.changes === 'string' ? `<p class="muted small ap-pad">${esc(x.changes)}</p>` : !list.length ? `<p class="muted small ap-pad">${reported ? 'The developer reported no changed files.' : 'No changes against the base.'}</p>`
    : list.map((c) => {
      const main = `<span class="ap-file-main"><span class="ap-file-name mono">${esc(baseOf(c.file))}</span><span class="ap-file-sub muted mono">${esc(dirOf(c.file) === slash(c.file) ? '' : dirOf(c.file))}</span></span>`;
      if (reported) return `<div class="ap-file ap-change ap-reported" title="${esc(c.file)}">${main}<span class="ap-file-size muted">${label}</span></div>`;
      return `<button type="button" class="ap-file ap-change" data-ap-change="${esc(c.file)}" title="Show the diff of ${esc(c.file)}">${main}
            <span class="ap-file-size">${c.added == null ? '<span class="muted">binary</span>' : `<span class="ap-add">+${c.added}</span> <span class="ap-del">−${c.deleted}</span>`}</span></button>`;
    }).join('')}</div>`);
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
    const shots = shotsHtml(p);
    if (!p.files.length) {
      return `${head}${p.extras?.capture ? shots : ''}${extras}${error}<div class="ap-empty"><b>No artifacts yet</b><p class="muted small">Handoff notes, the decision log, documents the steps save and the evidence step's screenshots appear here as the run produces them.</p></div>`;
    }
    // the gate: the screenshots lead, then the changed files and the developer's notes
    if (p.flat) return `${head}${shots}${extras}${error}<div class="ap-group">${extras || shots ? '<div class="ap-group-head">Run files</div>' : ''}${[...p.files].sort(newest).map(fileHtml).join('')}</div>`;
    const groups = GROUPS.map(([id, label]) => {
      const files = p.files.filter((f) => groupOf(f) === id).sort(newest);
      return files.length ? `<div class="ap-group" data-group="${id}"><div class="ap-group-head">${esc(label)} <span class="muted">${files.length}</span></div>${files.map(fileHtml).join('')}</div>` : '';
    }).join('');
    return `${head}${extras}${error}${shots}${groups}`;
  }

  // ---------------------------------------------------------------- screenshots (#146)
  const SIDES = ['original', 'modified'];
  const tkey = (x) => `${x.file}|${x.captured_at || ''}`;
  const shortRef = (r) => String(r || '').replace(/^origin\//, '');
  const imageOf = (ev, file) => (ev?.images || []).find((x) => slash(x.file) === slash(file)) || null;

  // "Original (main)" / "Modified (<branch> @<short sha>)", the parts the manifest knows
  function sideLabel(ev, x) {
    if (x.side === 'original') return ev?.base ? `Original (${shortRef(ev.base)})` : 'Original';
    const ref = [ev?.branch, x.commit ? `@${String(x.commit).slice(0, 7)}` : ''].filter(Boolean).join(' ');
    return ref ? `Modified (${ref})` : 'Modified';
  }

  // An image with its pair: { key, issue, caption, sides: { original?, modified? } }
  function shotOf(ev, x) {
    const pair = x.pair_file ? imageOf(ev, x.pair_file) : null;
    const sides = { [x.side]: x };
    if (pair && !sides[pair.side]) sides[pair.side] = pair;
    return { key: x.key, issue: x.issue, caption: x.caption || pair?.caption || '', sides };
  }

  // The final set, one shot per name (an original kept from an earlier round included)
  const finalShots = (ev) => pairShots(ev, (ev?.images || []).filter((i) => i.final));

  // Images → one shot per name, each with its pair
  function pairShots(ev, images) {
    const shots = new Map();
    for (const x of images) {
      const s = shots.get(x.key);
      if (!s) shots.set(x.key, shotOf(ev, x));
      else s.sides[x.side] = x;
    }
    return [...shots.values()];
  }

  function shotCardHtml(ev, s) {
    const sides = SIDES.map((k) => s.sides[k]).filter(Boolean);
    const fig = (x) => {
      const src = thumbs.get(tkey(x));
      return `<figure><figcaption class="muted small" title="${esc(x.path)}">${esc(sideLabel(ev, x))}</figcaption><img ${ImageViewer.THUMB} alt="${esc(`${s.caption || s.key}: ${sideLabel(ev, x)}`)}" data-ap-img="${esc(x.file)}" data-ap-shot="${esc(tkey(x))}"${src ? ` src="${esc(src)}"` : ''} /></figure>`;
    };
    const only = sides.length === 1 ? `<span class="badge">${sides[0].side} only</span>` : '';
    return `<div class="ap-shot"><div class="ap-shot-head"><b class="ap-shot-title" title="${esc(s.key)}">${esc(s.caption || s.key)}</b>${only}</div>
      <div class="ap-pair${sides.length === 1 ? ' single' : ''}">${sides.map(fig).join('')}</div></div>`;
  }

  // The gate right after a screenshots step (#144, extras.capture: its output): only that step's
  // round, original/modified side by side with captions, the failed captures listed; every other
  // round in History (no stale screenshots of an older commit); "No screenshots: <reason>".
  function captureHtml(p, ev, cap) {
    const latest = (x) => x.step === cap.folder && x.round === cap.round;
    const shots = pairShots(ev, (ev?.images || []).filter(latest));
    const failed = (cap.errors || []).map((e) => `${e.name}${e.side ? ` (${e.side})` : ''}: ${e.error}`);
    const errors = failed.map((t) => `<p class="error small ap-pad" title="${esc(t)}">${esc(t)}</p>`).join('');
    const body = shots.length ? shots.map((s) => shotCardHtml(ev, s)).join('')
      : `<div class="ap-empty"><b>No screenshots:</b> <span class="muted">${esc(cap.reason || 'none were captured')}</span></div>`;
    return `<div class="ap-group ap-shots"><div class="ap-group-head">Screenshots <span class="badge">latest</span> <span class="muted" title="Captured before this gate">${esc(`${cap.folder} · round ${cap.round}`)}</span></div>
      ${body}${errors}${ev?.images?.length ? historyHtml(p, ev, (x) => !latest(x)) : ''}</div>`;
  }

  function shotsHtml(p) {
    if (p.evidence === undefined) return ''; // not loaded yet
    const ev = p.evidence;
    if (p.extras?.capture) return captureHtml(p, ev, p.extras.capture);
    if (!ev?.images?.length) return '<div class="ap-group ap-shots"><div class="ap-group-head">Screenshots</div><p class="muted small ap-pad">No screenshots in this run.</p></div>';
    const shots = finalShots(ev);
    const issues = [...new Set(shots.map((s) => s.issue || ''))];
    const where = ev.legacy ? 'recorded before evidence rounds' : ev.final ? `${ev.final.step} · round ${ev.final.round}` : '';
    const body = issues.map((iss) => {
      const head = issues.length > 1 || iss ? `<div class="ap-sub-head">${iss ? `Issue #${esc(iss)}` : 'Other screens'}</div>` : '';
      return `${head}${shots.filter((s) => (s.issue || '') === iss).map((s) => shotCardHtml(ev, s)).join('')}`;
    }).join('');
    return `<div class="ap-group ap-shots"><div class="ap-group-head">Screenshots <span class="badge">final</span> <span class="muted" title="The last round that captured">${esc(where)}</span></div>${body}${historyHtml(p, ev)}</div>`;
  }

  // Older rounds and steps (isOld: the images that are not shown above), newest first, each image
  // opening in the viewer with its pair
  function historyHtml(p, ev, isOld = (x) => !x.final) {
    const old = ev.images.filter(isOld);
    if (!old.length) return '';
    const rounds = [...(ev.rounds || [])].reverse();
    const item = (x) => `<button type="button" class="ap-file" data-ap-hist="${esc(x.file)}" data-ap-img="${esc(x.file)}" title="${esc(x.path)}">${artKindIcon('image')}
      <span class="ap-file-main"><span class="ap-file-name">${esc(x.caption || x.key)}</span><span class="ap-file-sub muted">${esc(x.key)}</span></span><span class="badge">${esc(x.side)}</span></button>`;
    const groups = rounds.map((r) => {
      const list = old.filter((x) => x.step === r.step && x.round === r.round);
      return list.length ? `<div class="ap-sub-head">${esc(r.step)} · round ${r.round}</div>${list.map(item).join('')}` : '';
    }).join('');
    return `<details class="ap-history"${p.historyOpen ? ' open' : ''}><summary class="ap-group-head" data-ap-history>History <span class="muted">${old.length}</span></summary>${groups}</details>`;
  }

  // Reads the screenshots shown without their image yet (once per file and capture)
  async function paintThumbs(p) {
    for (const el of p.root.querySelectorAll('img[data-ap-shot]:not([src])')) {
      const key = el.dataset.apShot;
      let src = thumbs.get(key);
      if (!src) {
        try { src = (await api.readArtifact(el.dataset.apImg))?.image || null; } catch { src = null; }
        if (src) thumbs.set(key, src);
      }
      if (!el.isConnected) continue;
      if (src) el.src = src;
      else el.alt = 'Could not load the image';
    }
  }

  // Opens an image in the viewer: with its pair when the evidence manifest has one
  function openInViewer(ev, file, src = null, title = '') {
    const x = imageOf(ev, file);
    if (!x) { ImageViewer.open({ title: title || baseOf(file), images: [{ file, src, label: '', caption: '' }] }); return; }
    const s = shotOf(ev, x);
    const list = SIDES.map((k) => s.sides[k]).filter(Boolean);
    if (src && !thumbs.has(tkey(x))) thumbs.set(tkey(x), src);
    ImageViewer.open({
      title: s.caption || s.key,
      index: list.indexOf(x),
      images: list.map((i) => ({ file: i.file, src: thumbs.get(tkey(i)) || null, label: sideLabel(ev, i), caption: `${i.step} · round ${i.round}` })),
    });
  }

  // The Artifacts screen's image (app.js): the run's manifest gives its pair
  async function openImage({ runId, file, src = null, title = '' }) {
    let ev = runId ? lists.get(runId)?.evidence : null;
    if (runId && !ev && api.runEvidence) ev = await api.runEvidence(runId).catch(() => null);
    openInViewer(ev, file, src, title);
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
    // a screenshot of the evidence manifest: shown with its pair, side by side
    const shot = doc.image ? imageOf(p.evidence, sel.path) : null;
    if (shot) { doc.shot = shot; thumbs.set(tkey(shot), doc.image); }
    if (seq !== p.seq || p.sel !== sel) return;
    p.doc = doc;
    paintPreview(p);
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
    if (d.image && d.shot) {
      body.innerHTML = shotCardHtml(p.evidence, shotOf(p.evidence, d.shot));
      paintThumbs(p);
      return;
    }
    if (d.image) { body.innerHTML = `<div class="art-image"><img ${ImageViewer.THUMB} src="${esc(d.image)}" alt="${esc(meta.name || '')}" data-ap-img="${esc(s.path)}" /></div>`; return; }
    if (d.binary || d.text == null || meta.kind === 'other') { body.innerHTML = `${notice}<p class="muted small ap-pad">Preview not available for this file: open it in Artifacts.</p>`; return; }
    if (meta.kind === 'markdown') { body.innerHTML = `${notice}<article class="md">${markdownHtml(d.text)}</article>`; return; }
    if (meta.kind === 'json') { body.innerHTML = `${notice}<pre class="art-code json">${renderJsonText(d.text, /\.jsonl$/i.test(s.path))}</pre>`; return; }
    if (meta.kind === 'table') { body.innerHTML = `${notice}${renderDelimited(d.text, /\.csv$/i.test(s.path) ? ',' : '\t')}`; return; }
    body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`;
  }

  // ---------------------------------------------------------------- clicks
  function onClick(p, e) {
    const t = e.target;
    const thumb = t.closest('[data-iv-thumb]');
    if (thumb) { openInViewer(p.evidence, thumb.dataset.apImg, thumb.getAttribute('src'), thumb.getAttribute('alt') || ''); return; }
    const hist = t.closest('[data-ap-hist]');
    if (hist) { openInViewer(p.evidence, hist.dataset.apHist); return; }
    if (t.closest('[data-ap-history]')) { p.historyOpen = !t.closest('details')?.open; return; }
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

  // Right-click (or Shift+F10) on a file of the list or on an open image: the copy menu (#114)
  function onContextMenu(p, e) {
    const img = e.target.closest('[data-ap-img]');
    if (img) { ArtifactMenu.open(e, { path: img.dataset.apImg, image: true }); return; }
    const file = e.target.closest('[data-ap-file]');
    if (!file) return;
    const f = (p.files || []).find((x) => x.path === file.dataset.apFile) || { path: file.dataset.apFile };
    ArtifactMenu.open(e, f);
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

  window.ArtifactsPanel = { groupOf, mount, openImage, refreshRun };
})();
