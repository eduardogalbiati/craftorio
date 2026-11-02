// A project's City tab (#373, #730: the Architecture tab's City view, its own tab since the facts and
// the Oracle's findings moved to the Health tab, views/project/project-health.js): the project as a 3D
// city (views/project/project-city.js, one per project on screen, kept while the tabs switch back and
// forth; #382: its connections panel, views/project/project-city-connections.js; #374: the agents of the
// project's runs in progress, views/project/project-city-agents.js; #375 an issue's footprint, #376 a
// release) drawn from its plan (#731, the cartographer's districts). A building's "Open in Facts" opens
// the Health tab with its hotspot row marked and scrolled to (ProjectHealth.focus).
// One action (#381, workflows/analyze-project.yaml, #631: the old project-map): "Analyze this project",
// in the city's notes, starts the project map run (run:start, a simulation when the app runs simulations
// only) with the Oracle's analysis as its last step, no gate; with a plan saved it is a refresh. Its
// combined estimate stands next to it (chain:estimate for the map from past real runs,
// architecture:estimate for the Oracle's turn; "no estimate yet" before the first real run). The tab
// follows the run through run:event: the step while it runs, then the city read again when it ends, or
// its error. A run started elsewhere (Workflows) for this project shows the same way. Above the city, the
// advice to refresh (more than 5% of the drawn files match no district, or a new top-level folder),
// which never starts anything. The run's folder is the project's own (#732: the project page's project
// before the cached Projects list, which a project the onboarding just made may miss); a project
// without one gets a translated message and no estimate.
// openCity(id) opens the City tab, openFacts(id) the Health tab, for the Project screen only: every
// "Show on the map" (an issue, a stage, a release, a run's replay) opens the city in a modal over the
// screen instead (#430, views/project/project-city-modal.js).
// Drawn into the box project.js gives it (show), its clicks routed from the project page's listeners
// (onClick, onChange). Uses app.js globals at call time: api, esc, errMsg, showToast, state (projects,
// simulationOnly). Browser: window.ProjectArchitecture.
(() => {
  const MAP_WORKFLOW = 'analyze-project.yaml';
  const MAP_NAME = 'analyze-project';
  // the map run's steps: catalog keys project_architecture.step_<id>
  const STEP_LABELS = new Set(['facts', 'plan', 'validate', 'invalid', 'gate', 'save', 'analyze']);
  // the project on screen: { id, box, facts, estimate, error, errorKind, loading, seq,
  // cityMap, mapEstimate, mapStarting, mapRun, mapStep (the project map run, #372/#381: cityMap is architecture:city's answer),
  // city, agents, connections, impact, release (the City view, #373: city is its ProjectCity) }
  let cur = null;

  /** Opens project `id`'s City tab (the Project screen's own; #430: "Show on the map" opens the city modal). */
  function openCity(id) {
    openProjectView(id, { tab: 'city' });
  }

  /** Opens project `id`'s Health tab (#730; #430: the city modal's "Show the facts"), with `file`'s hotspot row marked when given. */
  function openFacts(id, file) {
    if (file) window.ProjectHealth?.focus(id, file);
    openProjectView(id, { tab: 'health' });
  }

  const stepLabel = (id) => (STEP_LABELS.has(id) ? t(`project_architecture.step_${id}`) : id ? t('project_architecture.step_id', { id }) : t('project_architecture.starting_the_run'));

  // ---------- the one action (#381) ----------

  // the combined estimate: the map's (past real runs) plus the Oracle's turn (past real analyses)
  function estimateInfo() {
    const map = cur.mapEstimate?.items?.[0];
    const oracle = cur.estimate;
    const simulated = typeof state !== 'undefined' && state.simulationOnly ? ` ${t('project_architecture.simulations_only_no_model')}` : '';
    const parts = [];
    let usd = 0;
    if (map?.basis) { usd += Number(map.costUsd) || 0; parts.push(t('project_architecture.estimate_map', { count: map.basis, usd: (Number(map.costUsd) || 0).toFixed(2), minutes: map.minutes })); }
    if (oracle) { usd += Number(oracle.usd) || 0; parts.push(t('project_architecture.estimate_oracle', { count: oracle.basis, usd: Number(oracle.usd).toFixed(2) })); }
    if (!parts.length) return { known: false, text: t('project_architecture.no_estimate_yet'), title: t('project_architecture.no_cost_estimate_yet_the_first', { simulated }) };
    const missing = !map?.basis ? `; ${t('project_architecture.estimate_map_missing')}` : !oracle ? `; ${t('project_architecture.estimate_oracle_missing')}` : '';
    return { known: true, text: `≈ US$ ${usd.toFixed(2)}`, title: `${parts.join('; ')}${missing}.${simulated}` };
  }

  function mapAdviceHtml(r) {
    if (!r?.suggested) return '';
    const why = [
      r.unmatchedShare > 0.05 ? t('project_architecture.refresh_unmatched_share', { share: Math.round(r.unmatchedShare * 100) }) : '',
      r.newFolders.length ? t('project_architecture.refresh_new_folders', { count: r.newFolders.length, folders: r.newFolders.join(', ') }) : '',
    ].filter(Boolean).join('; ');
    return `<p class="small" role="status" data-testid="architecture-map-refresh-advised"><span class="badge warn">${t('project_architecture.refresh_advised')}</span> ${esc(why)}${t('project_architecture.analyze_this_project_asks_the_cartographer')}</p>`;
  }

  // the action on its own, when the city view did not load
  function actionHtml() {
    const city = cur.cityMap;
    const hasPlan = city?.model?.grouping === 'plan';
    const planText = !city || city.state !== 'ok' ? ''
      : hasPlan ? t('project_architecture.city_plan_districts', { count: city.model.districts.length, share: Math.floor((city.validation?.coverage || 0) * 1000) / 10 })
        : t('project_architecture.no_city_plan_by_folder');
    const e = estimateInfo();
    const running = !!cur.mapRun;
    const label = t(cur.mapStarting ? 'project_architecture.starting' : running ? 'project_architecture.analyzing' : 'project_architecture.analyze_this_project');
    const noFolder = cur.errorKind === 'no-folder'; // #732: no cost on a retry that cannot work, not even in the tooltip
    const title = running ? t('project_architecture.run_step', { run: cur.mapRun, step: stepLabel(cur.mapStep) }) : t(hasPlan ? 'project_architecture.analyze_title_refresh' : 'project_architecture.analyze_title', { estimate: noFolder ? '' : e.title });
    const progress = running ? `<p class="small" role="status" data-testid="architecture-analyzing" title="${esc(cur.mapRun)}"><span class="badge live">${t('project_architecture.analyzing_this_project')}</span> ${esc(stepLabel(cur.mapStep))}…</p>` : '';
    const error = cur.error ? `<div class="usage-unavailable" role="alert" data-testid="architecture-state-error">${t('project_architecture.the_analysis_failed')} ${esc(cur.error)}</div>` : '';
    return `<section class="arch-action" data-testid="architecture-action">
      <div class="row">
        <button type="button" class="btn primary" data-testid="architecture-analyze" data-arch-analyze ${running || cur.mapStarting ? 'disabled' : ''} title="${esc(title)}">${label}${noFolder ? '' : ` <span class="arch-estimate" data-testid="architecture-estimate">${esc(e.text)}</span>`}</button>
        <span class="small muted">${esc(planText)}</span>
      </div>
      ${progress}${error}${mapAdviceHtml(city?.refresh)}
    </section>`;
  }

  // the City view's copy of the action's state
  const analysisState = () => {
    const e = estimateInfo();
    // #732: no estimate next to a retry that cannot work (the project has no folder)
    const noFolder = cur.errorKind === 'no-folder';
    return { running: !!cur.mapRun, step: cur.mapRun ? stepLabel(cur.mapStep) : null, error: cur.error || null, estimate: noFolder ? null : e.text, estimateTitle: noFolder ? null : e.title };
  };

  // #732: the project's own folder, read fresh at the click (api.listProjects, which also refreshes
  // state.projects): a folder the engine says is gone from this machine (exists: false) counts as none.
  // When that read fails or does not list it: the project page's project (as the Overview reads it),
  // then the cached Projects list.
  const folderIfThere = (p) => (p?.folder && p.exists !== false ? p.folder : null);
  async function folderOf(id) {
    if (typeof api.listProjects === 'function') {
      try {
        const list = await api.listProjects();
        const fresh = Array.isArray(list) ? list.find((p) => p.id === id) : null;
        if (fresh) {
          state.projects = list;
          return folderIfThere(fresh);
        }
      } catch { /* the cached copies below */ }
    }
    const pv = state.pv?.id === id ? folderIfThere(state.pv.project) : null;
    return pv || folderIfThere((state.projects || []).find((p) => p.id === id));
  }

  async function analyze() {
    const c = cur;
    if (!c || c.mapStarting || c.mapRun) return;
    const folder = await folderOf(c.id);
    if (c !== cur || c.mapStarting || c.mapRun) return;
    if (!folder) {
      Object.assign(c, { error: t('project_architecture.no_folder_on_this_machine'), errorKind: 'no-folder' });
      render();
      return;
    }
    Object.assign(c, { mapStarting: true, error: null, errorKind: null });
    render();
    try {
      const out = await api.startRun({ file: MAP_WORKFLOW, inputs: { repo_path: folder, project_id: c.id, mode: 'auto', analyze: true }, mock: !!state.simulationOnly, projectId: c.id });
      if (!out?.runId) throw new Error(out?.error || 'the run did not start');
      Object.assign(c, { mapRun: out.runId, mapStep: null });
      showToast(t('project_architecture.analyzing_this_project_the_cartographer_maps'));
    } catch (e) {
      c.error = errMsg(e);
    }
    c.mapStarting = false;
    if (cur === c) render();
  }

  // the run's events (run:event): the step shown while it runs; when it ends, the city is read again,
  // or its error shown
  function onRunEvent(ev) {
    const c = cur;
    if (!c || !ev) return;
    if (ev.type === 'workflow.started' && !c.mapRun && ev.project_id === c.id && ev.workflow === MAP_NAME) {
      Object.assign(c, { mapRun: ev.run_id, mapStep: null, error: null, errorKind: null });
      render();
      return;
    }
    if (!c.mapRun || ev.run_id !== c.mapRun) return;
    if (ev.type === 'step.started') {
      c.mapStep = ev.step_id;
      render();
    } else if (ev.type === 'workflow.finished') {
      Object.assign(c, { mapRun: null, mapStep: null, error: ev.status === 'success' ? null : ev.error || `the run ended ${ev.status}`, errorKind: null });
      c.city?.reload();
      load();
    }
  }

  // the project's name, as the Projects list has it (app.js state), for the city's header
  const projectName = (id) => (typeof state !== 'undefined' ? state.projects?.find((p) => p.id === id)?.name : '') || '';

  // the advice to refresh above the city, then the project's city (created once, moved back into the box on each render)
  function render() {
    const c = cur;
    if (!c?.box) return;
    if (!window.ProjectCity) {
      c.box.innerHTML = `<div data-testid="architecture" class="arch-city-mode">${actionHtml()}<div class="usage-unavailable" role="alert">${t('project_architecture.the_city_view_did_not_load')}</div></div>`;
      return;
    }
    c.city ||= ProjectCity.create({ projectId: c.id, name: projectName(c.id), onOpenFacts: (file) => { if (cur === c) openFacts(c.id, file); }, onAnalyze: () => { if (cur === c) analyze(); } });
    // #374: the agents of the project's runs in progress on its city (views/project/project-city-agents.js)
    c.agents ||= (window.CityAgents && window.ProjectCityAgents?.attach(c.city, { projectId: c.id, live: false })) || null;
    // #382: the most connected files, a click pins their arcs (views/project/project-city-connections.js)
    c.connections ||= (window.CityConnections && window.ProjectCityConnections?.attach(c.city)) || null;
    // #375: an issue's or a stage's expected footprint on its city (views/project/project-city-impact.js)
    c.impact ||= (window.CityImpact && window.ProjectCityImpact?.attach(c.city, { projectId: c.id })) || null;
    // #376: a release on its city, the previous release in grey (views/project/project-city-release.js)
    c.release ||= (window.CityRelease && window.ProjectCityRelease?.attach(c.city, { projectId: c.id })) || null;
    if (!c.box.contains(c.city.el)) {
      c.box.innerHTML = `<div data-testid="architecture" class="arch-city-mode"><div data-arch-advice></div><div data-arch-city-slot></div></div>`;
      c.box.querySelector('[data-arch-city-slot]').appendChild(c.city.el);
    }
    const advice = c.box.querySelector('[data-arch-advice]');
    if (advice) advice.innerHTML = mapAdviceHtml(c.cityMap?.refresh);
    c.city.update({ facts: c.facts, estimate: c.estimate, analysis: analysisState() });
  }

  async function load() {
    const c = cur;
    if (!c) return;
    const seq = ++c.seq;
    c.loading = true;
    const [facts, estimate, city, mapEstimate] = await Promise.allSettled([
      api.architectureFacts(c.id, {}),
      api.architectureEstimate(c.id),
      api.architectureCity(c.id),
      api.chainEstimate(MAP_WORKFLOW, null),
    ]);
    if (cur !== c || seq !== c.seq) return;
    c.loading = false;
    const value = (r) => (r.status === 'fulfilled' ? r.value : null);
    c.facts = value(facts);
    c.estimate = value(estimate)?.estimate || null;
    c.cityMap = value(city);
    c.mapEstimate = value(mapEstimate);
    c.loaded = true;
    // the run in progress, as the service sees it (a run started before this window opened too)
    if (!c.mapRun && c.cityMap?.mapRun) c.mapRun = c.cityMap.mapRun;
    render();
  }

  /** Draws the tab of project `id` into `box`: read on the first show of a project. */
  function show(id, box) {
    if (cur?.id !== id) {
      cur?.connections?.destroy();
      cur?.agents?.destroy();
      cur?.impact?.destroy();
      cur?.release?.destroy();
      cur?.city?.destroy(); // another project: the previous city gives its WebGL context back
      cur = { id, box, facts: null, estimate: null, error: null, errorKind: null, loading: false, loaded: false, seq: 0,
        cityMap: null, mapEstimate: null, mapStarting: false, mapRun: null, mapStep: null, city: null, agents: null, connections: null, impact: null, release: null };
    }
    cur.box = box;
    render();
    if (!cur.loaded && !cur.loading) load();
  }

  /** A click inside the tab (the action, when the city view did not load); true when it was the tab's. */
  function onClick(e) {
    if (!cur?.box?.contains(e.target)) return false;
    if (!e.target.closest('[data-arch-analyze]')) return false;
    analyze();
    return true;
  }

  /** The City tab has no field of its own: always false. */
  const onChange = () => false;

  // the runs' events reach the tab whatever screen started the run
  if (typeof api !== 'undefined' && typeof api.onEvent === 'function') api.onEvent(onRunEvent);

  window.ProjectArchitecture = {
    onChange,
    onClick,
    onRunEvent,
    openCity,
    openFacts,
    show,
  };
})();
