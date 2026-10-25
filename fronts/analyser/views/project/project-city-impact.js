// An issue's impact preview on the project city (#375), an overlay of the City view (project-city.js)
// built on its overlay API, so the city's own module does not grow. "Show on the map" (Backlog card,
// roadmap item: showIssue(projectId, issue)) opens the project's City view (#430: in the city modal over
// the screen, project-city-modal.js, unless a city of the project is on screen) and colours the issue's
// expected buildings by source (its `## Expected files` section, cited in its body, the Product
// Owner's group, changed by its latest finished run; packages/shared/city-impact.js), the rest grey. A card
// (data-testid="city-impact") holds the header (headerMarkup: the issue, the counts by district and
// zone, the Danger Zone share, the new files with their district) and, after a run, predicted vs
// actual: the three sets on the map and the hit rate, kept per issue with whether it had the section
// (architecture:impact), the source of each hit and miss (city-impact-by-source) and the project's
// average hit rate with the section against without (city-impact-section-rate, #429). "Show the stage on the map" (showStage(projectId,
// stage)) colours each item of a roadmap stage in its colour and a building two items would change in
// red (#150), listed in data-testid="city-impact-conflicts" (#428: one muted line when there is none),
// and names a run in progress of its items in the run's colour (city-impact-in-progress, architecture:agents
// read once). The card sits at the top of the city's left column (#428, city.leftColumn). The legend of the city
// (project-city-legend) gets the overlay's rows (city.setLegend). Each show puts the city in the
// impact or the stage mode (#440, project-city-modes.js: "Issue #n", "Stage <name>"), whose leaving
// is Close: the layer, the card and the rows go. The card is a panel (#441: data-city-panel="impact",
// its chevron). No model call: the Product Owner's saved answers are read (po:history), never asked again.
// Uses app.js globals at call time: api, esc, errMsg. Browser: window.ProjectCityImpact.
(() => {
  const LAYER = 'impact';
  // the catalog keys of the legend's labels
  const SOURCE_LABEL = { changed: 'project_city_impact.source_changed', expected: 'project_city_impact.source_expected', cited: 'project_city_impact.source_cited', po: 'project_city_impact.source_po' };
  // predicted vs actual on the map
  const SETS = [
    { key: 'hit', colour: '#3fb68b', label: 'project_city_impact.set_hit' },
    { key: 'missed', colour: '#f2a541', label: 'project_city_impact.set_missed' },
    { key: 'unexpected', colour: '#e05297', label: 'project_city_impact.set_unexpected' },
  ];
  const handles = new Set();
  let pending = null; // { projectId, issue } or { projectId, stage }: the preview asked from the Backlog or the Roadmap

  const pct = (x) => `${Math.round((x || 0) * 100)}%`;
  const plural = (n, key) => t(key, { count: n });
  const dot = (colour) => ProjectCityCards.dot(colour);
  const countsHtml = (list, testid, label) => ProjectCityCards.countsHtml(list, testid, label);

  // after a run, which source predicted each hit and miss (#429): one row per file and source
  function bySourceMarkup(bySource) {
    const rows = Object.keys(SOURCE_LABEL).filter((s) => bySource && bySource[s]).flatMap((s) => [
      ...bySource[s].hit.map((p) => ({ p, s, set: SETS[0] })),
      ...bySource[s].missed.map((p) => ({ p, s, set: SETS[1] })),
    ]);
    if (!rows.length) return '';
    return `<ul class="pci-by-source" data-testid="city-impact-by-source" aria-label="${esc(t('project_city_impact.by_source'))}">${rows.map((r) => `<li>${dot(r.set.colour)}<code title="${esc(r.p)}">${esc(r.p)}</code> <small class="muted">${t(r.set.label)} · ${t(SOURCE_LABEL[r.s])}</small></li>`).join('')}</ul>`;
  }

  // the project's average hit rate of the issues with an Expected files section against those without (#429)
  function sectionRateMarkup(history) {
    const rate = CityImpact.hitRateBySection(history || {});
    if (!rate.with.issues && !rate.without.issues) return '';
    const avg = (x) => (x.average == null ? '—' : pct(x.average));
    return `<small class="muted" data-testid="city-impact-section-rate">${t('project_city_impact.section_rate', { with: avg(rate.with), without: avg(rate.without) })}</small>`;
  }

  /** The issue preview's header: the issue, the counts by district and zone, the Danger Zone share, the new files, predicted vs actual. */
  function headerMarkup(preview) {
    const { issue = {}, header = {}, newFiles = [], comparison = null } = preview || {};
    const total = header.total || 0;
    const cmp = comparison ? `<div class="pci-cmp" data-testid="city-impact-comparison">
        <strong class="pci-rate">${comparison.hitRate == null ? t('project_city_impact.nothing_was_predicted') : t('project_city_impact.hitrate_hit_rate', { hitRate: pct(comparison.hitRate) })}</strong>
        ${SETS.map((s) => `<span data-testid="city-impact-${s.key}">${dot(s.colour)}${(comparison[s.key] || []).length} ${t(s.label)}</span>`).join('')}
        ${preview.history && preview.history.length > 1 ? `<small class="muted">${t('project_city_impact.earlier_runs')} ${preview.history.slice(0, -1).map((h) => pct(h.hitRate)).join(', ')}</small>` : ''}
        ${bySourceMarkup(comparison.bySource)}
        ${sectionRateMarkup(preview.allHistory)}
      </div>` : '';
    return `<div class="pci-header" data-testid="city-impact-header">
      <div class="pci-title"><strong>#${esc(issue.number)}</strong> <span title="${esc(issue.title)}">${esc(issue.title)}</span></div>
      <p class="pci-total">${plural(total, 'project_city_impact.files_count')} ${t('project_city_impact.on_the_map')} <span data-testid="city-impact-danger">${pct(header.dangerShare)} ${t('project_city_impact.in_the_danger_zone')}</span></p>
      ${countsHtml(header.districts || [], 'city-impact-district', t('project_city_impact.by_district'))}
      ${countsHtml(header.zones || [], 'city-impact-zone', t('project_city_impact.by_zone'))}
      ${newFiles.length ? `<ul class="pci-new" aria-label="${t('project_city_impact.new_files')}">${newFiles.map((f) => `<li data-testid="city-impact-new-file"><code title="${esc(f.path)}">${esc(f.path)}</code> <small class="muted">${esc(f.note)}</small></li>`).join('')}</ul>` : ''}
      ${cmp}
    </div>`;
  }

  // a stage's card: its items in their colour, the runs in progress (#428: their colour on the map is not
  // the stage's), the buildings two items would change (#428: one muted line when there is none)
  function stageMarkup(view) {
    const conflicts = view.conflicts.length
      ? `<div class="pci-conflicts" data-testid="city-impact-conflicts" role="status"><b>${t('project_city_impact.changed_by_two_items')}</b><ul>${view.conflicts.map((c) => `<li><code title="${esc(c.path)}">${esc(c.path)}</code> <small class="muted">${esc(c.items.map((id) => view.titles[id] || id).join(' · '))}</small></li>`).join('')}</ul></div>`
      : `<p class="pci-conflicts-none muted small" data-testid="city-impact-conflicts" role="status">${t('project_city_impact.no_building_is_changed_by_two')}</p>`;
    const live = (view.live || []).map((r) => `<p class="pci-live" data-testid="city-impact-in-progress">${dot(r.colour)}<span>${t('project_city_impact.in_progress', { items: esc(r.items.join(' + ')) })}</span></p>`).join('');
    return `<div class="pci-header" data-testid="city-impact-stage">
      <div class="pci-title"><strong>${t('project_city_impact.stage')}</strong> <span title="${esc(view.name)}">${esc(view.name)}</span></div>
      <p class="pci-total">${plural(view.items.length, 'project_city_impact.items_count')} ${t('project_city_impact.total_on_the_map', { total: plural(view.total, 'project_city_impact.files_count') })}</p>
      ${live}
      ${conflicts}
    </div>`;
  }

  // the stage's items with a run in progress (architecture:agents' runs, matched by run id), one entry per run (#428)
  function liveRuns(items, agents) {
    return (agents?.runs || [])
      .map((r) => ({ colour: r.colour, items: items.filter((it) => it.runs.some((x) => x.status === 'running' && x.runId === r.id)).map((it) => it.title) }))
      .filter((r) => r.items.length);
  }
  const running = (stage) => (stage?.items || []).some((it) => (it.runs || []).some((r) => r.status === 'running'));

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
    el.setAttribute('data-city-panel', 'impact'); // #440: the impact and stage modes' card; #441: its chevron
    el.setAttribute('aria-live', 'polite');
    if (city.leftColumn) city.leftColumn(el); // #428: at the top of the city's left column, the notes under it
    else city.el.appendChild(el);
    let request = null; // what to show: { issue } or { stage }
    let data = null; // { plan, history, conversation, changed, run, agents }
    let error = null;
    let legend = []; // the legend's rows: [{ colour, label }]
    let layered = false; // the layer is set on the city
    let seq = 0;
    let destroyed = false;
    const repoFiles = () => (city.model?.buildings || []).map((b) => b.path);
    const layout = () => city.layout || null;

    // the overlay's rows in the city's legend, in place of Colour by's (#440: gone with the mode)
    const legendHtml = () => (legend.length ? `<div class="pci-legend" data-pci-legend><b>${t('project_city_impact.impact')}</b><ul>${legend.map((l) => `<li>${dot(l.colour)}<span title="${esc(l.label)}">${esc(l.label)}</span></li>`).join('')}</ul></div>` : null);
    const decorateLegend = () => city.setLegend?.(LAYER, legendHtml());

    const expected = (issue, changed = []) => CityImpact.expectedFiles({ body: issue.body, poFiles: poFilesOf(data.conversation, issue.number), changed, files: repoFiles(), plan: data.plan });
    const pathsOf = (p) => [...p.files, ...p.newFiles].map((f) => f.path);
    // predicted vs actual, after a run: what the run changed against what was expected before it
    const compare = (issue) => {
      if (!data.run) return null;
      const p = expected(issue);
      return CityImpact.predictedVsActual([...p.files, ...p.newFiles], data.changed);
    };

    function issueView() {
      const { issue } = request;
      const preview = expected(issue, data.changed);
      const comparison = compare(issue);
      const header = CityImpact.impactHeader(layout(), preview.files.map((f) => f.path), { quadrants: Object.fromEntries((layout()?.buildings || []).filter((b) => b.quadrant).map((b) => [b.path, b.quadrant])) });
      let highlight = CityImpact.overlayOf(preview).highlight;
      if (comparison) {
        highlight = {};
        for (const s of SETS) for (const p of comparison[s.key]) highlight[p] = s.colour;
        legend = SETS.map((s) => ({ colour: s.colour, label: t(s.label) }));
      } else {
        const used = new Set(preview.files.flatMap((f) => f.sources));
        legend = Object.keys(SOURCE_LABEL).filter((s) => used.has(s)).map((s) => ({ colour: CityImpact.SOURCE_COLOURS[s], label: t(SOURCE_LABEL[s]) }));
      }
      const history = (data.history || {})[String(issue.number)] || [];
      return { html: headerMarkup({ issue, header, files: preview.files, newFiles: preview.newFiles, comparison, history, allHistory: data.history || {} }), highlight };
    }

    function stageView() {
      const { stage } = request;
      const items = (stage.items || []).map((it, i) => ({ id: String(it.id || it.number || i), title: it.title || `#${it.number}`, files: pathsOf(expected(it)), runs: it.runs || [] }));
      const foot = CityImpact.stageFootprint(items);
      const titles = Object.fromEntries(items.map((it) => [it.id, it.title]));
      legend = [...items.map((it) => ({ colour: foot.colours[it.id], label: it.title })), ...(foot.conflicts.length ? [{ colour: CityImpact.CONFLICT_COLOUR, label: t('project_city_impact.changed_by_two_items') }] : [])];
      const onMap = new Set((layout()?.buildings || []).map((b) => b.path));
      const total = Object.keys(foot.highlight).filter((p) => onMap.has(p)).length;
      return { html: stageMarkup({ name: stage.name || '', items, conflicts: foot.conflicts, titles, total, live: liveRuns(items, data.agents) }), highlight: foot.highlight };
    }

    // the card's markup; then the mode's panels and their states (#440, #441)
    function draw() {
      drawCard();
      city.applyUi?.();
    }

    function drawCard() {
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
      const title = request.stage ? t('project_city_impact.stage_footprint') : t('project_city_impact.impact_preview');
      const close = `<button type="button" class="link-btn" data-pci-close data-testid="city-impact-close">${t('common.close')}</button>`;
      const head = `<div class="pci-head pc-panel-head"><b>${esc(title)}</b><span class="r3d-grow"></span>${close}${window.ProjectCityPanels?.chevron(title) || ''}</div>`;
      const body = (html) => `${head}<div data-city-panel-body>${html}</div>`;
      if (error) { el.innerHTML = body(`<p class="small" role="alert">${t('project_city_impact.could_not_read_the_preview')} ${esc(error)}</p>`); return; }
      if (!data || !layout()) { el.innerHTML = body(`<p class="muted small">${t('project_city_impact.reading_the_issue_s_expected_files')}</p>`); return; }
      const view = request.stage ? stageView() : issueView();
      ProjectCity.overlay(LAYER, { highlight: view.highlight });
      layered = true;
      el.innerHTML = body(view.html);
      decorateLegend();
    }

    // Close: nothing of the preview stays (its layer, its card, its legend rows)
    function clear() {
      seq++;
      request = null;
      draw();
    }

    async function show(req) {
      const mine = ++seq;
      request = req;
      data = null;
      error = null;
      // #440: an issue's or a stage's mode replaces the mode on screen (the previous preview's rows go with show's draw)
      city.setMode?.(req.stage ? 'stage' : 'impact', {
        title: req.stage ? t('project_city_modes.title_stage', { name: req.stage.name || '' }) : t('project_city_modes.title_issue', { number: req.issue?.number ?? '' }),
        onLeave: clear,
      });
      legend = [];
      decorateLegend();
      if (layered) ProjectCity.overlay(LAYER, null);
      layered = false;
      draw();
      try {
        const [impact, conversation, ran, agents] = await Promise.all([
          api.architectureImpact({ projectId }),
          api.productOwnerHistory(projectId).catch(() => []),
          req.issue ? changedOf(projectId, req.issue) : { run: null, changed: [] },
          // #428: a stage with a run in progress names that run's colour; read once, not polled
          running(req.stage) ? api.architectureAgents({ projectId }).catch(() => null) : null,
        ]);
        if (destroyed || mine !== seq) return;
        data = { plan: impact?.plan || null, history: impact?.history || {}, conversation, ...ran, agents };
        draw();
        // the hit rate, kept per issue so the prediction can be judged over time: once per run, not per view
        // (an unreadable history is never rewritten: the channel refuses it)
        const rate = req.issue ? compare(req.issue)?.hitRate ?? null : null;
        if (rate == null || impact?.error) return;
        if ((data.history[String(req.issue.number)] || []).some((h) => h.run === data.run)) return;
        const kept = await api.architectureImpact({ projectId, record: { issue: req.issue.number, hitRate: rate, run: data.run, withSection: CityImpact.expectedSection(req.issue.body) !== null } }).catch(() => null);
        if (kept && !destroyed && mine === seq) { data.history = kept.history; draw(); }
      } catch (e) {
        if (destroyed || mine !== seq) return;
        error = errMsg(e);
        draw();
      }
    }

    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pci-close]')) { clear(); city.closeMode?.(); }
    });
    const offLayout = city.onLayout(() => draw());
    const handle = {
      city,
      projectId,
      show,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        offLayout?.();
        handles.delete(handle);
        city.setLegend?.(LAYER, null);
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

  // shows a preview on the project's city on screen, or in the city modal over the screen it was asked from (#430)
  function open(projectId, req) {
    pending = null;
    const targets = window.ProjectCityModal?.targets(handles, projectId, 'impact') || [...handles].filter((h) => h.projectId === projectId);
    if (!targets.length) pending = { projectId, ...req }; // a city that attaches later takes it
    for (const h of targets) h.show({ projectId, ...req });
  }

  // a roadmap item as one preview: its issues (the backlog's copy has the body and the runs), their titles and bodies joined
  function itemOf(x, issues) {
    const refs = RoadmapModel.itemIssues(x).map((i) => ({ ...i, ...(issues || []).find((b) => b.number === i.number) }));
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
