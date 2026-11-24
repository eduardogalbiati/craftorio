/* global api */
// Releases screen (#260; Code & Build › Releases, packages/engine/domains/releases/releases.js): for the project chosen in the
// header, the next release (what merged locally since the last one: its issues, the commits not
// pushed, the runs and their cost; notes generated from them, editable until Ship and saved when the
// field is left; "Run the release checks" starts the release workflow, whose Ship gate is answered
// in the run) and the releases shipped, newest first (version, date, issues, runs, cost, the unit
// and E2E results, notes, the release summary its release run wrote: #290, read when it is opened).
// Nothing here pushes: Ship is the release run's own gate.
// #376: a tagged release's "Show on the map" opens the project city at the previous tag in grey, what
// the release changed in colour (window.ProjectCityRelease, views/project/project-city-release.js).
// #436: the last three releases above the version field and "Suggest version" (window.ReleaseName).
// #489 "rc + stable": the release candidates since the last stable (an rc per merge into main: its
// run, its issues), each with "Hold" (the night's train skips it; no confirmation, "Take off hold"
// undoes it) and "Promote to stable" (a dialog with the stable version suggested from the issues'
// labels, editable; a refusal, e.g. a commit without an rc, stays in the dialog). The newest stable
// release reads "Latest" and names the rc it came from.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, devMode, confirmDialog, markdownHtml) and window.CurrentProject, window.showRun.

(() => {
  // promote: the candidate the promotion dialog is open for ({ tag, commit }), busy: a promotion in flight
  const rel = { projectId: null, data: null, promote: null, busy: false };

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

  // #489: the release candidates since the last stable (an rc per merge into main), newest first,
  // each with its run, its issues, "Hold" and "Promote to stable"
  function candidatesHtml(d) {
    const list = d.candidates || [];
    if (!list.length) return '';
    const row = (c, k) => {
      const held = !!c.held;
      return `
      <article class="rel-row rel-candidate" data-testid="release-candidate" data-held="${held}">
        <div class="rel-head">
          <b class="rel-title mono"${c.commit ? ` title="${esc(t('releases.commit_sha', { sha: String(c.commit).slice(0, 8) }))}"` : ''}>${esc(c.tag)}</b>
          ${held ? `<span class="badge warn" title="${t('releases.held_tip')}">${t('releases.held')}</span>` : ''}
          <span class="muted small">${c.date ? esc(dateOf(c.date)) : ''}</span>
          <span class="spacer"></span>
          ${c.runId ? `<button type="button" class="btn sm ghost mono" data-rel-run="${esc(c.runId)}" title="${t('releases.open_the_run')}">${esc(c.runId)}</button>` : ''}
          <button type="button" class="btn sm" data-testid="hold-candidate" data-tag="${esc(c.tag)}" data-held="${held}" title="${held ? '' : t('releases.hold_tip')}">${held ? t('releases.take_off_hold') : t('releases.hold')}</button>
          <button type="button" class="btn sm${k === 0 ? ' primary' : ''}" data-testid="promote-to-stable" data-tag="${esc(c.tag)}" data-commit="${esc(c.commit || '')}">${t('releases.promote_to_stable')}</button>
        </div>
        ${issuesHtml(c.issues)}
      </article>`;
    };
    return `
      <h2 class="rel-list-title">${t('releases.candidates')}</h2>
      <p class="muted small">${t('releases.candidates_hint')}</p>
      <div class="rel-list" data-testid="release-candidates">${list.map(row).join('')}</div>`;
  }

  // #489: the promotion's dialog: the stable version suggested for the candidate, editable; a refusal
  // stays in the dialog (promote-error) with the version kept
  function openPromote(btn) {
    const c = (rel.data?.candidates || []).find((x) => x.tag === btn.dataset.tag);
    rel.promote = { tag: btn.dataset.tag, commit: btn.dataset.commit || c?.commit || '' };
    $('#rel-promote-title').textContent = t('releases.promote_title', { rc: rel.promote.tag });
    $('#rel-promote-text').textContent = t('releases.promote_dialog_text', { commit: String(rel.promote.commit).slice(0, 8) });
    $('#rel-promote-version').value = c?.stable || rel.data?.stable?.version || '';
    // the version the rc was built with (package.json's, in its tag): a promotion does not rebuild it
    const built = (/^v?(.+)-rc\.\d+$/.exec(rel.promote.tag || '') || [])[1] || '';
    $('#rel-promote-built').textContent = built ? t('releases.promote_built_as', { version: built }) : '';
    $('#rel-promote-error').textContent = '';
    $('#rel-promote-modal').classList.remove('hidden');
    $('#rel-promote-version').focus({ preventScroll: true });
  }

  const closePromote = () => { $('#rel-promote-modal').classList.add('hidden'); rel.promote = null; };

  async function confirmPromote() {
    const version = $('#rel-promote-version').value.trim();
    if (!version) { $('#rel-promote-error').textContent = t('releases.version_needed'); return; }
    if (!rel.promote || rel.busy) return;
    rel.busy = true;
    $('#rel-promote-error').textContent = '';
    try {
      rel.data = await api.promoteRelease(rel.projectId, rel.promote.commit, version);
      closePromote();
      render();
    } catch (e) {
      $('#rel-promote-error').textContent = errMsg(e);
    } finally {
      rel.busy = false;
    }
  }

  // #489: Hold (no confirmation: it is undone by "Take off hold") or off
  async function hold(btn) {
    try {
      rel.data = btn.dataset.held === 'true'
        ? await api.holdCandidate(rel.projectId, btn.dataset.tag, false)
        : await api.holdCandidate(rel.projectId, btn.dataset.tag);
      $('#rel-error').textContent = '';
      render();
    } catch (e) {
      $('#rel-error').textContent = errMsg(e);
    }
  }

  // #46: `latest` is the main product's last release; one of another product (`product`) never is
  function rowHtml(r, latest) {
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
        ${latest || r.rc ? `<div class="rel-head">
          ${latest ? `<span class="badge rel-pass" data-testid="release-latest" title="${t('releases.latest_tip')}">${t('releases.latest')}</span>` : ''}
          ${r.rc ? `<span class="muted small mono">${esc(t('releases.from_rc', { rc: r.rc }))}</span>` : ''}
        </div>` : ''}
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
    if (!d?.next && !d?.releases?.length && !d?.candidates?.length) {
      box.innerHTML = `<div class="empty-state"><b>${t('releases.no_project_yet')}</b><p class="muted">${t('releases.choose_or_create_a_project_in')}</p></div>`;
      return;
    }
    const latest = d.releases?.find((r) => !r.product);
    const list = d.releases?.length
      ? d.releases.map((r) => rowHtml(r, r === latest)).join('')
      : `<div class="empty-state"><b>${t('releases.no_release_yet')}</b><p class="muted">${t('releases.draw_a_cut_line_on_the')}</p></div>`;
    box.innerHTML = `${nextHtml(d)}${candidatesHtml(d)}<h2 class="rel-list-title">${t('releases.shipped')}</h2><div class="rel-list" data-testid="releases-list">${list}</div>`;
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
    nav: { label: 'Releases', order: 47, group: 'build', title: 'What shipped and what the next release holds: checked by the release workflow, pushed only on your Ship', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>' },
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
        <div id="rel-promote-modal" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="rel-promote-title" data-testid="promote-dialog">
          <form id="rel-promote-form" class="modal-card">
            <h3 id="rel-promote-title">${t('releases.promote_to_stable')}</h3>
            <p id="rel-promote-text" class="muted small"></p>
            <div class="field">
              <label for="rel-promote-version">${t('releases.stable_version')}</label>
              <input type="text" id="rel-promote-version" data-testid="stable-version-input" autocomplete="off" placeholder="${t('releases.version_placeholder')}" />
              <div class="hint">${t('releases.stable_version_hint')}</div>
              <div id="rel-promote-built" class="hint" data-testid="promote-built-version"></div>
            </div>
            <p id="rel-promote-error" class="error small" role="alert" data-testid="promote-error"></p>
            <div class="modal-actions">
              <button type="button" id="rel-promote-cancel" class="btn ghost">${t('common.cancel')}</button>
              <button type="submit" class="btn primary" data-testid="confirm-promote">${t('releases.promote')}</button>
            </div>
          </form>
        </div>
      </section>`,
    mount() {
      const box = $('#rel-body');
      $('#rel-promote-form').addEventListener('submit', (e) => { e.preventDefault(); confirmPromote(); });
      $('#rel-promote-cancel').addEventListener('click', closePromote);
      box.addEventListener('change', (e) => { if (e.target.id === 'rel-notes') saveNotes(e.target); });
      box.addEventListener('click', (e) => {
        const run = e.target.closest('[data-rel-run]');
        const summary = e.target.closest('[data-rel-summary]');
        const map = e.target.closest('[data-testid="release-show-map"]');
        const holdBtn = e.target.closest('[data-testid="hold-candidate"]');
        const promote = e.target.closest('[data-testid="promote-to-stable"]');
        if (holdBtn) hold(holdBtn);
        else if (promote) openPromote(promote);
        else if (run) window.showRun(run.dataset.relRun);
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
