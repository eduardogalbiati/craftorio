// Dashboard screen (the start screen): the three workflow categories (each opens the Start drawer
// on it), the gates waiting for approval across runs and the runs in progress. Registers itself with
// registerView (view-registry.js); uses app.js globals ($, esc, state, liveRuns, selectedView,
// pendingGates, selectRun, openGateOf, openDrawer, issueRefs, runSessionStatus, statusLabel).
// renderDashboard is also called by app.js (init, and renderHeader on run events).

function renderDashboard() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const n = state.workflows.filter((w) => w.category === el.dataset.count).length;
    el.textContent = n ? `${n} workflow${n > 1 ? 's' : ''}` : 'no workflows yet';
    el.classList.toggle('none', !n);
  });
  // the runs in progress, or the selected one once it is over
  const list = liveRuns().length ? liveRuns() : state.run ? [selectedView()] : [];
  const box = $('#dash-run');
  box.classList.toggle('hidden', !list.length);
  box.innerHTML = list.map(({ run: r, approvals }) => `<div class="dash-run-row">
      <span class="status st-${esc(runSessionStatus(r.status))}"><span class="status-dot"></span></span>
      <span><b>${esc(r.workflow || 'workflow')}</b>${r.project ? ` · ${esc(r.project)}` : ''}${issueRefs(r) ? ` · ${esc(issueRefs(r))}` : ''} <span class="muted">— ${esc(statusLabel(r))}${approvals.size ? ' · waiting for approval' : ''}</span></span>
      <button class="btn sm ghost" data-run="${esc(r.id)}">View run</button></div>`).join('');
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => selectRun(b.dataset.run)));
  // pending approvals: every gate waiting across runs, each one opening its run (answered there)
  const gates = pendingGates();
  const gbox = $('#dash-gates');
  gbox.classList.toggle('hidden', !gates.length);
  gbox.innerHTML = gates.length ? `<div class="dash-gates-title"><b>Waiting for your approval</b> <span class="nav-gates">${gates.length}</span></div>${gates.map((g) => {
    const r = state.runs.get(g.run_id)?.run;
    return `<div class="dash-run-row">
      <span class="status st-waiting"><span class="status-dot"></span></span>
      <span><b>${esc(r?.workflow || 'workflow')}</b>${r?.project ? ` · ${esc(r.project)}` : ''}${issueRefs(r) ? ` · ${esc(issueRefs(r))}` : ''} <span class="muted">— step ${esc(g.step_id)}</span></span>
      <button class="btn sm primary" data-gate-run="${esc(g.run_id)}">Open run</button></div>`;
  }).join('')}` : '';
  gbox.querySelectorAll('[data-gate-run]').forEach((b) => (b.onclick = () => openGateOf(b.dataset.gateRun)));
}

registerView({
  id: 'dashboard',
  nav: { label: 'Dashboard', order: 20, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>' },
  // the only section shown before any showView: no `hidden`
  markup: `
      <section id="view-dashboard" class="view">
        <div class="dash">
          <h1 class="dash-title">What are we building today?</h1>
          <p class="muted dash-sub">Pick a type of work to see the available workflows.</p>
          <div class="dash-cards">
            <button class="dash-card" data-category="plan">
              <span class="dash-icon plan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></span>
              <b>Plan &amp; Design</b>
              <span class="muted">Spec out features, architecture and scope before coding.</span>
              <span class="dash-count" data-count="plan"></span>
            </button>
            <button class="dash-card" data-category="build">
              <span class="dash-icon build"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg></span>
              <b>Code &amp; Build</b>
              <span class="muted">Implement, review, test, open a PR and ship.</span>
              <span class="dash-count" data-count="build"></span>
            </button>
            <button class="dash-card" data-category="monitor">
              <span class="dash-icon monitor"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg></span>
              <b>Monitor &amp; Improve</b>
              <span class="muted">Watch production, investigate errors and improve.</span>
              <span class="dash-count" data-count="monitor"></span>
            </button>
          </div>
          <div id="dash-gates" class="dash-gates hidden"></div>
          <div id="dash-run" class="dash-run hidden"></div>
        </div>
      </section>`,
  mount() {
    document.querySelectorAll('.dash-card').forEach((b) => (b.onclick = () => openDrawer({ category: b.dataset.category })));
    // the start screen's sidebar entry starts highlighted, as showView would
    $('nav.sidebar [data-view="dashboard"]').classList.toggle('active', state.view === 'dashboard');
  },
  show: renderDashboard,
});
