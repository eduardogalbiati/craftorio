/* global api */
// Releases screen (#260; Code & Build › Releases, src/releases.js): for the project chosen in the
// header, the next release (what merged locally since the last one: its issues, the commits not
// pushed, the runs and their cost; notes generated from them, editable until Ship and saved when the
// field is left; "Run the release checks" starts the release workflow, whose Ship gate is answered
// in the run) and the releases shipped, newest first (version, date, issues, runs, cost, the unit
// and E2E results, notes, the release summary its release run wrote: #290, read when it is opened).
// Nothing here pushes: Ship is the release run's own gate.
// #376: a tagged release's "Show on the map" opens the project city at the previous tag in grey, what
// the release changed in colour (window.ProjectCityRelease, views/project/project-city-release.js).
// #436: the last three releases above the version field and "Suggest version" (window.ReleaseName).
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, devMode, confirmDialog, markdownHtml) and window.CurrentProject, window.showRun.

(() => {
  const rel = { projectId: null, data: null };

  const plural = (n, key) => t(key, { count: n });
  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const count = (runs) => (Array.isArray(runs) ? runs.length : Number(runs) || 0);
  const issuesHtml = (issues) => (issues?.length
    ? `<ul class="rel-issues">${issues.map((i) => `<li><span class="mono muted">#${esc(i.number)}</span> <span title="${esc(i.title || '')}">${esc(i.title || '')}</span></li>`).join('')}</ul>`
    : `<p class="muted small rel-none">${t('releases.no_issue')}</p>`);

  // A suite's result as a badge: "Unit ✔ 412 passed". `t`: 'pass' | 'fail' | { status?, passed?, failed? }.
  function suiteBadge(name, t) {
    if (t == null) return '';
    const o = typeof t === 'string' ? { status: t } : t;
    const failed = Number(o.failed) || 0;
    const ok = o.status ? o.status === 'pass' : !failed;
    const counts = o.passed != null ? ` ${I18n.t('releases.passed_count', { passed: esc(o.passed) })}${failed ? I18n.t('releases.failed_count_suffix', { failed }) : ''}` : '';
    return `<span class="badge ${ok ? 'rel-pass' : 'warn'}" title="${esc(I18n.t(ok ? 'releases.suite_green_when_shipped' : 'releases.suite_red_when_shipped', { name }))}">${name} <span aria-hidden="true">${ok ? '✔' : '✖'}</span>${counts}</span>`;
  }

  // The next release: what it holds, its notes (editable until Ship) and the start of its release run.
  function nextHtml(d) {
    const n = d.next;
    if (!n) return '';
    const what = [plural(n.issues?.length || 0, 'releases.issues_count'), plural(Number(n.commits) || 0, 'releases.commits_not_pushed_count'), plural(count(n.runs), 'releases.runs_count'), ...(n.cost ? [usd(n.cost)] : [])];
    const version = n.version || d.line?.name || '';
    const going = d.run
      ? `<span class="badge live">${d.run.waiting ? t('releases.waiting_for_your_ship') : t('releases.release_run_in_progress')}${d.run.mock ? t('releases.simulated_2') : ''}</span>
          <button class="btn sm" type="button" data-rel-run="${esc(d.run.runId)}">${t('releases.open_the_run')}</button>`
      : `<label class="check small dev-only" title="${t('releases.developer_mode_the_run_is_simulated')}"><input type="checkbox" id="rel-simulate"${state.simulationOnly ? ' checked' : ''} /><span>${t('releases.simulated')}</span></label>
          <button class="btn sm primary" type="button" data-rel-start title="${t('releases.runs_the_whole_unit_suite_and')}">${t('releases.run_the_release_checks')}</button>`;
    return `
      <section class="rel-next" data-testid="release-next" aria-label="${t('releases.next_release')}">
        <div class="rel-head">
          <b class="rel-title">${t('releases.next_release')}</b>
          ${d.line ? `<span class="badge" title="${t('releases.the_roadmap_s_cut_line_waiting')}">${t('releases.cut_line')} ${esc(d.line.name)}</span>` : ''}
          <span class="muted small">${esc(what.join(' · '))}${n.since ? ` ${t('releases.since_date', { date: esc(dateOf(n.since)) })}` : ''}</span>
        </div>
        ${issuesHtml(n.issues)}
        <div class="field">
          <label for="rel-notes">${t('releases.release_notes')}</label>
          <textarea id="rel-notes" data-testid="release-notes" rows="8" spellcheck="true">${esc(n.notes || '')}</textarea>
          <div class="hint">${t('releases.generated_from_the_issues_and_runs')}</div>
        </div>
        <div class="rel-actions">
          <div class="field rel-version-field">
            ${window.ReleaseName.recentHtml(d.releases)}
            <label for="rel-version">${t('releases.version')}</label>
            <div class="rel-version-row">
              <input type="text" id="rel-version" value="${esc(version)}" placeholder="${t('releases.version_placeholder')}" autocomplete="off"${d.run ? ' disabled' : ''} />
              ${d.run ? '' : window.ReleaseName.suggestHtml()}
            </div>
            ${window.ReleaseName.reasonHtml('rel-version-reason')}
          </div>
          <span class="spacer"></span>
          ${going}
        </div>
      </section>`;
  }

  function rowHtml(r) {
    const tests = r.tests || {};
    const where = [r.tag && r.tag !== r.version ? t('releases.tag_name', { tag: r.tag }) : '', r.commit ? t('releases.commit_sha', { sha: String(r.commit).slice(0, 8) }) : ''].filter(Boolean).join(' · ');
    return `
      <article class="rel-row" data-testid="release-row">
        <div class="rel-head">
          <b class="rel-title"${where ? ` title="${esc(where)}"` : ''}>${esc(r.version)}</b>
          <span class="badge rel-pass">${esc(r.status || t('releases.status_shipped'))}</span>
          <span class="muted small">${r.date ? esc(dateOf(r.date)) : ''}</span>
          <span class="spacer"></span>
          ${suiteBadge('Unit', tests.unit)}${suiteBadge('E2E', tests.e2e)}
          <span class="badge" title="${t('releases.the_runs_merged_into_this_release')}">${plural(count(r.runs), 'releases.runs_count')}</span>
          ${r.cost != null ? `<span class="badge" title="${t('releases.what_its_runs_cost')}">${usd(r.cost)}</span>` : ''}
          ${r.tag ? `<button type="button" class="btn sm" data-testid="release-show-map" data-tag="${esc(r.tag)}" title="${t('releases.the_project_city_at_the_previous')}">${t('releases.show_on_the_map')}</button>` : ''}
        </div>
        ${issuesHtml(r.issues)}
        ${r.notes ? `<details class="rel-notes"><summary class="small muted">${t('releases.notes')}</summary><div class="md md-compact">${markdownHtml(r.notes)}</div></details>` : ''}
        ${r.summary ? `<details class="rel-notes"><summary class="small muted" data-testid="release-summary-link" data-rel-summary="${esc(r.version)}" title="${t('releases.what_the_release_run_did_its')}">${t('releases.release_summary')}</summary>
          <div class="md md-compact rel-summary" data-testid="release-summary"><p class="muted small">${t('releases.loading')}</p></div></details>` : ''}
      </article>`;
  }

  // #290: a release's summary, read once when its row opens it (an error can be retried)
  async function openSummary(link) {
    const box = link.closest('details')?.querySelector('.rel-summary');
    if (!box || box.dataset.loaded) return;
    box.dataset.loaded = '1';
    try {
      const { text } = await api.readReleaseSummary(rel.projectId, link.dataset.relSummary);
      box.innerHTML = markdownHtml(text);
    } catch (e) {
      delete box.dataset.loaded;
      box.innerHTML = `<p class="error small">${esc(errMsg(e))}</p>`;
    }
  }

  function render() {
    const d = rel.data;
    const box = $('#rel-body');
    if (!d?.next && !d?.releases?.length) {
      box.innerHTML = `<div class="empty-state"><b>${t('releases.no_project_yet')}</b><p class="muted">${t('releases.choose_or_create_a_project_in')}</p></div>`;
      return;
    }
    const list = d.releases?.length
      ? d.releases.map(rowHtml).join('')
      : `<div class="empty-state"><b>${t('releases.no_release_yet')}</b><p class="muted">${t('releases.draw_a_cut_line_on_the')}</p></div>`;
    box.innerHTML = `${nextHtml(d)}<h2 class="rel-list-title">${t('releases.shipped')}</h2><div class="rel-list" data-testid="releases-list">${list}</div>`;
  }

  async function refresh() {
    rel.projectId = window.CurrentProject?.get() || null;
    $('#rel-error').textContent = '';
    try {
      rel.data = await api.listReleases(rel.projectId);
    } catch (e) {
      rel.data = null;
      $('#rel-error').textContent = errMsg(e);
    }
    render();
  }

  // The notes are saved when the field is left (never on a keystroke); the field is not redrawn.
  async function saveNotes(field) {
    try {
      const d = await api.saveReleaseNotes(rel.projectId, field.value);
      rel.data = d;
      $('#rel-error').textContent = '';
    } catch (e) {
      $('#rel-error').textContent = errMsg(e);
    }
  }

  async function start() {
    const simulated = !!$('#rel-simulate')?.checked && devMode();
    const version = $('#rel-version').value.trim();
    if (!simulated && !await confirmDialog(t('releases.run_the_release_checks'), t('releases.the_whole_unit_suite_and_the'), t('releases.run'))) return;
    try {
      const { runId } = await api.startRelease(rel.projectId, version, simulated);
      window.showRun(runId);
    } catch (e) {
      $('#rel-error').textContent = errMsg(e);
    }
  }

  registerView({
    id: 'releases',
    nav: { label: 'Releases', order: 47, group: 'code', title: 'What shipped and what the next release holds: checked by the release workflow, pushed only on your Ship', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>' },
    markup: () => `
      <section id="view-releases" class="view hidden">
        <div class="page-head">
          <div>
            <h1>${t('releases.releases')}</h1>
            <p class="muted small">${t('releases.what_shipped_and_what_the_next')}</p>
          </div>
        </div>
        <p id="rel-error" class="error small"></p>
        <div id="rel-body" class="rel-body"></div>
      </section>`,
    mount() {
      const box = $('#rel-body');
      box.addEventListener('change', (e) => { if (e.target.id === 'rel-notes') saveNotes(e.target); });
      box.addEventListener('click', (e) => {
        const run = e.target.closest('[data-rel-run]');
        const summary = e.target.closest('[data-rel-summary]');
        const map = e.target.closest('[data-testid="release-show-map"]');
        if (run) window.showRun(run.dataset.relRun);
        else if (map) window.ProjectCityRelease?.showRelease(rel.projectId, { to: map.dataset.tag });
        else if (summary) openSummary(summary);
        else if (e.target.closest('[data-rel-start]')) start();
        // #436: fills the version from the last release and the next one's issues; never starts it
        else if (e.target.closest('[data-testid="suggest-version"]')) {
          window.ReleaseName.suggest({ input: $('#rel-version'), reasonEl: $('#rel-version-reason'), releases: rel.data?.releases, issues: rel.data?.next?.issues });
        }
      });
    },
    show: refresh,
  });
})();
