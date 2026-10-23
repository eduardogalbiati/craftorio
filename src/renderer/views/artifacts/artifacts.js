/* global api */
// Artifacts screen (#254: a tab of Workflows › Runs, no menu entry of its own): the documents and files the runs produced, grouped per run (filter by project and
// text, simulated runs in developer mode, collapse all), and the viewer (markdown with its table of
// contents, JSON, tables, images, text; the copy menu is artifact-menu.js). openArtifactsAt (the deep
// link from run lists, the Artifacts panel and the supervisor), loadArtifacts, loadArtifactsThrottled
// (run events) and renderArtifactList (developer mode) stay globals for app.js and the shared modules.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, ART_KIND, artKindIcon, fmtSize, markdownHtml, sanitizeHtml, slugify, renderJsonText,
// renderDelimited), run-list.js (ART_PAGE) and window.ArtifactMenu / window.ArtifactsPanel.
//
// Lazily loaded (#200): the list is the runs that produced files, with their counts, filtered by the
// service (project, search, simulated); a run's files load when its group opens (artifacts:list
// { runId }), ART_PAGE at a time, what the run produced first (#225): grouped by category, with the
// Artifacts panel's Produced / Show all switch and chips (one filter for the screen); a screenshot
// is named by its caption (the run's evidence manifest) and opens the viewer with the group's images. A search brings the first matching files of each
// matching run along. state.art.files: run id → { status: loading | ok | error, files, total, count, q, shown }.

let artLoading = null;
let artLastLoad = 0;
let artTimer = null;
let artSeq = 0;
function loadArtifacts() {
  const a = state.art;
  const seq = ++artSeq;
  const q = a.q.trim();
  artLoading = (async () => {
    try {
      const [res, projects] = await Promise.all([
        api.listArtifacts({ summary: true, projectId: a.projectId || undefined, q: q || undefined, showSim: artShowSim() }),
        state.projects.length ? state.projects : api.listProjects(),
      ]);
      if (seq !== artSeq) return;
      a.runs = res.runs || [];
      a.hiddenSim = res.hiddenSim || 0;
      a.loadedQ = q;
      state.projects = projects;
      a.error = null;
      // a run's files load again when its count or the search changed; a search seeds them
      a.files ||= new Map();
      for (const r of a.runs) {
        const e = a.files.get(r.runId);
        if (e && !e.pending && (e.count !== r.artifactCount || e.q !== q)) a.files.delete(r.runId);
        if (q && r.artifacts && !a.files.has(r.runId)) a.files.set(r.runId, { status: 'ok', files: r.artifacts, total: r.matchCount || r.artifacts.length, count: r.artifactCount, q, shown: ART_PAGE });
      }
    } catch (e) {
      if (seq !== artSeq) return;
      a.error = errMsg(e);
    }
    artLoading = null;
    artLastLoad = Date.now();
    if (state.view === 'artifacts') renderArtifacts();
  })();
  return artLoading;
}

// One run's files (all, or those matching the search the list was loaded with), then its evidence
// manifest (screenshot captions and pairs, #225), once.
function ensureArtFiles(r) {
  const a = state.art;
  a.files ||= new Map();
  const cur = a.files.get(r.runId);
  if (cur) {
    if (cur.status === 'ok' && cur.evidence === undefined && api.runEvidence) {
      cur.evidence = null;
      api.runEvidence(r.runId).then((ev) => {
        cur.evidence = ev || null;
        if (ev?.images?.length && a.files.get(r.runId) === cur && state.view === 'artifacts') renderArtifactList();
      }, () => {});
    }
    return;
  }
  const entry = { status: 'loading', files: [], total: 0, count: r.artifactCount, q: a.loadedQ || '', shown: ART_PAGE, error: null };
  a.files.set(r.runId, entry);
  fetchArtFiles(r.runId, entry);
}
function fetchArtFiles(runId, entry) {
  entry.pending = true;
  api.listArtifacts({ runId, q: entry.q || undefined })
    .then(([x] = []) => { entry.files = x?.artifacts || []; entry.total = entry.files.length; entry.status = 'ok'; }, (e) => { entry.status = 'error'; entry.error = errMsg(e); })
    .finally(() => { entry.pending = false; if (state.art.files.get(runId) === entry && state.view === 'artifacts') renderArtifactList(); });
}

// The run a path belongs to when it is inside the workspace's runs folder (a deep link without its run).
function runIdOfPath(p) {
  const base = String(state.ws?.runs || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const file = String(p || '').replace(/\\/g, '/');
  if (!base || !file.toLowerCase().startsWith(`${base}/`)) return null;
  return file.slice(base.length + 1).split('/')[0] || null;
}

function loadArtifactsThrottled() {
  if (artTimer || state.view !== 'artifacts') return;
  const wait = Math.max(0, 2000 - (Date.now() - artLastLoad));
  artTimer = setTimeout(() => { artTimer = null; if (state.view === 'artifacts') loadArtifacts(); }, wait);
}

// Opens the Artifacts view focused on one file (from the project view).
function openArtifactsAt({ projectId, runId, path, mock }) {
  const a = state.art;
  a.projectId = projectId || '';
  a.q = '';
  if (mock) a.showSim = true;
  a.reveal = runId || runIdOfPath(path); // opens the file's group once the list has its run
  showView('artifacts');
  selectArtifact(path);
}

function renderArtifacts() {
  const a = state.art;
  const sel = $('#art-project');
  sel.innerHTML = `<option value="">${t('artifacts.all_projects')}</option>${state.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
  sel.value = a.projectId;
  if (sel.value !== a.projectId) a.projectId = '';
  $('#art-search').value = a.q;
  $('#art-show-sim').checked = a.showSim;
  $('#art-error').textContent = a.error ? t('artifacts.could_not_load_artifacts_error', { error: a.error }) : '';
  renderArtifactList();
  renderArtifactViewer();
}

// Simulated runs only exist for developer mode: without it they are never listed nor counted.
const artShowSim = () => devMode() && state.art.showSim;

// The listed runs: the service already applied the project, the search and the simulated filter.
function artifactRunsFiltered() {
  return state.art.runs || [];
}

// a screenshot of the run's evidence manifest leads with its caption, the file name under it
function artFileHtml(f) {
  const a = state.art;
  const caption = f.caption || '';
  const where = `${esc(f.rel || '')}${f.step ? ` · ${esc(f.step)}${f.agent ? ` · ${esc(f.agent)}` : ''}` : f.agent ? ` · ${esc(f.agent)}` : ''}`;
  return `
        <button class="art-file ${a.sel === f.path ? 'active' : ''} ${f.exists ? '' : 'missing'}" data-testid="artifact-item" data-path="${esc(f.path)}" title="${esc(f.path)}">
          ${artKindIcon(f.kind)}
          <span class="art-file-main">
            <span class="art-file-name">${esc(caption || f.name)}${f.location === 'external' ? ` <span class="badge">${t('artifacts.project_copy')}</span>` : ''}${f.exists ? '' : ` <span class="badge">${t('artifacts.deleted')}</span>`}</span>
            <span class="art-file-sub muted">${caption ? `${esc(f.name)} · ` : ''}${where}</span>
          </span>
          <span class="art-file-size muted">${esc(fmtSize(f.size))}</span>
        </button>`;
}

// An open group's files: loading, error (Retry), or what the run produced first, grouped by category
// (the panel's switch and chips; state.art.filter, one for the screen), with "Show more".
function artFilesHtml(e) {
  if (!e || e.status === 'loading') return `<p class="muted small art-pad">${t('artifacts.loading')}</p>`;
  if (e.status === 'error') return `<p class="error small art-pad">${t('artifacts.could_not_load_the_files')} ${esc(e.error)} <button type="button" class="btn sm ghost" data-art-retry>${t('artifacts.retry')}</button></p>`;
  const filter = (state.art.filter ||= ArtifactsPanel.newFilter());
  const all = ArtifactsPanel.filterFiles(e.files, filter, { ignoreCategory: true });
  const files = ArtifactsPanel.filterFiles(e.files, filter);
  const shown = files.slice(0, e.shown);
  // the filtered files not shown yet, plus those the service has not sent (a search's first matches)
  const left = Math.max(0, files.length - shown.length) + Math.max(0, e.total - e.files.length);
  const count = (list, fn) => list.reduce((acc, f) => { acc[fn(f)] = (acc[fn(f)] || 0) + 1; return acc; }, {});
  const kindOfChip = (f) => (['image', 'markdown', 'json'].includes(f.kind) ? f.kind : /\.log$/i.test(f.name || '') ? 'log' : 'other');
  const groups = ArtifactsPanel.CATEGORIES.map(([id, label]) => [label, shown.filter((f) => ArtifactsPanel.categoryOf(f) === id)]).filter(([, list]) => list.length);
  const body = groups.length
    ? groups.map(([label, list]) => `<div class="art-step muted" data-testid="artifact-category-title">${esc(label)} · ${list.length}</div>${list.map((f) => artFileHtml(e.evidence ? { ...f, caption: ArtifactsPanel.captionOf(e.evidence, f.path) } : f)).join('')}`).join('')
    : `<p class="muted small art-pad">${filter.show === 'produced' && !filter.category && !filter.kind ? t('artifacts.nothing_produced_show_all_lists_the') : t('artifacts.nothing_matches_this_filter')}</p>`;
  return `<div class="art-files" data-testid="artifact-list">${ArtifactsPanel.filtersHtml(filter, count(all, ArtifactsPanel.categoryOf), count(ArtifactsPanel.filterFiles(e.files, { ...filter, kind: null }, { ignoreCategory: true }), kindOfChip))}${body}`
    + (left > 0 ? `<button type="button" class="btn sm ghost art-more" data-art-more ${e.pending ? 'disabled' : ''}>${e.pending ? t('artifacts.loading') : `Show ${Math.min(left, ART_PAGE)} more${left > ART_PAGE ? ` <span class="muted">${t('artifacts.left_left', { left })}</span>` : ''}`}</button>` : '')
    + '</div>';
}

function renderArtifactList() {
  const a = state.art;
  const box = $('#art-list');
  if (a.runs == null) { box.innerHTML = a.error ? '' : `<p class="muted small art-pad">${t('artifacts.loading')}</p>`; paintArtToggleAll([], false); return; }
  const runs = artifactRunsFiltered();
  const hiddenSim = devMode() ? a.hiddenSim || 0 : 0;
  const filtered = !!(a.loadedQ || a.projectId);
  if (!runs.length) {
    paintArtToggleAll([], false);
    box.innerHTML = `<div class="art-pad muted small">${filtered ? t('artifacts.no_artifacts_match_these_filters') : t('artifacts.no_run_has_produced_documents_or')}${hiddenSim ? `<br>${t('artifacts.simulated_runs_hidden', { count: hiddenSim })}` : ''}</div>`;
    return;
  }
  if (a.reveal && runs.some((r) => r.runId === a.reveal)) { setArtGroupOpen(a.reveal, true); a.reveal = null; }
  const searching = !!a.loadedQ;
  box.innerHTML = runs.map((r, i) => {
    const open = searching || artGroupOpen(r.runId, i === 0);
    if (open) ensureArtFiles(r);
    const files = searching ? t('artifacts.matching_files_count', { matched: r.matchCount, count: r.artifactCount }) : t('artifacts.files_count', { count: r.artifactCount });
    return `
    <div class="art-run ${open ? 'open' : ''}" data-run="${esc(r.runId)}">
      <button class="art-run-head" title="${esc(r.task || '')}" aria-expanded="${open}">
        <div class="row"><span class="art-chev" aria-hidden="true">${open ? '▾' : '▸'}</span><b class="art-run-name">${esc(r.workflow || 'workflow')}</b>${StatusPill.statusPill(r.status)}${r.mock ? `<span class="badge p-mock">${t('artifacts.simulated')}</span>` : ''}</div>
        <div class="muted small art-run-sub">${r.project ? `${esc(r.project.name)} · ` : ''}${r.startedAt ? esc(dateOf(r.startedAt)) : ''} · ${files}${r.imageCount ? t('artifacts.images_count', { count: r.imageCount }) : ''}</div>
      </button>
      ${open ? artFilesHtml(a.files.get(r.runId)) : ''}
    </div>`;
  }).join('') + (hiddenSim ? `<p class="muted small art-pad">${t('artifacts.simulated_runs_hidden', { count: hiddenSim })}</p>` : '');
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
  box.querySelectorAll('[data-art-more]').forEach((b) => (b.onclick = () => {
    const runId = b.closest('.art-run').dataset.run;
    const e = a.files.get(runId);
    if (!e) return;
    e.shown += ART_PAGE;
    // a search brought only the first matches: the rest come now
    if (e.files.length < e.total) fetchArtFiles(runId, e);
    renderArtifactList();
  }));
  // Produced / Show all and the chips (#225): one filter for every run group of the screen
  box.querySelectorAll('[data-artifact-filter], [data-artifact-category], [data-artifact-kind]').forEach((b) => (b.onclick = () => {
    if (ArtifactsPanel.onFilterClick(state.art.filter ||= ArtifactsPanel.newFilter(), b)) renderArtifactList();
  }));
  box.querySelectorAll('[data-art-retry]').forEach((b) => (b.onclick = () => {
    a.files.delete(b.closest('.art-run').dataset.run);
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
  b.title = searching ? t('artifacts.groups_are_open_while_searching') : anyOpen ? t('artifacts.close_every_run_group') : t('artifacts.open_every_run_group');
  b.setAttribute('aria-label', t('artifacts.label_run_groups', { label }));
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
  // Forget runs that no longer have artifacts so the stored map doesn't grow forever (only from the
  // unfiltered list: a filter hides runs that still have them).
  if (state.art.runs && !state.art.loadedQ && !state.art.projectId) {
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
  for (const e of state.art.files?.values() || []) for (const f of e.files || []) if (f.path === path) return f;
  return null;
}

// The run whose loaded files include `path`, else the run of its folder.
function artifactRunOf(path) {
  for (const [runId, e] of state.art.files || []) if ((e.files || []).some((f) => f.path === path)) return runId;
  return runIdOfPath(path);
}

function renderArtifactViewer() {
  const a = state.art;
  const bar = $('#art-toolbar');
  const body = $('#art-body');
  const d = a.doc;
  if (!d) {
    bar.classList.add('hidden');
    body.innerHTML = `<div class="art-empty muted">${t('artifacts.select_a_file_to_preview_it')}</div>`;
    return;
  }
  const meta = { ...(findArtifactMeta(d.path) || {}), ...d };
  const name = meta.name || d.path.split(/[\\/]/).pop();
  // a kind the index does not know (an agent's summary.cmd) is never opened with its default
  // program, only shown in its folder (#477; main.js refuses programs too, src/open-guard.js)
  const openable = meta.kind !== 'other';
  const missing = meta.exists === false ? 'disabled' : '';
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="art-title">
      ${artKindIcon(meta.kind)}
      <div class="art-title-text"><b>${esc(name)}</b><span class="mono muted art-path" title="${esc(d.path)}">${esc(d.path)}</span></div>
    </div>
    ${meta.kind === 'markdown' && d.text != null ? `<div class="seg sm"><button type="button" data-mode="rendered" class="${a.mode === 'rendered' ? 'active' : ''}">${t('artifacts.rendered')}</button><button type="button" data-mode="source" class="${a.mode === 'source' ? 'active' : ''}">${t('artifacts.source')}</button></div>` : ''}
    <div class="row">
      ${openable ? `<button class="btn sm ghost" data-art-act="open" ${missing}>${t('artifacts.open')}</button>` : ''}
      <button class="btn sm ghost" data-art-act="reveal" ${missing}>${t('artifacts.show_in_folder')}</button>
      <button class="btn sm ghost" data-art-act="copy">${t('artifacts.copy_path')}</button>
    </div>
    <span class="muted small art-msg"></span>`;
  bar.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { a.mode = b.dataset.mode; renderArtifactViewer(); }));
  bar.querySelectorAll('[data-art-act]').forEach((b) => (b.onclick = async () => {
    const msg = bar.querySelector('.art-msg');
    try {
      if (b.dataset.artAct === 'open') { const err = await api.openArtifact(d.path); if (err) throw new Error(err); }
      if (b.dataset.artAct === 'reveal') await api.openArtifact(d.path, true);
      if (b.dataset.artAct === 'copy') { await api.clipboardWrite(d.path); msg.textContent = t('artifacts.path_copied'); }
    } catch (e) {
      msg.textContent = errMsg(e);
    }
  }));

  body.scrollTop = 0;
  if (d.loading) { body.innerHTML = `<div class="art-empty muted">${t('artifacts.loading')}</div>`; return; }
  if (d.error) { body.innerHTML = `<div class="art-empty"><p class="error">${esc(d.error)}</p></div>`; return; }
  const notice = d.truncated ? `<div class="art-notice">${t('artifacts.this_file_is_larger_than_5')}</div>` : '';
  if (meta.kind === 'image' && d.image) {
    body.innerHTML = `<div class="art-image"><img ${ImageViewer.THUMB} src="${esc(d.image)}" alt="${esc(name)}" /></div>`;
    const img = body.querySelector('.art-image img');
    img.oncontextmenu = (e) => ArtifactMenu.open(e, { path: d.path, name, image: true });
    // the shared viewer (#145), with the screenshot's original/modified pair when it has one (#146),
    // and every image of its run group as listed (#182)
    const runId = artifactRunOf(d.path);
    const files = [...document.querySelectorAll(`#art-list .art-run[data-run="${CSS.escape(runId || '')}"] .art-file`)]
      .map((b) => b.dataset.path).filter((p) => findArtifactMeta(p)?.kind === 'image');
    img.onclick = () => ArtifactsPanel.openImage({ runId, file: d.path, src: d.image, title: name, files });
    img.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); img.click(); } };
    return;
  }
  if (!openable) {
    body.innerHTML = `${notice}<div class="art-empty"><p class="muted">${t('artifacts.preview_not_available_for_this_file')}</p></div>`;
    return;
  }
  if (d.binary || d.text == null) {
    body.innerHTML = `${notice}<div class="art-empty"><p class="muted">${t('artifacts.preview_not_available_for_this_file')}</p><button class="btn primary" id="art-open-default">${t('artifacts.open')}</button></div>`;
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
    toc.innerHTML = `<div class="md-toc-title">${t('artifacts.contents')}</div>${tocItems.map((h) =>
      `<a href="#" class="${h.tagName === 'H3' ? 'sub' : ''}" data-id="${esc(h.id)}">${esc(h.textContent)}</a>`).join('')}`;
    toc.querySelectorAll('[data-id]').forEach((l) => (l.onclick = (e) => { e.preventDefault(); scrollTo(l.dataset.id); }));
  }
}

registerView({
  id: 'artifacts',
  // #254: a tab of Workflows › Runs (no menu entry of its own: Runs stays lit)
  menu: 'workflows',
  markup: () => `
      <section id="view-artifacts" class="view hidden">
        <div class="art-layout">
          <aside class="art-side">
            <div class="art-side-head">
              <div class="seg sm art-tabs" role="tablist" aria-label="${t('artifacts.runs')}">
                <button type="button" role="tab" id="art-tab-runs" aria-selected="false" title="${t('artifacts.every_run_live_or_finished')}">${t('artifacts.all_runs')}</button>
                <button type="button" class="active" role="tab" aria-selected="true">${t('artifacts.artifacts')}</button>
              </div>
              <div class="row">
                <h1>${t('artifacts.artifacts')}</h1>
                <span class="spacer"></span>
                <button id="btn-art-refresh" class="btn sm ghost" title="${t('artifacts.reload_the_list')}">${t('artifacts.refresh')}</button>
              </div>
              <select id="art-project" aria-label="${t('artifacts.project')}"></select>
              <input type="text" id="art-search" placeholder="${t('artifacts.search_files_workflows_tasks')}" aria-label="${t('artifacts.search')}" />
        <!-- Collapse all / Expand all the run groups (#126): label, icon and state set by renderArtifactList -->
        <button type="button" id="art-toggle-all" class="btn sm ghost btn-icon art-toggle-all" aria-pressed="false">
          <svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="18 15 12 9 6 15" /></svg>
          <span>${t('artifacts.collapse_all')}</span>
        </button>
              <label class="check small dev-only"><input type="checkbox" id="art-show-sim" /><span>${t('artifacts.show_simulated')}</span></label>
            </div>
            <p id="art-error" class="error small"></p>
            <div id="art-list" class="art-list"></div>
          </aside>
          <section class="art-viewer" data-testid="artifact-viewer">
            <div id="art-toolbar" class="art-toolbar hidden"></div>
            <div id="art-body" class="art-body">
              <div class="art-empty muted">${t('artifacts.select_a_file_to_preview_it')}</div>
            </div>
          </section>
        </div>
      </section>`,
  mount() {
    $('#art-tab-runs').onclick = () => showWorkflowsTab('runs');
    $('#btn-art-refresh').onclick = () => loadArtifacts();
    $('#art-project').onchange = (e) => { state.art.projectId = e.target.value; loadArtifacts(); };
    // the service searches every run's files (#200): asked once the typing pauses
    let searchTimer = null;
    $('#art-search').oninput = (e) => {
      state.art.q = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(loadArtifacts, 250);
    };
    $('#art-toggle-all').onclick = toggleAllArtGroups;
    $('#art-show-sim').onchange = (e) => { state.art.showSim = e.target.checked; loadArtifacts(); };
  },
  show() {
    // the menu's Runs entry stays lit, wherever the screen was opened from
    state.workflowsTab = 'runs';
    renderArtifacts();
    loadArtifacts();
  },
});
