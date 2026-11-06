// The notes under the City view's header (#373, #381; project-city.js draws them): no plan (the
// folders as districts), a stale plan (the unmatched share), commits since the last analysis
// (#782: project-city-moved, how many, or that the analyzed commit is gone) or a current plan (#730: its districts and coverage; #782: "Analyzed on
// <date> · <commit>" and the action as a quiet "Analyze again", no r3d-primary), the others with the tab's one action
// "Analyze this project" (#381: the map and the Oracle's analysis as one run, with its combined
// estimate next to it) and the action's state (running with its step, or its error with "Analyze
// again"), then the plan's validation problems and the aggregation of small files over 5,000 (#428:
// no note for the edges not read). html({ model, validation, layout, analysis, analysed, ready }) → the notes' HTML
// ('' when there is none); `analysis`: { running, step, error, estimate, estimateTitle } from the Architecture
// tab; `analysed`: architecture:city's { date, commit, commitsSince } | null; `ready`: whether the action can start
// (the tab gave the city an onAnalyze). The notes are one
// panel (#441: data-city-panel="notes", "City plan" with its chevron, project-city-panels.js).
// releaseHtml({ validation, from, plan, open }) → the release card's notes (#439): the base's validation
// of today's plan keeps only the plan's own problems (schema, unknown zone, duplicate id); the files and
// districts the base commit lacks arrived after that release, so one muted line "At <from>, N files and
// M districts of today's plan did not exist yet" lists them behind a closed <details>.
// Uses app.js globals at call time: esc. Browser: window.ProjectCityNotes.
(() => {
  const STALE_COVERAGE = 0.9; // under this share of matched files, the plan is older than the code
  const pct = (x) => `${Math.round(x * 100)}%`;
  const note = (testid, cls, body) => `<div class="r3d-card pc-note${cls ? ` ${cls}` : ''}" data-testid="${testid}">${body}</div>`;

  // the action with its estimate; #782: `quiet`, the secondary look of a refresh nothing asks for
  function actionHtml(label, analysis, ready, quiet = false) {
    const a = analysis || {};
    const estimate = a.estimate ? `<span class="pc-estimate" title="${esc(a.estimateTitle || '')}">${esc(a.estimate)}</span>` : '';
    const title = a.running ? t('project_city_notes.the_analysis_is_running') : t('project_city_notes.analyze_title');
    return `<div class="pc-actions"><button type="button" class="${quiet ? 'pc-secondary' : 'r3d-primary inline'}" data-pc-analyze data-testid="project-city-analyze" ${ready && !a.running ? '' : 'disabled'} title="${esc(title)}">${esc(label)}</button>${estimate}</div>`;
  }

  function stateHtml(analysis, ready) {
    const a = analysis;
    if (!a) return '';
    if (a.running) return `<div class="r3d-card pc-note" role="status" data-testid="project-city-analyzing"><b>${t('project_city_notes.analyzing_this_project')}</b><p><span class="r3d-dot live"></span> ${esc(a.step || t('project_city_notes.starting_the_run'))}…</p></div>`;
    if (a.error) return `<div class="r3d-card pc-note warn" role="alert" data-testid="project-city-analysis-error"><b>${t('project_city_notes.the_analysis_failed')}</b><p>${esc(a.error)}</p>${actionHtml(t('project_city_notes.analyze_again'), a, ready)}</div>`;
    return '';
  }

  // #782: "Analyzed on <date> · <commit>" in the owner's language and zone; '' when the date is not known
  function analysedLine(analysed) {
    if (!analysed?.date) return '';
    const zone = window.TimeZone;
    const date = zone ? zone.formatLocale(analysed.date, { dateStyle: 'short' }, zone.current()) : analysed.date.slice(0, 10);
    if (!date) return '';
    const text = analysed.commit ? t('project_city_notes.analyzed_on_commit', { date, commit: analysed.commit }) : t('project_city_notes.analyzed_on', { date });
    return `<p>${esc(text)}</p>`;
  }

  // #782: why the code moved since the analysis: its commits, or its commit gone (a rebase, a force-push); '' when it did not
  function movedReason(analysed) {
    if (analysed?.commitsSince > 0) return t('project_city_notes.commits_since', { count: analysed.commitsSince });
    return analysed?.commit && analysed.commitsSince == null ? t('project_city_notes.commit_gone', { commit: analysed.commit }) : '';
  }

  /** The notes' HTML, see the header. */
  function html({ model, validation, layout, analysis, analysed = null, ready }) {
    const notes = [];
    const running = !!analysis?.running;
    const action = running ? '' : actionHtml(t('project_city_notes.analyze_this_project'), analysis, ready);
    if (model.grouping !== 'plan') {
      notes.push(note('project-city-no-plan', '', `<b>${t('project_city_notes.no_city_plan_yet')}</b><p>${t('project_city_notes.the_districts_are_the_folders_analyze')}</p>${action}`));
    } else if ((validation?.coverage ?? 1) < STALE_COVERAGE) {
      notes.push(note('project-city-stale', 'warn', `<b>${t('project_city_notes.the_plan_is_older_than_the')}</b><p>${pct(1 - validation.coverage)} ${t('project_city_notes.of_the_files_value_of_drawn', { value: validation.drawn - validation.matched, drawn: validation.drawn })}</p>${action}`));
    } else if (action) {
      // #730: a current plan keeps the action, as a refresh of the plan
      const share = Math.floor((validation?.coverage ?? 1) * 1000) / 10;
      const plan = `<p class="small muted">${esc(t('project_architecture.city_plan_districts', { count: (model.districts || []).length, share }))}</p>`;
      // #782: only code that moved asks for a new analysis; a current plan just says when it was made. With an
      // error, the error card below holds the one "Analyze again"
      const moved = movedReason(analysed);
      if (moved) notes.push(note('project-city-moved', '', `<b>${esc(moved)}</b>${plan}${action}`));
      else notes.push(note('project-city-plan', '', `${analysedLine(analysed)}${plan}${analysis?.error ? '' : actionHtml(t('project_city_notes.analyze_again'), analysis, ready, true)}`));
    }
    const state = stateHtml(analysis, ready);
    if (state) notes.push(state);
    const v = validation || {};
    const problems = [
      ...planProblems(v),
      ...(v.missingPaths || []).map((p) => t('project_city_notes.problem_missing_path', { path: p })),
      ...(v.emptyDistricts || []).map((id) => t('project_city_notes.problem_empty_district', { id })),
    ];
    if (model.grouping === 'plan' && problems.length) notes.push(problemsNote(problems));
    if (layout.aggregated) notes.push(note('project-city-aggregated', '', `<b>${t('project_city_notes.over_5_000_files')}</b> ${esc(layout.note)}`));
    if (!notes.length) return '';
    // #441: one panel, "City plan", its chevron folds the notes to its title row
    const title = t('project_city_notes.city_plan');
    const head = `<div class="r3d-card pc-panel-head pc-notes-head"><b>${esc(title)}</b><span class="r3d-grow"></span>${window.ProjectCityPanels?.chevron(title) || ''}</div>`;
    return `<div class="pc-notes" data-city-panel="notes">${head}<div class="pc-notes-body" data-city-panel-body>${notes.join('')}</div></div>`;
  }

  // the plan's own problems, whatever commit it is read at: a schema error, an unknown zone, a duplicate id
  const planProblems = (v) => [
    ...(v.schemaErrors || []).map((s) => t('project_city_notes.problem_schema', { error: s })),
    ...(v.unknownZones || []).map((u) => t('project_city_notes.problem_unknown_zone', { district: u.district, zone: u.zone })),
    ...(v.duplicateIds || []).map((id) => t('project_city_notes.problem_duplicate_id', { id })),
  ];
  const problemsNote = (problems) => note('project-city-problems', 'warn', `<b>${t('project_city_notes.problems_in_the_city_plan', { count: problems.length })}</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`);

  /** The release card's notes (#439), see the header. */
  function releaseHtml({ validation, from, plan, open = false }) {
    const v = validation || {};
    const problems = planProblems(v);
    const files = v.missingPaths || [];
    const districts = (v.emptyDistricts || []).map((id) => (plan?.districts || []).find((d) => d.id === id)?.name || id);
    const parts = [
      files.length ? t('project_city.files_count', { count: files.length }) : '',
      districts.length ? t('project_city.districts_count', { count: districts.length }) : '',
    ].filter(Boolean);
    const what = parts.length > 1 ? t('project_city_release.files_and_districts', { files: parts[0], districts: parts[1] }) : parts[0];
    const later = what
      ? `<details class="pcr-missing muted small" data-testid="city-release-missing" ${open ? 'open' : ''}><summary data-testid="city-release-missing-toggle" aria-expanded="${open}">${esc(t('project_city_release.did_not_exist_yet', { from: from || '?', what }))}</summary><ul>${[...files, ...districts].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`
      : '';
    return `${problems.length ? problemsNote(problems) : ''}${later}`;
  }

  window.ProjectCityNotes = {
    html,
    releaseHtml,
  };
})();
