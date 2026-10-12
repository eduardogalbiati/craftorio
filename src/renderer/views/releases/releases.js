/* global api */
// Releases screen (#260; Code & Build › Releases, src/releases.js): for the project chosen in the
// header, the next release (what merged locally since the last one: its issues, the commits not
// pushed, the runs and their cost; notes generated from them, editable until Ship and saved when the
// field is left; "Run the release checks" starts the release workflow, whose Ship gate is answered
// in the run) and the releases shipped, newest first (version, date, issues, runs, cost, the unit
// and E2E results, notes, the release summary its release run wrote: #290, read when it is opened).
// Nothing here pushes: Ship is the release run's own gate.
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state, api,
// errMsg, dateOf, devMode, confirmDialog, markdownHtml) and window.CurrentProject, window.showRun.

(() => {
  const rel = { projectId: null, data: null };

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const usd = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  const count = (runs) => (Array.isArray(runs) ? runs.length : Number(runs) || 0);
  const issuesHtml = (issues) => (issues?.length
    ? `<ul class="rel-issues">${issues.map((i) => `<li><span class="mono muted">#${esc(i.number)}</span> <span title="${esc(i.title || '')}">${esc(i.title || '')}</span></li>`).join('')}</ul>`
    : '<p class="muted small rel-none">No issue.</p>');

  // A suite's result as a badge: "Unit ✔ 412 passed". `t`: 'pass' | 'fail' | { status?, passed?, failed? }.
  function suiteBadge(name, t) {
    if (t == null) return '';
    const o = typeof t === 'string' ? { status: t } : t;
    const failed = Number(o.failed) || 0;
    const ok = o.status ? o.status === 'pass' : !failed;
    const counts = o.passed != null ? ` ${esc(o.passed)} passed${failed ? `, ${failed} failed` : ''}` : '';
    return `<span class="badge ${ok ? 'rel-pass' : 'warn'}" title="${esc(`${name} suite: ${ok ? 'green' : 'red'} when the release shipped`)}">${name} <span aria-hidden="true">${ok ? '✔' : '✖'}</span>${counts}</span>`;
  }

  // The next release: what it holds, its notes (editable until Ship) and the start of its release run.
  function nextHtml(d) {
    const n = d.next;
    if (!n) return '';
    const what = [plural(n.issues?.length || 0, 'issue'), `${plural(Number(n.commits) || 0, 'commit')} not pushed`, plural(count(n.runs), 'run'), ...(n.cost ? [usd(n.cost)] : [])];
    const version = n.version || d.line?.name || '';
    const going = d.run
      ? `<span class="badge live">${d.run.waiting ? 'waiting for your Ship' : 'release run in progress'}${d.run.mock ? ' · simulated' : ''}</span>
          <button class="btn sm" type="button" data-rel-run="${esc(d.run.runId)}">Open the run</button>`
      : `<label class="check small dev-only" title="Developer mode: the run is simulated, nothing is run or pushed"><input type="checkbox" id="rel-simulate"${state.simulationOnly ? ' checked' : ''} /><span>Simulated</span></label>
          <button class="btn sm primary" type="button" data-rel-start title="Runs the whole unit suite and the whole E2E suite on the local base, then asks you to Ship or Hold. Nothing is pushed before your Ship.">Run the release checks</button>`;
    return `
      <section class="rel-next" data-testid="release-next" aria-label="Next release">
        <div class="rel-head">
          <b class="rel-title">Next release</b>
          ${d.line ? `<span class="badge" title="The roadmap's cut line waiting for this release">cut line: ${esc(d.line.name)}</span>` : ''}
          <span class="muted small">${esc(what.join(' · '))}${n.since ? ` since ${esc(dateOf(n.since))}` : ''}</span>
        </div>
        ${issuesHtml(n.issues)}
        <div class="field">
          <label for="rel-notes">Release notes</label>
          <textarea id="rel-notes" data-testid="release-notes" rows="8" spellcheck="true">${esc(n.notes || '')}</textarea>
          <div class="hint">Generated from the issues and runs until you edit them; saved when you leave the field (empty: generated again). Ship records them with the release.</div>
        </div>
        <div class="rel-actions">
          <div class="field rel-version-field">
            <label for="rel-version">Version</label>
            <input type="text" id="rel-version" value="${esc(version)}" placeholder="e.g. v1.4" autocomplete="off"${d.run ? ' disabled' : ''} />
          </div>
          <span class="spacer"></span>
          ${going}
        </div>
      </section>`;
  }

  function rowHtml(r) {
    const tests = r.tests || {};
    const where = [r.tag && r.tag !== r.version ? `tag ${r.tag}` : '', r.commit ? `commit ${String(r.commit).slice(0, 8)}` : ''].filter(Boolean).join(' · ');
    return `
      <article class="rel-row" data-testid="release-row">
        <div class="rel-head">
          <b class="rel-title"${where ? ` title="${esc(where)}"` : ''}>${esc(r.version)}</b>
          <span class="badge rel-pass">${esc(r.status || 'shipped')}</span>
          <span class="muted small">${r.date ? esc(dateOf(r.date)) : ''}</span>
          <span class="spacer"></span>
          ${suiteBadge('Unit', tests.unit)}${suiteBadge('E2E', tests.e2e)}
          <span class="badge" title="The runs merged into this release, its release run included">${plural(count(r.runs), 'run')}</span>
          ${r.cost != null ? `<span class="badge" title="What its runs cost">${usd(r.cost)}</span>` : ''}
        </div>
        ${issuesHtml(r.issues)}
        ${r.notes ? `<details class="rel-notes"><summary class="small muted">Notes</summary><div class="md md-compact">${markdownHtml(r.notes)}</div></details>` : ''}
        ${r.summary ? `<details class="rel-notes"><summary class="small muted" data-testid="release-summary-link" data-rel-summary="${esc(r.version)}" title="What the release run did: its rounds, its fixes, what to check before shipping, follow-ups">Release summary</summary>
          <div class="md md-compact rel-summary" data-testid="release-summary"><p class="muted small">Loading…</p></div></details>` : ''}
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
      box.innerHTML = '<div class="empty-state"><b>No project yet</b><p class="muted">Choose or create a project in the header: its releases show here.</p></div>';
      return;
    }
    const list = d.releases?.length
      ? d.releases.map(rowHtml).join('')
      : '<div class="empty-state"><b>No release yet</b><p class="muted">Draw a cut line on the Roadmap ("Release here") or run the release checks: your Ship pushes the local base, tags it and lists the release here.</p></div>';
    box.innerHTML = `${nextHtml(d)}<h2 class="rel-list-title">Shipped</h2><div class="rel-list" data-testid="releases-list">${list}</div>`;
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
    if (!simulated && !await confirmDialog('Run the release checks', 'The whole unit suite and the whole E2E suite run on the local base, with no agent while they are green; a red suite calls the developer, which uses your CLI subscription and costs money. Nothing is pushed until you choose Ship at its gate.', 'Run')) return;
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
    markup: `
      <section id="view-releases" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Releases</h1>
            <p class="muted small">What shipped and what the next release holds, for the project chosen in the header. A release run checks the whole unit and E2E suites; nothing is pushed without your Ship.</p>
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
        if (run) window.showRun(run.dataset.relRun);
        else if (summary) openSummary(summary);
        else if (e.target.closest('[data-rel-start]')) start();
      });
    },
    show: refresh,
  });
})();
