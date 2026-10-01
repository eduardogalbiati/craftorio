/* global api */
// Artifacts screen: the documents and files the runs produced, grouped per run (filter by project and
// text, simulated runs in developer mode, collapse all), and the viewer (markdown with its table of
// contents, JSON, tables, images, text; the copy menu is artifact-menu.js). openArtifactsAt (the deep
// link from run lists, the Artifacts panel and the supervisor), loadArtifacts, loadArtifactsThrottled
// (run events) and renderArtifactList (developer mode) stay globals for app.js and the shared modules.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, ART_KIND, artKindIcon, fmtSize, markdownHtml, sanitizeHtml, slugify, renderJsonText,
// renderDelimited) and window.ArtifactMenu / window.ArtifactsPanel.

let artLoading = null;
let artLastLoad = 0;
let artTimer = null;
function loadArtifacts() {
  if (artLoading) return artLoading;
  const a = state.art;
  artLoading = (async () => {
    try {
      const [runs, projects] = await Promise.all([api.listArtifacts({}), state.projects.length ? state.projects : api.listProjects()]);
      a.runs = runs || [];
      state.projects = projects;
      a.error = null;
    } catch (e) {
      a.error = errMsg(e);
    }
    artLoading = null;
    artLastLoad = Date.now();
    if (state.view === 'artifacts') renderArtifacts();
  })();
  return artLoading;
}

function loadArtifactsThrottled() {
  if (artTimer || state.view !== 'artifacts') return;
  const wait = Math.max(0, 2000 - (Date.now() - artLastLoad));
  artTimer = setTimeout(() => { artTimer = null; if (state.view === 'artifacts') loadArtifacts(); }, wait);
}

// Opens the Artifacts view focused on one file (from the project view).
function openArtifactsAt({ projectId, path, mock }) {
  const a = state.art;
  a.projectId = projectId || '';
  a.q = '';
  if (mock) a.showSim = true;
  a.reveal = path; // opens the file's group once the list knows which run it belongs to
  showView('artifacts');
  selectArtifact(path);
}

function renderArtifacts() {
  const a = state.art;
  const sel = $('#art-project');
  sel.innerHTML = `<option value="">All projects</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  sel.value = a.projectId;
  if (sel.value !== a.projectId) a.projectId = '';
  $('#art-search').value = a.q;
  $('#art-show-sim').checked = a.showSim;
  $('#art-error').textContent = a.error ? `Could not load artifacts: ${a.error}` : '';
  renderArtifactList();
  renderArtifactViewer();
}

// Simulated runs only exist for developer mode: without it they are never listed nor counted.
const artShowSim = () => devMode() && state.art.showSim;

function artifactRunsFiltered() {
  const a = state.art;
  const q = a.q.trim().toLowerCase();
  return (a.runs || [])
    .filter((r) => artShowSim() || !r.mock)
    .filter((r) => !a.projectId || r.project?.id === a.projectId)
    .map((r) => {
      if (!q) return r;
      const runHit = [r.workflow, r.task, r.project?.name].some((x) => String(x || '').toLowerCase().includes(q));
      return runHit ? r : { ...r, artifacts: r.artifacts.filter((f) => `${f.name} ${f.rel}`.toLowerCase().includes(q)) };
    })
    .filter((r) => r.artifacts.length);
}

function renderArtifactList() {
  const a = state.art;
  const box = $('#art-list');
  if (a.runs == null) { box.innerHTML = a.error ? '' : '<p class="muted small art-pad">Loading…</p>'; paintArtToggleAll([], false); return; }
  const runs = artifactRunsFiltered();
  const hiddenSim = devMode() ? (a.runs || []).filter((r) => r.mock && !a.showSim).length : 0;
  if (!runs.length) {
    paintArtToggleAll([], false);
    box.innerHTML = `<div class="art-pad muted small">${a.runs.length ? 'No artifacts match these filters.' : 'No run has produced documents or files yet.'}${hiddenSim ? `<br>${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.` : ''}</div>`;
    return;
  }
  if (a.reveal) {
    const owner = runs.find((r) => r.artifacts.some((f) => f.path === a.reveal));
    if (owner) { setArtGroupOpen(owner.runId, true); a.reveal = null; }
  }
  const searching = !!a.q.trim();
  box.innerHTML = runs.map((r, i) => {
    const open = searching || artGroupOpen(r.runId, i === 0);
    return `
    <div class="art-run ${open ? 'open' : ''}" data-run="${esc(r.runId)}">
      <button class="art-run-head" title="${esc(r.task || '')}" aria-expanded="${open}">
        <div class="row"><span class="art-chev" aria-hidden="true">${open ? '▾' : '▸'}</span><b class="art-run-name">${esc(r.workflow || 'workflow')}</b><span class="pill pill-${esc(r.status)}">${esc(r.status)}</span>${r.mock ? '<span class="badge p-mock">simulated</span>' : ''}</div>
        <div class="muted small art-run-sub">${r.project ? `${esc(r.project.name)} · ` : ''}${r.startedAt ? esc(dateOf(r.startedAt)) : ''} · ${r.artifacts.length} file${r.artifacts.length > 1 ? 's' : ''}</div>
      </button>
      ${!open ? '' : r.artifacts.map((f) => `
        <button class="art-file ${a.sel === f.path ? 'active' : ''} ${f.exists ? '' : 'missing'}" data-path="${esc(f.path)}" title="${esc(f.path)}">
          ${artKindIcon(f.kind)}
          <span class="art-file-main">
            <span class="art-file-name">${esc(f.name)}${f.location === 'external' ? ' <span class="badge">project copy</span>' : ''}${f.exists ? '' : ' <span class="badge">deleted</span>'}</span>
            <span class="art-file-sub muted">${esc(f.rel || '')}${f.step ? ` · ${esc(f.step)}${f.agent ? ` · ${esc(f.agent)}` : ''}` : f.agent ? ` · ${esc(f.agent)}` : ''}</span>
          </span>
          <span class="art-file-size muted">${esc(fmtSize(f.size))}</span>
        </button>`).join('')}
    </div>`;
  }).join('') + (hiddenSim ? `<p class="muted small art-pad">${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.</p>` : '');
  box.querySelectorAll('.art-file').forEach((b) => {
    b.onclick = () => selectArtifact(b.dataset.path);
    // right-click or Shift+F10: Copy to clipboard / Copy file / Copy path (artifact-menu.js, #114)
    b.oncontextmenu = (e) => ArtifactMenu.open(e, findArtifactMeta(b.dataset.path) || { path: b.dataset.path });
  });
  box.querySelectorAll('.art-run-head').forEach((b) => (b.onclick = () => {
    if (searching) return; // every matching group is shown open while searching
    const g = b.closest('.art-run');
    setArtGroupOpen(g.dataset.run, !g.classList.contains('open'));
    renderArtifactList();
  }));
  paintArtToggleAll(runs, searching);
}

// Collapse all / Expand all (#126): "Collapse all" while any listed group is open, "Expand all" when
// all are closed; disabled while searching (matching groups are shown open then).
function paintArtToggleAll(runs, searching) {
  const b = $('#art-toggle-all');
  if (!b) return;
  b.classList.toggle('hidden', !runs.length);
  const anyOpen = runs.some((r, i) => artGroupOpen(r.runId, i === 0));
  const label = anyOpen ? 'Collapse all' : 'Expand all';
  b.disabled = searching;
  b.title = searching ? 'Groups are open while searching' : anyOpen ? 'Close every run group' : 'Open every run group';
  b.setAttribute('aria-label', `${label} run groups`);
  b.setAttribute('aria-pressed', String(!anyOpen)); // pressed: everything is collapsed
  b.querySelector('span').textContent = label;
  b.querySelector('polyline').setAttribute('points', anyOpen ? '18 15 12 9 6 15' : '6 9 12 15 18 9');
}

// Every listed group to the same state, each remembered as if toggled by hand (setArtGroupOpen).
function toggleAllArtGroups() {
  if (state.art.q.trim()) return;
  const runs = artifactRunsFiltered();
  const open = !runs.some((r, i) => artGroupOpen(r.runId, i === 0));
  for (const r of runs) setArtGroupOpen(r.runId, open);
  renderArtifactList();
}

// Open/closed state of the run groups, remembered across restarts. Groups the user never
// toggled use the default: only the first one open.
const ART_GROUPS_KEY = 'multiagent.artifactGroups';
let artGroups = null;
function artGroupsState() {
  if (!artGroups) {
    try { artGroups = JSON.parse(localStorage.getItem(ART_GROUPS_KEY) || '{}') || {}; } catch { artGroups = {}; }
  }
  return artGroups;
}
function artGroupOpen(runId, fallback) {
  const v = artGroupsState()[runId];
  return typeof v === 'boolean' ? v : fallback;
}
function setArtGroupOpen(runId, open) {
  const g = artGroupsState();
  g[runId] = open;
  // Forget runs that no longer have artifacts so the stored map doesn't grow forever.
  if (state.art.runs) {
    const live = new Set(state.art.runs.map((r) => r.runId));
    for (const id of Object.keys(g)) if (!live.has(id)) delete g[id];
  }
  try { localStorage.setItem(ART_GROUPS_KEY, JSON.stringify(g)); } catch { /* ignore */ }
}

let artReadSeq = 0;
async function selectArtifact(path) {
  const a = state.art;
  a.sel = path;
  a.doc = { path, loading: true };
  document.querySelectorAll('.art-file').forEach((b) => b.classList.toggle('active', b.dataset.path === path));
  renderArtifactViewer();
  const seq = ++artReadSeq;
  let doc;
  try {
    doc = await api.readArtifact(path);
  } catch (e) {
    doc = { path, error: errMsg(e) };
  }
  if (seq !== artReadSeq) return; // a newer selection won
  a.doc = doc;
  if (state.view === 'artifacts') renderArtifactViewer();
}

function findArtifactMeta(path) {
  for (const r of state.art.runs || []) for (const f of r.artifacts) if (f.path === path) return f;
  return null;
}

function renderArtifactViewer() {
  const a = state.art;
  const bar = $('#art-toolbar');
  const body = $('#art-body');
  const d = a.doc;
  if (!d) {
    bar.classList.add('hidden');
    body.innerHTML = '<div class="art-empty muted">Select a file to preview it.</div>';
    return;
  }
  const meta = { ...(findArtifactMeta(d.path) || {}), ...d };
  const name = meta.name || d.path.split(/[\\/]/).pop();
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="art-title">
      ${artKindIcon(meta.kind)}
      <div class="art-title-text"><b>${esc(name)}</b><span class="mono muted art-path" title="${esc(d.path)}">${esc(d.path)}</span></div>
    </div>
    ${meta.kind === 'markdown' && d.text != null ? `<div class="seg sm"><button type="button" data-mode="rendered" class="${a.mode === 'rendered' ? 'active' : ''}">Rendered</button><button type="button" data-mode="source" class="${a.mode === 'source' ? 'active' : ''}">Source</button></div>` : ''}
    <div class="row">
      <button class="btn sm ghost" data-art-act="open" ${meta.exists === false ? 'disabled' : ''}>Open</button>
      <button class="btn sm ghost" data-art-act="reveal" ${meta.exists === false ? 'disabled' : ''}>Show in folder</button>
      <button class="btn sm ghost" data-art-act="copy">Copy path</button>
    </div>
    <span class="muted small art-msg"></span>`;
  bar.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { a.mode = b.dataset.mode; renderArtifactViewer(); }));
  bar.querySelectorAll('[data-art-act]').forEach((b) => (b.onclick = async () => {
    const msg = bar.querySelector('.art-msg');
    try {
      if (b.dataset.artAct === 'open') { const err = await api.openArtifact(d.path); if (err) throw new Error(err); }
      if (b.dataset.artAct === 'reveal') await api.openArtifact(d.path, true);
      if (b.dataset.artAct === 'copy') { await api.clipboardWrite(d.path); msg.textContent = 'Path copied.'; }
    } catch (e) {
      msg.textContent = errMsg(e);
    }
  }));

  body.scrollTop = 0;
  if (d.loading) { body.innerHTML = '<div class="art-empty muted">Loading…</div>'; return; }
  if (d.error) { body.innerHTML = `<div class="art-empty"><p class="error">${esc(d.error)}</p></div>`; return; }
  const notice = d.truncated ? '<div class="art-notice">This file is larger than 5 MB: only the first 5 MB are shown.</div>' : '';
  if (meta.kind === 'image' && d.image) {
    body.innerHTML = `<div class="art-image"><img ${ImageViewer.THUMB} src="${esc(d.image)}" alt="${esc(name)}" /></div>`;
    const img = body.querySelector('.art-image img');
    img.oncontextmenu = (e) => ArtifactMenu.open(e, { path: d.path, name, image: true });
    // the shared viewer (#145), with the screenshot's original/modified pair when it has one (#146)
    const runId = (a.runs || []).find((r) => r.artifacts.some((f) => f.path === d.path))?.runId || null;
    img.onclick = () => ArtifactsPanel.openImage({ runId, file: d.path, src: d.image, title: name });
    img.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click(); } };
    return;
  }
  if (d.binary || d.text == null || meta.kind === 'other') {
    body.innerHTML = `${notice}<div class="art-empty"><p class="muted">Preview not available for this file.</p><button class="btn primary" id="art-open-default">Open</button></div>`;
    $('#art-open-default').onclick = () => api.openArtifact(d.path).catch(() => {});
    return;
  }
  if (meta.kind === 'markdown' && a.mode === 'rendered') return renderMarkdownDoc(body, d.text, notice);
  if (meta.kind === 'markdown') { body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`; return; }
  if (meta.kind === 'json') { body.innerHTML = `${notice}<pre class="art-code json">${renderJsonText(d.text, /\.jsonl$/i.test(d.path))}</pre>`; return; }
  if (meta.kind === 'table') { body.innerHTML = `${notice}${renderDelimited(d.text, /\.csv$/i.test(d.path) ? ',' : '\t')}`; return; }
  body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`;
}

function renderMarkdownDoc(body, text, notice) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    body.innerHTML = `${notice}<pre class="art-code">${esc(text)}</pre>`;
    return;
  }
  body.innerHTML = `${notice}<div class="md-wrap"><nav class="md-toc hidden"></nav><article class="md"></article></div>`;
  const doc = body.querySelector('.md');
  doc.innerHTML = markdownHtml(text);
  const used = new Set();
  const heads = [...doc.querySelectorAll('h1, h2, h3, h4')];
  heads.forEach((h) => {
    let id = slugify(h.textContent) || 'section';
    for (let i = 2; used.has(id); i++) id = `${slugify(h.textContent)}-${i}`;
    used.add(id);
    h.id = id;
  });
  const scrollTo = (id) => { const el = doc.querySelector(`[id="${CSS.escape(id)}"]`); if (el) body.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' }); };
  doc.addEventListener('click', (e) => {
    const link = e.target.closest('a[href^="#"]');
    if (!link) return;
    e.preventDefault();
    scrollTo(decodeURIComponent(link.getAttribute('href').slice(1)));
  });
  const tocItems = heads.filter((h) => h.tagName === 'H2' || h.tagName === 'H3');
  if (heads.length >= 4 && tocItems.length) {
    const toc = body.querySelector('.md-toc');
    toc.classList.remove('hidden');
    toc.innerHTML = `<div class="md-toc-title">Contents</div>${tocItems.map((h) =>
      `<a href="#" class="${h.tagName === 'H3' ? 'sub' : ''}" data-id="${esc(h.id)}">${esc(h.textContent)}</a>`).join('')}`;
    toc.querySelectorAll('[data-id]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); scrollTo(l.dataset.id); }));
  }
}

registerView({
  id: 'artifacts',
  nav: { label: 'Artifacts', order: 50, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>' },
  markup: `
      <section id="view-artifacts" class="view hidden">
        <div class="art-layout">
          <aside class="art-side">
            <div class="art-side-head">
              <div class="row">
                <h1>Artifacts</h1>
                <span class="spacer"></span>
                <button id="btn-art-refresh" class="btn sm ghost" title="Reload the list">Refresh</button>
              </div>
              <select id="art-project" aria-label="Project"></select>
              <input type="text" id="art-search" placeholder="Search files, workflows, tasks…" aria-label="Search" />
        <!-- Collapse all / Expand all the run groups (#126): label, icon and state set by renderArtifactList -->
        <button type="button" id="art-toggle-all" class="btn sm ghost btn-icon art-toggle-all" aria-pressed="false">
          <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="18 15 12 9 6 15" /></svg>
          <span>Collapse all</span>
        </button>
              <label class="check small dev-only"><input type="checkbox" id="art-show-sim" /><span>Show simulated</span></label>
            </div>
            <p id="art-error" class="error small"></p>
            <div id="art-list" class="art-list"></div>
          </aside>
          <section class="art-viewer">
            <div id="art-toolbar" class="art-toolbar hidden"></div>
            <div id="art-body" class="art-body">
              <div class="art-empty muted">Select a file to preview it.</div>
            </div>
          </section>
        </div>
      </section>`,
  mount() {
    $('#btn-art-refresh').onclick = () => loadArtifacts();
    $('#art-project').onchange = (e) => { state.art.projectId = e.target.value; renderArtifactList(); };
    $('#art-search').oninput = (e) => { state.art.q = e.target.value; renderArtifactList(); };
    $('#art-toggle-all').onclick = toggleAllArtGroups;
    $('#art-show-sim').onchange = (e) => { state.art.showSim = e.target.checked; renderArtifactList(); };
  },
  show() {
    renderArtifacts();
    loadArtifacts();
  },
});
