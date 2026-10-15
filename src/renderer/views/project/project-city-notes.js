// The notes under the City view's header (#373, #381; project-city.js draws them): no plan (the
// folders as districts) or a stale plan (the unmatched share), each with the tab's one action
// "Analyze this project" (#381: the map and the Oracle's analysis as one run, with its combined
// estimate next to it) and the action's state (running with its step, or its error with "Analyze
// again"), then the plan's validation problems, the edges not read, and the aggregation of small
// files over 5,000. html({ model, validation, layout, analysis, ready }) → the notes' HTML ('' when
// there is none); `analysis`: { running, step, error, estimate, estimateTitle } from the Architecture
// tab; `ready`: whether the action can start (the tab gave the city an onAnalyze).
// Uses app.js globals at call time: esc. Browser: window.ProjectCityNotes.
(() => {
  const STALE_COVERAGE = 0.9; // under this share of matched files, the plan is older than the code
  const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const note = (testid, cls, body) => `<div class="r3d-card pc-note${cls ? ` ${cls}` : ''}" data-testid="${testid}">${body}</div>`;

  // the action with its estimate
  function actionHtml(label, analysis, ready) {
    const a = analysis || {};
    const estimate = a.estimate ? `<span class="pc-estimate" title="${esc(a.estimateTitle || '')}">${esc(a.estimate)}</span>` : '';
    const title = a.running ? 'The analysis is running' : 'One run: the cartographer maps the project, then the Oracle analyses its hotspots; the map and the report refresh when it ends';
    return `<div class="pc-actions"><button type="button" class="r3d-primary inline" data-pc-analyze data-testid="project-city-analyze" ${ready && !a.running ? '' : 'disabled'} title="${esc(title)}">${esc(label)}</button>${estimate}</div>`;
  }

  function stateHtml(analysis, ready) {
    const a = analysis;
    if (!a) return '';
    if (a.running) return `<div class="r3d-card pc-note" role="status" data-testid="project-city-analyzing"><b>Analyzing this project</b><p><span class="r3d-dot live"></span> ${esc(a.step || 'starting the run')}…</p></div>`;
    if (a.error) return `<div class="r3d-card pc-note warn" role="alert" data-testid="project-city-analysis-error"><b>The analysis failed</b><p>${esc(a.error)}</p>${actionHtml('Analyze again', a, ready)}</div>`;
    return '';
  }

  /** The notes' HTML, see the header. */
  function html({ model, validation, layout, analysis, ready }) {
    const notes = [];
    const running = !!analysis?.running;
    const action = running ? '' : actionHtml('Analyze this project', analysis, ready);
    if (model.grouping !== 'plan') {
      notes.push(note('project-city-no-plan', '', `<b>No city plan yet</b><p>The districts are the folders. "Analyze this project" has the cartographer name the zones, the districts, the landmarks and the ports, then the Oracle analyses the hotspots.</p>${action}`));
    } else if ((validation?.coverage ?? 1) < STALE_COVERAGE) {
      notes.push(note('project-city-stale', 'warn', `<b>The plan is older than the code</b><p>${pct(1 - validation.coverage)} of the files (${validation.drawn - validation.matched} of ${validation.drawn}) match no district: they stand in the Outskirts. "Analyze this project" refreshes the map (the names you saw stay) and the analysis.</p>${action}`));
    }
    const state = stateHtml(analysis, ready);
    if (state) notes.push(state);
    const v = validation || {};
    const problems = [
      ...(v.schemaErrors || []).map((s) => `The plan: ${s}`),
      ...(v.unknownZones || []).map((u) => `District ${u.district} names an unknown zone ${u.zone}: drawn in the Outskirts.`),
      ...(v.duplicateIds || []).map((id) => `The id ${id} is used twice.`),
      ...(v.missingPaths || []).map((p) => `${p} is not in the repository at this commit (a landmark or a port's file).`),
      ...(v.emptyDistricts || []).map((id) => `District ${id} has no file.`),
    ];
    if (model.grouping === 'plan' && problems.length) notes.push(note('project-city-problems', 'warn', `<b>${plural(problems.length, 'problems')} in the city plan</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`));
    const notRead = typeof model.edges === 'string' ? [model.edges] : model.edgesNotRead || [];
    if (notRead.length) notes.push(note('project-city-edges', '', `<b>Arcs</b> ${esc(notRead.join(', '))}: hovering those files draws no arc.`));
    if (layout.aggregated) notes.push(note('project-city-aggregated', '', `<b>Over 5,000 files</b> ${esc(layout.note)}`));
    return notes.length ? `<div class="pc-notes">${notes.join('')}</div>` : '';
  }

  window.ProjectCityNotes = { html };
})();
