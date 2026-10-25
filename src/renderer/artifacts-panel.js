// Artifacts panel: one run's artifacts as a list with an in-place preview, the same source as the
// Artifacts screen (artifacts:list → runArtifacts in src/domains/run/runs.js). One component for the Run
// screen's Artifacts tab (#109) and the approval gate's side panel (#108):
// - what the run produced first (#225): every file has a category (src/domains/evidence/artifact-categories.js);
//   the list opens on "Produced" (Result, Screenshots & images, Tests, Reports), grouped by category,
//   newest first in a category; "Show all" adds Process (handoff notes, decisions, logs); Internal
//   files are never listed ("Open run folder" shows them). Chips narrow it to one category or one
//   kind (image, markdown, JSON, log). `flat: true` lists them newest first without groups (the gate);
// - the run's screenshots lead their category (#146, artifacts:evidence → src/domains/evidence/evidence.js): the final
//   set by issue, each original/modified pair side by side ("Original (main)", "Modified (<branch>
//   @<sha>)") with its caption, older rounds and steps in a collapsed History; "No screenshots in
//   this run"; a legacy run (screenshots/ + screenshots.json) shows as one set. A screen whose
//   original side matched nothing (#185, an element the change adds) shows its modified image alone,
//   marked "new element (no original)"; the screenshots step's summary and its real errors above;
// - a click previews the file without leaving the screen: markdown rendered, images (with their pair
//   when the evidence manifest has one), TSV as a table, JSON and text as text; "Open in Artifacts"
//   goes to the full screen at that file (openArtifactsAt in app.js);
// - every image opens on click (or Enter) in the shared image viewer (image-viewer.js, #145) with the
//   whole context (#182): every screen shown in the panel, in order, a pair as one item;
//   ArtifactsPanel.openImage does the same for the Artifacts screen (the images of its run group);
// - right-click (or Shift+F10) on a file or an open image: the copy menu (artifact-menu.js, #114);
// - extras (the gate): changed files (a click opens that file's diff) and notes (the developer's
//   test_notes / evidence_plan), shown above the files; the gate right after a screenshots step
//   (extras.capture, #144) leads with that step's latest round only, its failed captures, the other
//   rounds in History, or "No screenshots: <reason>";
// - live: ArtifactsPanel.refreshRun(runId) reloads every mounted panel of that run (app.js calls
//   it on file.saved, handoff.saved, decision.logged, step.finished, workflow.finished).
// The Artifacts screen reuses the filter (filtersHtml, filterFiles, onFilterClick, CATEGORIES).
// Uses app.js's helpers (esc, api, artKindIcon, fmtSize, markdownHtml, renderJsonText,
// renderDelimited, errMsg, openArtifactsAt, dateOf) and ImageViewer.
(() => {
  // #225: the categories in their order (the service gives each file its `category`)
  // [id, label]: the label read in the interface language each time (a getter at index 1)
  const labelled = (id, key) => Object.defineProperty([id], 1, { get: () => t(key), enumerable: true });
  const CATEGORIES = [
    labelled('result', 'artifacts_panel.category_result'),
    labelled('screenshots', 'artifacts_panel.category_screenshots'),
    labelled('tests', 'artifacts_panel.category_tests'),
    labelled('reports', 'artifacts_panel.category_reports'),
    labelled('process', 'artifacts_panel.category_process'),
  ];
  const PRODUCED = new Set(['result', 'screenshots', 'tests', 'reports']);
  const KINDS = [
    labelled('image', 'artifacts_panel.kind_images'),
    ['markdown', 'Markdown'],
    ['json', 'JSON'],
    labelled('log', 'artifacts_panel.kind_logs'),
  ];
  const panels = new Set();
  const lists = new Map(); // runId -> { run, files, evidence, at } (the last listing)
  const thumbs = new Map(); // <file>|<captured_at> -> data URL (screenshots, read once)
  const slash = (p) => String(p || '').replace(/\\/g, '/');
  const dirOf = (p) => slash(p).replace(/\/[^/]*$/, '');
  const baseOf = (p) => slash(p).split('/').pop();
  const sideWord = (side) => (side === 'original' ? t('artifacts_panel.side_original') : side === 'modified' ? t('artifacts_panel.side_modified') : side);

  function groupOf(f) {
    const rel = slash(f.rel || f.name);
    if (/(^|\/)handoffs\//i.test(rel)) return 'handoffs';
    if (/(^|\/)decisions\.tsv$/i.test(rel)) return 'decisions';
    if (f.kind === 'image' || /(^|\/)(screenshots|evidence)\//i.test(rel)) return 'evidence';
    if (f.kind === 'markdown' || f.location === 'external') return 'documents';
    return 'other';
  }
  const newest = (a, b) => String(b.mtime || '').localeCompare(String(a.mtime || ''));

  // ---------------------------------------------------------------- filter (#225)
  // a file's category (a listing without one, from an older service: guessed from its group)
  function categoryOf(f) {
    if (f.category) return f.category;
    const g = groupOf(f);
    return g === 'evidence' ? 'screenshots' : g === 'documents' ? 'reports' : 'process';
  }
  // the kind a chip filters on: image, markdown, json, log or other
  const chipKindOf = (f) => (['image', 'markdown', 'json'].includes(f.kind) ? f.kind : /\.log$/i.test(f.name || f.path || '') ? 'log' : 'other');
  const newFilter = () => ({ show: 'produced', category: null, kind: null });
  const inView = (filter, cat) => cat !== 'internal' && (PRODUCED.has(cat) || (filter.show === 'all' && cat === 'process'));

  /** The files a filter shows ({ show, category, kind }), in their category order (stable inside one). */
  function filterFiles(files, filter, { ignoreCategory = false } = {}) {
    const rank = (f) => CATEGORIES.findIndex(([id]) => id === categoryOf(f));
    return (files || [])
      .filter((f) => inView(filter, categoryOf(f)) && (ignoreCategory || !filter.category || categoryOf(f) === filter.category) && (!filter.kind || chipKindOf(f) === filter.kind))
      .map((f, i) => ({ f, i }))
      .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
      .map(({ f }) => f);
  }

  /**
   * The Produced / Show all switch and the chips. counts: { [category]: n } of the current view (a
   * chip per category present), kinds: { [kind]: n } (a chip per kind present).
   */
  function filtersHtml(filter, counts = {}, kinds = {}) {
    const view = (id, label, title) => `<button type="button" class="${filter.show === id ? 'active' : ''}" data-artifact-filter="${id}" aria-pressed="${filter.show === id}" title="${esc(title)}">${label}</button>`;
    const chip = (attr, id, label, n, on) => `<button type="button" class="chip${on ? ' active' : ''}" data-artifact-${attr}="${id}" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(on ? t('artifacts_panel.show_every_attr', { attr }) : t('artifacts_panel.only_label', { label }))}">${esc(label)} <span class="muted">${n}</span></button>`;
    const cats = CATEGORIES.filter(([id]) => counts[id] || filter.category === id).map(([id, label]) => chip('category', id, label, counts[id] || 0, filter.category === id));
    const kindChips = KINDS.filter(([id]) => kinds[id] || filter.kind === id).map(([id, label]) => chip('kind', id, label, kinds[id] || 0, filter.kind === id));
    return `<div class="ap-filters">
      <div class="seg sm" role="group" aria-label="${t('artifacts_panel.artifacts_view')}">${view('produced', t('artifacts_panel.produced'), t('artifacts_panel.produced_title'))}${view('all', t('artifacts_panel.show_all'), t('artifacts_panel.show_all_title'))}</div>
      ${cats.length ? `<div class="ap-chips" role="group" aria-label="${t('artifacts_panel.filter_by_category')}">${cats.join('')}</div>` : ''}
      ${kindChips.length > 1 || filter.kind ? `<div class="ap-chips" role="group" aria-label="${t('artifacts_panel.filter_by_kind')}">${kindChips.join('')}</div>` : ''}
    </div>`;
  }

  /** A click on the switch or a chip changes `filter` (true) or not (false). */
  function onFilterClick(filter, t) {
    const view = t.closest('[data-artifact-filter]');
    if (view) {
      filter.show = view.dataset.artifactFilter === 'all' ? 'all' : 'produced';
      if (filter.category && !inView(filter, filter.category)) filter.category = null;
      return true;
    }
    const cat = t.closest('[data-artifact-category]');
    if (cat) { const id = cat.dataset.artifactCategory; filter.category = filter.category === id ? null : id; return true; }
    const kind = t.closest('[data-artifact-kind]');
    if (kind) { const id = kind.dataset.artifactKind; filter.kind = filter.kind === id ? null : id; return true; }
    return false;
  }

  const countBy = (files, fn) => files.reduce((acc, f) => { acc[fn(f)] = (acc[fn(f)] || 0) + 1; return acc; }, {});

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
      root, runId: null, flat: !!opts.flat, extras: opts.extras || null, onCount: opts.onCount || null, stepNames: opts.stepNames || null,
      files: null, run: null, evidence: undefined, error: null, sel: null, doc: null, seq: 0, historyOpen: false,
      filter: newFilter(), context: [],
      setRun(runId) {
        if (runId === p.runId) return;
        p.runId = runId || null;
        p.sel = null; p.doc = null; p.files = null; p.run = null; p.evidence = undefined; p.historyOpen = false;
        p.filter = newFilter();
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
    // #245: the step and agent by their readable names (ids in the title's path); a bare path is code
    const who = window.displayName ? [f.step, f.agent].filter(Boolean).map((x) => window.displayName(x)).join(' · ') : [f.step, f.agent].filter(Boolean).join(' · ');
    return `<button type="button" class="ap-file${f.exists === false ? ' missing' : ''}" data-testid="artifact-item" data-ap-file="${esc(f.path)}" title="${esc(f.path)}">
      ${artKindIcon(f.kind)}
      <span class="ap-file-main"><span class="ap-file-name">${esc(f.name)}${f.location === 'external' ? ` <span class="badge">${t('artifacts_panel.project_copy')}</span>` : ''}${f.exists === false ? ` <span class="badge">${t('artifacts_panel.deleted')}</span>` : ''}</span>
      <span class="ap-file-sub muted">${who ? esc(who) : `<code>${esc(slash(f.rel || ''))}</code>`}</span></span>
      <span class="ap-file-size muted">${esc(fmtSize(f.size))}</span></button>`;
  }

  function extrasHtml(x) {
    if (!x) return '';
    const out = [];
    if (x.changes) {
      const list = Array.isArray(x.changes) ? x.changes : [];
      // changesReported: no git diff (a simulated run has no worktree, #115), the developer's files_changed
      const reported = x.changesReported || null;
      const label = reported === 'simulated' ? t('artifacts_panel.changes_simulated') : t('artifacts_panel.changes_reported');
      out.push(`<div class="ap-group"><div class="ap-group-head">${t('artifacts_panel.changed_files')}${list.length ? ` <span class="muted">${list.length}</span>` : ''}${reported ? ` <span class="badge" title="${t('artifacts_panel.no_git_diff_for_this_run')}">${label}</span>` : ''}</div>
        ${typeof x.changes === 'string' ? `<p class="muted small ap-pad">${esc(x.changes)}</p>` : !list.length ? `<p class="muted small ap-pad">${reported ? t('artifacts_panel.the_developer_reported_no_changed_files') : t('artifacts_panel.no_changes_against_the_base')}</p>`
    : list.map((c) => {
      const main = `<span class="ap-file-main"><span class="ap-file-name mono">${esc(baseOf(c.file))}</span><span class="ap-file-sub muted mono">${esc(dirOf(c.file) === slash(c.file) ? '' : dirOf(c.file))}</span></span>`;
      if (reported) return `<div class="ap-file ap-change ap-reported" title="${esc(c.file)}">${main}<span class="ap-file-size muted">${label}</span></div>`;
      return `<button type="button" class="ap-file ap-change" data-ap-change="${esc(c.file)}" title="${t('artifacts_panel.show_the_diff_of_file', { file: esc(c.file) })}">${main}
            <span class="ap-file-size">${c.added == null ? `<span class="muted">${t('artifacts_panel.binary')}</span>` : `<span class="ap-add">+${c.added}</span> <span class="ap-del">−${c.deleted}</span>`}</span></button>`;
    }).join('')}</div>`);
    }
    if (x.notes?.length) {
      out.push(`<div class="ap-group"><div class="ap-group-head">${t('artifacts_panel.from_the_developer')}</div>${x.notes.map((n, i) => `<button type="button" class="ap-file" data-ap-note="${i}">
        ${artKindIcon('markdown')}<span class="ap-file-main"><span class="ap-file-name">${esc(n.title)}</span><span class="ap-file-sub muted">${esc(String(n.text).split('\n')[0].slice(0, 90))}</span></span></button>`).join('')}</div>`);
    }
    return out.join('');
  }

  const listWrap = (html) => `<div class="ap-list" data-testid="artifact-list">${html}</div>`;

  function listHtml(p) {
    const head = `<div class="ap-head"><span class="muted small">${p.files ? t('artifacts_panel.artifacts_count', { count: p.files.length }) : ''}</span>
      <span class="row">${p.run?.runDir ? `<button type="button" class="btn sm ghost" data-ap-folder title="${t('artifacts_panel.the_run_s_whole_folder_its')}">${t('artifacts_panel.open_run_folder')}</button>` : ''}
      ${p.runId ? `<button type="button" class="btn sm ghost" data-ap-full title="${t('artifacts_panel.all_of_this_run_s_files')}">${t('artifacts_panel.open_in_artifacts')}</button>` : ''}</span></div>`;
    p.context = [];
    if (!p.runId) return `<p class="empty muted">${t('artifacts_panel.select_a_run_to_see_its')}</p>`;
    const extras = extrasHtml(p.extras);
    if (p.files == null) return listWrap(`${head}${extras}<p class="muted small ap-pad">${t('artifacts_panel.loading')}</p>`);
    const error = p.error ? `<p class="error small ap-pad">${t('artifacts_panel.could_not_load_artifacts')} ${esc(p.error)}</p>` : '';
    if (p.flat) return listWrap(flatHtml(p, head, extras, error));
    const shots = shotsHtml(p);
    if (!p.files.length) {
      return listWrap(`${head}${extras}${error}<div class="ap-empty"><b>${t('artifacts_panel.no_artifacts_yet')}</b><p class="muted small">${t('artifacts_panel.handoff_notes_the_decision_log_documents')}</p></div>`);
    }
    const f = p.filter;
    // the screenshots of the manifest show as cards; their files are not listed again
    const carded = new Set((p.evidence?.images || []).map((x) => slash(x.file)));
    const files = filterFiles(p.files, f, { ignoreCategory: true }).filter((x) => !carded.has(slash(x.path)));
    const showShots = !f.kind || f.kind === 'image';
    const counts = countBy(files, categoryOf);
    if (showShots && p.cards) counts.screenshots = (counts.screenshots || 0) + p.cards;
    const kinds = countBy(filterFiles(p.files, { ...f, kind: null }, { ignoreCategory: true }).filter((x) => !carded.has(slash(x.path))), chipKindOf);
    if (p.cards) kinds.image = (kinds.image || 0) + p.cards;
    const sections = CATEGORIES.filter(([id]) => inView(f, id) && (!f.category || f.category === id)).map(([id, label]) => {
      const list = files.filter((x) => categoryOf(x) === id).sort(newest);
      const withShots = id === 'screenshots' && showShots && (!f.category || f.category === id) && (p.cards || f.show === 'produced' || list.length);
      if (!list.length && !withShots) return '';
      const n = list.length + (withShots ? p.cards || 0 : 0);
      return `<div class="ap-group" data-category="${id}"><div class="ap-group-head" data-testid="artifact-category-title">${esc(label)} <span class="muted">${n}</span></div>${withShots ? shots : ''}${list.map(fileHtml).join('')}</div>`;
    }).join('');
    const empty = sections ? '' : `<div class="ap-empty"><b>${f.category || f.kind ? t('artifacts_panel.nothing_matches_this_filter') : t('artifacts_panel.nothing_produced_yet')}</b><p class="muted small">${f.show === 'produced' ? t('artifacts_panel.show_all_also_lists_the_handoff') : t('artifacts_panel.choose_another_chip_or_open_the')}</p></div>`;
    return listWrap(`${head}${extras}${error}${filtersHtml(f, counts, kinds)}${sections}${empty}`);
  }

  // The gate: the screenshots lead, then the changed files and the developer's notes, then the run's
  // files (Produced or all) newest first
  function flatHtml(p, head, extras, error) {
    const shots = shotsHtml(p);
    if (!p.files.length) {
      return `${head}${p.extras?.capture ? shots : ''}${extras}${error}<div class="ap-empty"><b>${t('artifacts_panel.no_artifacts_yet')}</b><p class="muted small">${t('artifacts_panel.handoff_notes_the_decision_log_documents')}</p></div>`;
    }
    const files = filterFiles(p.files, p.filter).sort(newest);
    const counts = countBy(filterFiles(p.files, p.filter, { ignoreCategory: true }), categoryOf);
    const kinds = countBy(filterFiles(p.files, { ...p.filter, kind: null }), chipKindOf);
    const list = files.length ? files.map(fileHtml).join('') : `<p class="muted small ap-pad">${p.filter.show === 'produced' ? t('artifacts_panel.nothing_produced_yet_show_all_lists') : t('artifacts_panel.nothing_matches_this_filter_2')}</p>`;
    return `${head}${shots}${extras}${error}<div class="ap-group">${extras || shots ? `<div class="ap-group-head">${t('artifacts_panel.run_files')}</div>` : ''}${filtersHtml(p.filter, counts, kinds)}${list}</div>`;
  }

  // ---------------------------------------------------------------- screenshots (#146)
  const SIDES = ['original', 'modified'];
  const tkey = (x) => `${x.file}|${x.captured_at || ''}`;
  const shortRef = (r) => String(r || '').replace(/^origin\//, '');
  const imageOf = (ev, file) => (ev?.images || []).find((x) => slash(x.file) === slash(file)) || null;

  // "Original (main)" / "Modified (<branch> @<short sha>)", the parts the manifest knows
  function sideLabel(ev, x) {
    if (x.side === 'original') return ev?.base ? t('artifacts_panel.original_ref', { ref: shortRef(ev.base) }) : t('artifacts_panel.original');
    const ref = [ev?.branch, x.commit ? `@${String(x.commit).slice(0, 7)}` : ''].filter(Boolean).join(' ');
    return ref ? t('artifacts_panel.modified_ref', { ref }) : t('artifacts_panel.modified');
  }

  // An image with its pair: { key, issue, caption, sides: { original?, modified? } }
  // (pairOk: which pair images may join it; default any)
  function shotOf(ev, x, pairOk = () => true) {
    const found = x.pair_file ? imageOf(ev, x.pair_file) : null;
    const pair = found && pairOk(found) ? found : null;
    const sides = { [x.side]: x };
    if (pair && !sides[pair.side]) sides[pair.side] = pair;
    return { key: x.key, issue: x.issue, caption: x.caption || pair?.caption || '', sides };
  }

  // The final set, one shot per name (an original kept from an earlier round included)
  const finalShots = (ev) => pairShots(ev, (ev?.images || []).filter((i) => i.final));

  // Images → one shot per name, each with its pair (pairOk: see shotOf; keyOf: what makes one shot)
  function pairShots(ev, images, pairOk, keyOf = (x) => x.key) {
    const shots = new Map();
    for (const x of images) {
      const s = shots.get(keyOf(x));
      if (!s) shots.set(keyOf(x), shotOf(ev, x, pairOk));
      else s.sides[x.side] = x;
    }
    return [...shots.values()];
  }

  // The screenshots step's outcome for these shots (#185): extras.capture (the gate), else the
  // manifest's record of the final round
  function captureFor(p, ev) {
    if (p.extras?.capture) return p.extras.capture;
    const caps = ev?.captures || [];
    if (!caps.length || !ev.final) return null;
    return caps.find((c) => c.step === ev.final.step && c.round === ev.final.round) || null;
  }
  const newElementKeys = (cap) => new Set((cap?.new_elements || []).map((x) => x.name));

  function shotCardHtml(ev, s, fresh = new Set()) {
    const sides = SIDES.map((k) => s.sides[k]).filter(Boolean);
    const fig = (x) => {
      const src = thumbs.get(tkey(x));
      return `<figure><figcaption class="muted small" title="${esc(x.path)}">${esc(sideLabel(ev, x))}</figcaption><img ${ImageViewer.THUMB} alt="${esc(`${s.caption || s.key}: ${sideLabel(ev, x)}`)}" data-ap-img="${esc(x.file)}" data-ap-shot="${esc(tkey(x))}"${src ? ` src="${esc(src)}"` : ''} /></figure>`;
    };
    const isNew = sides.length === 1 && sides[0].side === 'modified' && fresh.has(s.key);
    const only = isNew ? `<span class="badge ap-shot-badge new" title="${t('artifacts_panel.the_change_adds_this_element_the')}">${t('artifacts_panel.new_element_no_original')}</span>`
      : sides.length === 1 ? `<span class="badge">${t('artifacts_panel.side_only', { side: esc(sideWord(sides[0].side)) })}</span>` : '';
    return `<div class="ap-shot" data-testid="artifact-shot"><div class="ap-shot-head"><b class="ap-shot-title" title="${esc(s.key)}">${esc(s.caption || s.key)}</b>${only}</div>
      <div class="ap-pair${sides.length === 1 ? ' single' : ''}">${sides.map(fig).join('')}</div></div>`;
  }

  // The screenshots step's summary and its real errors (a new element is not one)
  function captureSummaryHtml(cap) {
    if (!cap) return '';
    const fresh = cap.new_elements || [];
    const errors = cap.errors || [];
    const parts = [
      cap.taken ? t('artifacts_panel.screenshots_of_screens', { shots: t('artifacts_panel.screenshots_count', { count: cap.taken }), screens: t('artifacts_panel.screens_count', { count: cap.screens || 0 }) }) : '',
      fresh.length ? t('artifacts_panel.new_elements_count', { count: fresh.length }) : '',
      errors.length ? t('artifacts_panel.errors_count', { count: errors.length }) : '',
    ].filter(Boolean);
    const title = fresh.map((x) => t('artifacts_panel.not_on_the_original', { name: x.caption || x.name })).join('\n');
    const summary = parts.length ? `<p class="muted small ap-pad" data-testid="screenshots-summary"${title ? ` title="${esc(title)}"` : ''}>${esc(parts.join('; '))}</p>` : '';
    const lines = errors.map((e) => `${e.caption || e.name}${e.side ? ` (${e.side})` : ''}: ${e.error}`);
    return summary + lines.map((t) => `<p class="error small ap-pad" data-testid="screenshot-error" title="${esc(t)}">${esc(t)}</p>`).join('');
  }

  // A round's head, "<step> · round <n>" (#245: the step's readable name; `stepNames` from the run's
  // workflow.started when the caller has them), the step id in its tooltip
  const stepLabel = (p, step) => (window.displayName ? window.displayName(step, p.stepNames || p.run?.stepNames) : step);
  const roundText = (p, step, round) => t('artifacts_panel.step_round', { step: stepLabel(p, step), round });

  // The gate right after a screenshots step (#144, extras.capture: its output): only that step's
  // round, original/modified side by side with captions, the failed captures listed; every other
  // round in History (no stale screenshots of an older commit, not even as a failed side's pair);
  // "No screenshots: <reason>".
  function captureHtml(p, ev, cap) {
    const latest = (x) => x.step === cap.folder && x.round === cap.round;
    const shots = pairShots(ev, (ev?.images || []).filter(latest), latest);
    p.context = shots;
    p.cards = shots.length;
    const fresh = newElementKeys(cap);
    const body = shots.length ? shots.map((s) => shotCardHtml(ev, s, fresh)).join('')
      : `<div class="ap-empty"><b>${t('artifacts_panel.no_screenshots')}</b> <span class="muted">${esc(cap.reason || t('artifacts_panel.none_were_captured'))}</span></div>`;
    return `<div class="ap-group ap-shots"><div class="ap-group-head">${t('artifacts_panel.screenshots')} <span class="badge">${t('artifacts_panel.latest')}</span> <span class="muted" title="${esc(t('artifacts_panel.captured_before_this_gate_folder', { folder: cap.folder }))}">${esc(roundText(p, cap.folder, cap.round))}</span></div>
      ${captureSummaryHtml(cap)}${body}${ev?.images?.length ? historyHtml(p, ev, (x) => !latest(x)) : ''}</div>`;
  }

  function shotsHtml(p) {
    p.cards = 0;
    if (p.evidence === undefined) return ''; // not loaded yet
    const ev = p.evidence;
    if (p.extras?.capture) return captureHtml(p, ev, p.extras.capture);
    if (!ev?.images?.length) return `<div class="ap-group ap-shots"><p class="muted small ap-pad">${t('artifacts_panel.no_screenshots_in_this_run')}</p></div>`;
    const shots = finalShots(ev);
    const issues = [...new Set(shots.map((s) => s.issue || ''))];
    const cap = captureFor(p, ev);
    const fresh = newElementKeys(cap);
    const where = ev.legacy ? t('artifacts_panel.recorded_before_evidence_rounds') : ev.final ? roundText(p, ev.final.step, ev.final.round) : '';
    const whereTip = ev.final && !ev.legacy ? t('artifacts_panel.last_round_that_captured_step', { step: ev.final.step }) : t('artifacts_panel.last_round_that_captured');
    const ordered = [];
    const body = issues.map((iss) => {
      const head = issues.length > 1 || iss ? `<div class="ap-sub-head">${iss ? t('artifacts_panel.issue_iss', { iss: esc(iss) }) : t('artifacts_panel.other_screens')}</div>` : '';
      const mine = shots.filter((s) => (s.issue || '') === iss);
      ordered.push(...mine);
      return `${head}${mine.map((s) => shotCardHtml(ev, s, fresh)).join('')}`;
    }).join('');
    p.context = ordered;
    p.cards = ordered.length;
    return `<div class="ap-group ap-shots"><div class="ap-group-head">${t('artifacts_panel.screenshots')} <span class="badge">${t('artifacts_panel.final')}</span> <span class="muted" title="${esc(whereTip)}">${esc(where)}</span></div>${captureSummaryHtml(cap)}${body}${historyHtml(p, ev)}</div>`;
  }

  // Older rounds and steps (isOld: the images that are not shown above), newest first, each image
  // opening in the viewer with its pair
  function historyHtml(p, ev, isOld = (x) => !x.final) {
    const old = ev.images.filter(isOld);
    if (!old.length) return '';
    const rounds = [...(ev.rounds || [])].reverse();
    const item = (x) => `<button type="button" class="ap-file" data-ap-hist="${esc(x.file)}" data-ap-img="${esc(x.file)}" title="${esc(x.path)}">${artKindIcon('image')}
      <span class="ap-file-main"><span class="ap-file-name">${esc(x.caption || x.key)}</span><span class="ap-file-sub muted">${esc(x.key)}</span></span><span class="badge">${esc(sideWord(x.side))}</span></button>`;
    const groups = rounds.map((r) => {
      const list = old.filter((x) => x.step === r.step && x.round === r.round);
      return list.length ? `<div class="ap-sub-head" title="${esc(r.step)}">${esc(roundText(p, r.step, r.round))}</div>${list.map(item).join('')}` : '';
    }).join('');
    return `<details class="ap-history"${p.historyOpen ? ' open' : ''}><summary class="ap-group-head" data-ap-history>${t('artifacts_panel.history')} <span class="muted">${old.length}</span></summary>${groups}</details>`;
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
      else el.alt = t('artifacts_panel.could_not_load_the_image');
    }
  }

  // ---------------------------------------------------------------- the image viewer (#145, #182)
  // A shot as one item of the viewer's sequence: its sides, original first
  function shotItem(ev, s, p) {
    return {
      title: s.caption || s.key,
      images: SIDES.map((k) => s.sides[k]).filter(Boolean).map((i) => ({ file: i.file, src: thumbs.get(tkey(i)) || null, label: sideLabel(ev, i), caption: roundText(p || {}, i.step, i.round), side: i.side })),
    };
  }
  const fileItem = (file, src = null, title = '') => ({ title: title || baseOf(file), images: [{ file, src, label: '', caption: '' }] });

  // The history's shots: one per name and round, paired inside its round only
  function historyShots(ev, old) {
    const same = (x) => (y) => y.step === x.step && y.round === x.round;
    const out = new Map();
    for (const x of old) {
      const k = `${x.step}/${x.round}/${x.key}`;
      if (!out.has(k)) out.set(k, shotOf(ev, x, same(x)));
      else out.get(k).sides[x.side] = x;
    }
    return [...out.values()];
  }

  // Opens `file` in the viewer with every item of its context, at the clicked one (its pair's side)
  function openItems(items, file, src = null, title = '') {
    let index = items.findIndex((it) => it.images.some((im) => slash(im.file) === slash(file)));
    if (index < 0) { items = [...items, fileItem(file, src, title)]; index = items.length - 1; }
    const imageIndex = Math.max(0, items[index].images.findIndex((im) => slash(im.file) === slash(file)));
    if (src && !items[index].images[imageIndex].src) items[index].images[imageIndex].src = src;
    ImageViewer.open({ title: items[index].title, items, index, imageIndex });
  }

  // The panel's images in the order shown: the screenshot cards, then the other image files listed
  function panelItems(p) {
    const ev = p.evidence;
    const carded = new Set((ev?.images || []).map((x) => slash(x.file)));
    const others = p.flat ? [] : filterFiles(p.files || [], p.filter).filter((f) => f.kind === 'image' && !carded.has(slash(f.path))).sort(newest);
    return [...(p.context || []).map((s) => shotItem(ev, s, p)), ...others.map((f) => fileItem(f.path, null, f.name))];
  }

  function openInViewer(p, file, src = null, title = '') {
    const x = imageOf(p.evidence, file);
    if (x && src && !thumbs.has(tkey(x))) thumbs.set(tkey(x), src);
    // an older round's image: the history is its context
    if (x && !(p.context || []).some((s) => Object.values(s.sides).includes(x))) {
      const old = (p.evidence.images || []).filter((y) => !(p.context || []).some((s) => Object.values(s.sides).includes(y)));
      openItems(historyShots(p.evidence, old).map((s) => shotItem(p.evidence, s, p)), file, src, title);
      return;
    }
    openItems(panelItems(p), file, src, title);
  }

  // The Artifacts screen's image (app.js): the images of its run group (`files`, in the order shown),
  // a screenshot with its pair from the run's manifest, a pair as one item
  async function openImage({ runId, file, src = null, title = '', files = null }) {
    let ev = runId ? lists.get(runId)?.evidence : null;
    if (runId && !ev && api.runEvidence) ev = await api.runEvidence(runId).catch(() => null);
    const items = [];
    const seen = new Set();
    for (const f of files?.length ? files : [file]) {
      const x = imageOf(ev, f);
      if (!x) { items.push(fileItem(f, slash(f) === slash(file) ? src : null)); continue; }
      const k = `${x.step}/${x.round}/${x.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(shotItem(ev, shotOf(ev, x, (y) => y.step === x.step && y.round === x.round)));
    }
    openItems(items, file, src, title);
  }

  // A screenshot's caption from the run's manifest ('' when it is not one): the Artifacts screen
  // names its screenshots by caption
  function captionOf(ev, file) {
    return imageOf(ev, file)?.caption || '';
  }

  // ---------------------------------------------------------------- preview
  function previewHtml(p) {
    const s = p.sel;
    const meta = s.path ? (p.files || []).find((f) => f.path === s.path) || {} : {};
    const name = s.title || meta.name || baseOf(s.path);
    return `<div class="ap-bar"><button type="button" class="btn sm ghost" data-ap-back title="${t('artifacts_panel.back_to_the_list')}">${t('artifacts_panel.artifacts')}</button>
      ${s.path ? artKindIcon(meta.kind) : ''}<b class="ap-title" title="${esc(s.path || name)}">${esc(name)}</b>
      ${s.path ? `<button type="button" class="btn sm ghost" data-ap-full>${t('artifacts_panel.open_in_artifacts')}</button>` : ''}</div>
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
    if (!d) { body.innerHTML = `<p class="muted small ap-pad">${t('artifacts_panel.loading')}</p>`; return; }
    if (d.error) { body.innerHTML = `<p class="error small ap-pad">${esc(d.error)}</p>`; return; }
    const meta = (p.files || []).find((f) => f.path === s.path) || d;
    const notice = d.truncated ? `<div class="art-notice">${t('artifacts_panel.this_file_is_larger_than_5')}</div>` : '';
    if (d.image && d.shot) {
      body.innerHTML = shotCardHtml(p.evidence, shotOf(p.evidence, d.shot), newElementKeys(captureFor(p, p.evidence)));
      paintThumbs(p);
      return;
    }
    if (d.image) { body.innerHTML = `<div class="art-image"><img ${ImageViewer.THUMB} src="${esc(d.image)}" alt="${esc(meta.name || '')}" data-ap-img="${esc(s.path)}" /></div>`; return; }
    if (d.binary || d.text == null || meta.kind === 'other') { body.innerHTML = `${notice}<p class="muted small ap-pad">${t('artifacts_panel.preview_not_available_for_this_file')}</p>`; return; }
    if (meta.kind === 'markdown') { body.innerHTML = `${notice}<article class="md">${markdownHtml(d.text)}</article>`; return; }
    if (meta.kind === 'json') { body.innerHTML = `${notice}<pre class="art-code json">${renderJsonText(d.text, /\.jsonl$/i.test(s.path))}</pre>`; return; }
    if (meta.kind === 'table') { body.innerHTML = `${notice}${renderDelimited(d.text, /\.csv$/i.test(s.path) ? ',' : '\t')}`; return; }
    body.innerHTML = `${notice}<pre class="art-code">${esc(d.text)}</pre>`;
  }

  // ---------------------------------------------------------------- clicks
  function onClick(p, e) {
    const t = e.target;
    const thumb = t.closest('[data-iv-thumb]');
    if (thumb) { openInViewer(p, thumb.dataset.apImg, thumb.getAttribute('src'), thumb.getAttribute('alt') || ''); return; }
    const hist = t.closest('[data-ap-hist]');
    if (hist) { openInViewer(p, hist.dataset.apHist); return; }
    if (t.closest('[data-ap-history]')) { p.historyOpen = !t.closest('details')?.open; return; }
    if (onFilterClick(p.filter, t)) { p.render(); return; }
    const file = t.closest('[data-ap-file]');
    if (file) { p.select({ path: file.dataset.apFile }); return; }
    const note = t.closest('[data-ap-note]');
    if (note) { const n = p.extras?.notes?.[+note.dataset.apNote]; if (n) p.select({ title: n.title, text: String(n.text) }); return; }
    const change = t.closest('[data-ap-change]');
    if (change) { p.extras?.onChange?.(change.dataset.apChange); return; }
    if (t.closest('[data-ap-back]')) { p.sel = null; p.doc = null; p.render(); return; }
    if (t.closest('[data-ap-folder]')) { if (p.run?.runDir) api.openPath(p.run.runDir).catch((err) => showToast(I18n.t('artifacts_panel.could_not_open_the_folder'), errMsg(err))); return; }
    if (t.closest('[data-ap-full]')) {
      const path = p.sel?.path || [...(p.files || [])].sort(newest)[0]?.path;
      if (path) openArtifactsAt({ projectId: p.run?.project?.id || '', path, mock: !!p.run?.mock });
      else showToast(I18n.t('artifacts_panel.no_artifacts_yet'), I18n.t('artifacts_panel.this_run_has_not_produced_files'));
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

  window.ArtifactsPanel = {
    CATEGORIES,
    captionOf,
    categoryOf,
    chipKindOf,
    filterFiles,
    filtersHtml,
    groupOf,
    mount,
    newFilter,
    onFilterClick,
    openImage,
    refreshRun,
  };
})();
