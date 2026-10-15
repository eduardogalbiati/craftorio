// An issue's impact preview on the project city (#375), an overlay of the City view (project-city.js)
// built on its overlay API, so the city's own module does not grow. "Show on the map" (Backlog card,
// roadmap item: showIssue(projectId, issue)) opens the project's City view and colours the issue's
// expected buildings by source (cited in its body, the Product Owner's group, changed by its latest
// finished run; src/shared/city-impact.js), the rest grey. A card (data-testid="city-impact") holds
// the header (headerMarkup: the issue, the counts by district and zone, the Danger Zone share, the
// new files with their district) and, after a run, predicted vs actual: the three sets on the map and
// the hit rate, kept per issue (architecture:impact). "Show the stage on the map" (showStage(projectId,
// stage)) colours each item of a roadmap stage in its colour and a building two items would change in
// red (#150), listed in data-testid="city-impact-conflicts". The legend of the city
// (project-city-legend) gets the overlay's rows. Close removes the layer. No model call: the Product
// Owner's saved answers are read (po:history), never asked again.
// Uses app.js globals at call time: api, esc, errMsg. Browser: window.ProjectCityImpact.
(() => {
  const LAYER = 'impact';
  const SOURCE_LABEL = { changed: 'Changed by its run', cited: 'Cited in the issue', po: "In the Product Owner's group" };
  // predicted vs actual on the map
  const SETS = [
    { key: 'hit', colour: '#3fb68b', label: 'changed as predicted' },
    { key: 'missed', colour: '#f2a541', label: 'predicted, untouched' },
    { key: 'unexpected', colour: '#e05297', label: 'changed, not predicted' },
  ];
  const handles = new Set();
  let pending = null; // { projectId, issue } or { projectId, stage }: the preview asked from the Backlog or the Roadmap

  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const dot = (colour) => `<i class="r3d-dot" style="--c:${esc(colour)}"></i>`;
  const countsHtml = (list, testid, label) => (list.length
    ? `<ul class="pci-counts" aria-label="${esc(label)}">${list.map((d) => `<li data-testid="${testid}"><span title="${esc(d.name)}">${esc(d.name)}</span> <b>${d.count}</b></li>`).join('')}</ul>` : '');

  /** The issue preview's header: the issue, the counts by district and zone, the Danger Zone share, the new files, predicted vs actual. */
  function headerMarkup(preview) {
    const { issue = {}, header = {}, newFiles = [], comparison = null } = preview || {};
    const total = header.total || 0;
    const cmp = comparison ? `<div class="pci-cmp" data-testid="city-impact-comparison">
        <b class="pci-rate">${comparison.hitRate == null ? 'Nothing was predicted' : `${pct(comparison.hitRate)} hit rate`}</b>
        ${SETS.map((s) => `<span data-testid="city-impact-${s.key}">${dot(s.colour)}${(comparison[s.key] || []).length} ${s.label}</span>`).join('')}
        ${preview.history && preview.history.length > 1 ? `<small class="muted">Earlier runs: ${preview.history.slice(0, -1).map((h) => pct(h.hitRate)).join(', ')}</small>` : ''}
      </div>` : '';
    return `<div class="pci-header" data-testid="city-impact-header">
      <div class="pci-title"><b>#${esc(issue.number)}</b> <span title="${esc(issue.title)}">${esc(issue.title)}</span></div>
      <p class="pci-total">${plural(total, 'file')} on the map · <span data-testid="city-impact-danger">${pct(header.dangerShare)} in the Danger Zone</span></p>
      ${countsHtml(header.districts || [], 'city-impact-district', 'By district')}
      ${countsHtml(header.zones || [], 'city-impact-zone', 'By zone')}
      ${newFiles.length ? `<ul class="pci-new" aria-label="New files">${newFiles.map((f) => `<li data-testid="city-impact-new-file"><code title="${esc(f.path)}">${esc(f.path)}</code> <small class="muted">${esc(f.note)}</small></li>`).join('')}</ul>` : ''}
      ${cmp}
    </div>`;
  }

  // a stage's card: its items in their colour, the buildings two items would change
  function stageMarkup(view) {
    const conflicts = view.conflicts.length
      ? `<ul>${view.conflicts.map((c) => `<li><code title="${esc(c.path)}">${esc(c.path)}</code> <small class="muted">${esc(c.items.map((id) => view.titles[id] || id).join(' · '))}</small></li>`).join('')}</ul>`
      : '<p class="muted small">No building is changed by two items.</p>';
    return `<div class="pci-header" data-testid="city-impact-stage">
      <div class="pci-title"><b>Stage</b> <span title="${esc(view.name)}">${esc(view.name)}</span></div>
      <p class="pci-total">${plural(view.items.length, 'item')} · ${plural(view.total, 'file')} on the map</p>
      <div class="pci-conflicts" data-testid="city-impact-conflicts" role="status"><b>Changed by two items</b>${conflicts}</div>
    </div>`;
  }

  // the Product Owner's saved files for an issue: its latest group that holds it
  function poFilesOf(conversation, number) {
    const messages = Array.isArray(conversation) ? conversation : conversation?.messages || [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const group = (messages[i]?.answer?.groups || []).find((g) => (g.issues || []).map(Number).includes(Number(number)));
      if (group) return group.files || [];
    }
    return [];
  }

  // the issue's latest real finished run and the files it changed (none before a run)
  async function changedOf(projectId, issue) {
    let runs = issue.runs;
    if (!runs) runs = ((await api.getBacklog(projectId).catch(() => null))?.issues || []).find((i) => i.number === issue.number)?.runs || [];
    const run = runs.find((r) => !r.mock && r.status && r.status !== 'running');
    if (!run) return { run: null, changed: [] };
    const diff = await api.runDiff(run.runId, null, null, true).catch(() => null);
    return { run: run.runId, changed: (diff?.files || []).map((f) => f.file).filter(Boolean) };
  }

  function attach(city, { projectId }) {
    const el = document.createElement('div');
    el.className = 'r3d-card pci hidden';
    el.setAttribute('data-testid', 'city-impact');
    el.setAttribute('aria-live', 'polite');
    city.el.appendChild(el);
    let request = null; // what to show: { issue } or { stage }
    let data = null; // { plan, history, conversation, changed, run }
    let error = null;
    let legend = []; // the legend's rows: [{ colour, label }]
    let layered = false; // the layer is set on the city
    let seq = 0;
    let destroyed = false;
    const repoFiles = () => (city.model?.buildings || []).map((b) => b.path);
    const layout = () => city.layout || null;

    // the legend of the city keeps the overlay's rows (the city redraws its legend on each paint)
    function decorateLegend() {
      const box = city.el.querySelector('[data-testid="project-city-legend"]');
      if (!box) return;
      const old = box.querySelector('[data-pci-legend]');
      const html = legend.length ? `<b>Impact</b><ul>${legend.map((l) => `<li>${dot(l.colour)}<span title="${esc(l.label)}">${esc(l.label)}</span></li>`).join('')}</ul>` : '';
      if (old && old.dataset.html === html) return;
      if (old) old.remove();
      if (!html) return;
      const div = document.createElement('div');
      div.className = 'pci-legend';
      div.setAttribute('data-pci-legend', '');
      div.dataset.html = html;
      div.innerHTML = html;
      box.appendChild(div);
    }
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => decorateLegend()) : null;
    observer?.observe(city.el, { childList: true, subtree: true });

    const expected = (issue, changed = []) => CityImpact.expectedFiles({ body: issue.body, poFiles: poFilesOf(data.conversation, issue.number), changed, files: repoFiles(), plan: data.plan });
    const pathsOf = (p) => [...p.files, ...p.newFiles].map((f) => f.path);
    // predicted vs actual, after a run: what the run changed against what was expected before it
    const compare = (issue) => (data.run ? CityImpact.predictedVsActual(pathsOf(expected(issue)), data.changed) : null);

    function issueView() {
      const { issue } = request;
      const preview = expected(issue, data.changed);
      const comparison = compare(issue);
      const header = CityImpact.impactHeader(layout(), preview.files.map((f) => f.path), { quadrants: Object.fromEntries((layout()?.buildings || []).filter((b) => b.quadrant).map((b) => [b.path, b.quadrant])) });
      let highlight = CityImpact.overlayOf(preview).highlight;
      if (comparison) {
        highlight = {};
        for (const s of SETS) for (const p of comparison[s.key]) highlight[p] = s.colour;
        legend = SETS.map((s) => ({ colour: s.colour, label: s.label }));
      } else {
        const used = new Set(preview.files.flatMap((f) => f.sources));
        legend = Object.keys(SOURCE_LABEL).filter((s) => used.has(s)).map((s) => ({ colour: CityImpact.SOURCE_COLOURS[s], label: SOURCE_LABEL[s] }));
      }
      const history = (data.history || {})[String(issue.number)] || [];
      return { html: headerMarkup({ issue, header, files: preview.files, newFiles: preview.newFiles, comparison, history }), highlight };
    }

    function stageView() {
      const { stage } = request;
      const items = (stage.items || []).map((it, i) => ({ id: String(it.id || it.number || i), title: it.title || `#${it.number}`, files: pathsOf(expected(it)) }));
      const foot = CityImpact.stageFootprint(items);
      const titles = Object.fromEntries(items.map((it) => [it.id, it.title]));
      legend = [...items.map((it) => ({ colour: foot.colours[it.id], label: it.title })), ...(foot.conflicts.length ? [{ colour: CityImpact.CONFLICT_COLOUR, label: 'Changed by two items' }] : [])];
      const onMap = new Set((layout()?.buildings || []).map((b) => b.path));
      const total = Object.keys(foot.highlight).filter((p) => onMap.has(p)).length;
      return { html: stageMarkup({ name: stage.name || '', items, conflicts: foot.conflicts, titles, total }), highlight: foot.highlight };
    }

    function draw() {
      if (destroyed) return;
      el.classList.toggle('hidden', !request);
      if (!request) {
        legend = [];
        decorateLegend();
        if (layered) ProjectCity.overlay(LAYER, null);
        layered = false;
        el.innerHTML = '';
        return;
      }
      const close = '<button type="button" class="link-btn" data-pci-close data-testid="city-impact-close">Close</button>';
      const head = `<div class="pci-head"><b>${request.stage ? 'Stage footprint' : 'Impact preview'}</b>${close}</div>`;
      if (error) { el.innerHTML = `${head}<p class="small" role="alert">Could not read the preview: ${esc(error)}</p>`; return; }
      if (!data || !layout()) { el.innerHTML = `${head}<p class="muted small">Reading the issue's expected files…</p>`; return; }
      const view = request.stage ? stageView() : issueView();
      ProjectCity.overlay(LAYER, { highlight: view.highlight });
      layered = true;
      el.innerHTML = `${head}${view.html}`;
      decorateLegend();
    }

    async function show(req) {
      const mine = ++seq;
      request = req;
      data = null;
      error = null;
      draw();
      try {
        const [impact, conversation, ran] = await Promise.all([
          api.architectureImpact({ projectId }),
          api.productOwnerHistory(projectId).catch(() => []),
          req.issue ? changedOf(projectId, req.issue) : { run: null, changed: [] },
        ]);
        if (destroyed || mine !== seq) return;
        data = { plan: impact?.plan || null, history: impact?.history || {}, conversation, ...ran };
        draw();
        // the hit rate, kept per issue so the prediction can be judged over time
        const rate = req.issue ? compare(req.issue)?.hitRate ?? null : null;
        if (rate == null) return;
        const kept = await api.architectureImpact({ projectId, record: { issue: req.issue.number, hitRate: rate, run: data.run } }).catch(() => null);
        if (kept && !destroyed && mine === seq) { data.history = kept.history; draw(); }
      } catch (e) {
        if (destroyed || mine !== seq) return;
        error = errMsg(e);
        draw();
      }
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pci-close]')) { seq++; request = null; draw(); }
    });
    const offLayout = city.onLayout(() => draw());
    const handle = {
      projectId,
      show,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        observer?.disconnect();
        offLayout?.();
        handles.delete(handle);
        if (layered) ProjectCity.overlay(LAYER, null);
        el.remove();
      },
    };
    handles.add(handle);
    if (pending && pending.projectId === projectId) {
      const req = pending;
      pending = null;
      show(req);
    }
    return handle;
  }

  // opens the project's City view with a preview: the city's overlay takes it now or when it attaches
  function open(projectId, req) {
    pending = { projectId, ...req };
    for (const h of handles) {
      if (h.projectId !== projectId) continue;
      pending = null;
      h.show({ projectId, ...req });
    }
    window.ProjectArchitecture?.openCity(projectId);
  }

  // a roadmap item as one preview: its issues (the backlog's copy has the body and the runs), their titles and bodies joined
  function itemOf(x, issues) {
    const refs = (x.issues?.length ? x.issues : x.number ? [x] : []).map((i) => ({ ...i, ...(issues || []).find((b) => b.number === i.number) }));
    const first = refs[0] || {};
    return { id: x.id, number: first.number, title: refs.map((i) => i.title || `#${i.number}`).join(' + '), body: refs.map((i) => i.body || '').join('\n'), runs: first.runs };
  }

  /** The Roadmap's buttons: `which` is the button's dataset, { rmMapItem: item id } or { rmMapStage: stage index }. */
  function fromRoadmap(projectId, roadmap, issues, which) {
    const stages = roadmap?.stages || [];
    if (which.rmMapStage != null) {
      const stage = stages[Number(which.rmMapStage)];
      if (stage) open(projectId, { stage: { name: stage.name || `Stage ${Number(which.rmMapStage) + 1}`, items: stage.items.map((x) => itemOf(x, issues)) } });
      return;
    }
    const x = stages.flatMap((s) => s.items).find((i) => i.id === which.rmMapItem);
    if (x) open(projectId, { issue: itemOf(x, issues) });
  }

  window.ProjectCityImpact = {
    attach,
    fromRoadmap,
    headerMarkup,
    /** "Show on the map": an issue ({ number, title, body, runs? }) on its project's city. */
    showIssue: (projectId, issue) => open(projectId, { issue }),
    /** "Show the stage on the map": a roadmap stage ({ name, items: [{ id, number, title, body }] }) on its project's city. */
    showStage: (projectId, stage) => open(projectId, { stage }),
  };
})();
