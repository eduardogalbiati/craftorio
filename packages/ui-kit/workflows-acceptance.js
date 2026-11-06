// #794: the current project's repository workflows not accepted at its HEAD (a change to
// .multiagent/workflows/*.yaml asks for acceptance per commit, #485), as an orange count on the
// sidebar's Workflows › Definitions entry, on its folded group and on the screen's Definitions tab
// (every .acceptance-count). Read again when the project changes (current-project.js), the window
// takes the focus, a live merge event or the Backlog's Sync / Push moves HEAD (app.js, backlog.js)
// and right after an acceptance (views/workflows/workflows.js); a slow reply of a previous project
// never overwrites the current one's count. Nothing here accepts anything.
// Uses app.js globals at call time ($, api, t). Browser: window.refreshWorkflowsAcceptance.
(function (root) {
  let seq = 0;
  const BADGE = (testid) => `<span class="nav-badge warn acceptance-count hidden" data-testid="${testid}"></span>`;
  // the two sidebar badges are drawn on the first count (the entries come from view-registry.js)
  const ensure = (sel, testid) => { const host = $(sel); if (host && !host.querySelector('.acceptance-count')) host.insertAdjacentHTML('beforeend', BADGE(testid)); };

  async function refreshWorkflowsAcceptance() {
    const projectId = root.CurrentProject?.get();
    const mine = ++seq;
    const list = projectId ? await api.listWorkflows({ projectId, repositoryOnly: true }).catch(() => []) : [];
    if (mine !== seq) return;
    const names = (list || []).filter((w) => w.origin === 'repository' && !w.error && w.accepted === false).map((w) => w.name).sort();
    ensure('nav.sidebar .nav-item[data-view="workflows"][data-tab="definitions"]', 'nav-workflows-acceptance');
    ensure('nav.sidebar .nav-group[data-group="workflows"] .nav-group-title', 'nav-group-workflows-acceptance');
    document.querySelectorAll('.acceptance-count').forEach((el) => {
      el.textContent = String(names.length);
      el.classList.toggle('hidden', !names.length);
      el.title = names.length ? t('app.workflows_waiting_acceptance', { count: names.length, names: names.join(', ') }) : '';
    });
  }

  root.refreshWorkflowsAcceptance = refreshWorkflowsAcceptance;
})(typeof window !== 'undefined' ? window : globalThis);
