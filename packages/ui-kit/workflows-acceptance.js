// #794: the current project's repository workflows not accepted at its HEAD (a change to
// .craftorio/workflows/*.yaml asks for acceptance per commit, #485), as an orange count on the
// sidebar's Workflows › Definitions entry, on its folded group and on the screen's Definitions tab
// (every .acceptance-count). Read again when the project changes (current-project.js refresh/set),
// the window takes the focus (once per FOCUS_GAP: the read runs git in the service's process), a
// live merge event or the Backlog's Sync / Push moves HEAD (app.js, backlog.js) and right after an
// acceptance (views/workflows/workflows.js); a slow reply of a previous project never overwrites
// the current one's count. Nothing here accepts anything.
// awaitsAcceptance is the one rule for "waits for acceptance": the count and the screen's block,
// highlight and reason line (views/workflows/workflows.js) share it.
// #40: refusedUntilAccepted narrows it to "a run of it is refused" (an owner's workspace copy runs without the
// acceptance) and defaultAwaitingAcceptance resolves a project's default to that entry: the wizard, the project page
// (Workflows block, Next steps), the Start drawer and the Assign dialog share them; Definitions keeps awaitsAcceptance.
// Uses app.js globals at call time ($, api, t, DefaultWorkflow).
// Browser: window.awaitsAcceptance, window.defaultAwaitingAcceptance, window.refreshWorkflowsAcceptance,
// window.refreshWorkflowsAcceptanceOnFocus, window.refusedUntilAccepted.
(function (root) {
  let seq = 0;
  let lastFocusRead = 0;
  const FOCUS_GAP = 5000;
  const BADGE = (testid) => `<span class="nav-badge warn acceptance-count hidden" data-testid="${testid}"></span>`;
  // the two sidebar badges are drawn on the first count (the entries come from view-registry.js)
  const ensure = (sel, testid) => { const host = $(sel); if (host && !host.querySelector('.acceptance-count')) host.insertAdjacentHTML('beforeend', BADGE(testid)); };

  /** A repository workflow entry not accepted at HEAD (an unreadable one too: its run is refused until accepted); a manifest error entry has no `accepted` and never waits. */
  const awaitsAcceptance = (w) => w.origin === 'repository' && w.accepted === false;
  /** #40: an entry awaiting acceptance whose run is refused: the owner's edited workspace copy of that file (runsCopy 'workspace') runs without it (runs.js runWorkflowFile). */
  const refusedUntilAccepted = (w) => awaitsAcceptance(w) && w.runsCopy !== 'workspace';
  /** #40: the repository entry a project's default name means among `entries` (DefaultWorkflow.installedFile over their files), when its run is refused until accepted; else null. */
  function defaultAwaitingAcceptance(name, entries) {
    const list = (entries || []).filter((w) => w && w.origin === 'repository');
    const bare = String(name || '').replace(/^.*[\\/]/, '').replace(/\.ya?ml$/i, '');
    if (!bare) return null;
    const files = list.map((w) => w.file);
    const file = root.DefaultWorkflow?.installedFile ? root.DefaultWorkflow.installedFile(bare, files) : files.find((f) => f === `${bare}.yaml`);
    const entry = file ? list.find((w) => w.file === file) : null;
    return entry && refusedUntilAccepted(entry) ? entry : null;
  }

  async function refreshWorkflowsAcceptance() {
    const projectId = root.CurrentProject?.get();
    const mine = ++seq;
    const list = projectId ? await api.listWorkflows({ projectId, repositoryOnly: true }).catch(() => []) : [];
    if (mine !== seq) return;
    const names = (list || []).filter(awaitsAcceptance).map((w) => w.name).sort();
    ensure('nav.sidebar .nav-item[data-view="workflows"][data-tab="definitions"]', 'nav-workflows-acceptance');
    ensure('nav.sidebar .nav-group[data-group="workflows"] .nav-group-title', 'nav-group-workflows-acceptance');
    document.querySelectorAll('.acceptance-count').forEach((el) => {
      el.textContent = String(names.length);
      el.classList.toggle('hidden', !names.length);
      el.title = names.length ? t('app.workflows_waiting_acceptance', { count: names.length, names: names.join(', ') }) : '';
    });
  }

  // the window's focus: a pull made outside the app may have moved HEAD; a window switched back and
  // forth reads once per FOCUS_GAP
  function refreshWorkflowsAcceptanceOnFocus() {
    const now = Date.now();
    if (now - lastFocusRead < FOCUS_GAP) return;
    lastFocusRead = now;
    refreshWorkflowsAcceptance();
  }

  root.awaitsAcceptance = awaitsAcceptance;
  root.defaultAwaitingAcceptance = defaultAwaitingAcceptance;
  root.refreshWorkflowsAcceptance = refreshWorkflowsAcceptance;
  root.refreshWorkflowsAcceptanceOnFocus = refreshWorkflowsAcceptanceOnFocus;
  root.refusedUntilAccepted = refusedUntilAccepted;
})(typeof window !== 'undefined' ? window : globalThis);
