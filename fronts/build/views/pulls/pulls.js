/* global api */
// PRs / MRs screen (#812; Code & Build › PRs, "MRs" on GitLab): every open pull/merge request of the project chosen
// in the header, grouped by what it needs (the engine's run-pr.js listPulls, channel pulls:list): Need you (ready to
// merge, changes requested, a conflict), Waiting (CI running, someone else's review) and Others (Dependabot, a PR no
// run opened). Each entry is the run's PR card (packages/shared/pr-card.js: its lines, Merge, Merge ignoring
// protection and Close) with a link to its run when a run opened it; a PR with no run never offers Ask for a fix (that
// one lives on the run's card). A stack (#807) sits together, bottom first, Merge on its bottom PR only (the engine's
// mergeOptions). A project that cannot be read says so; the empty states tell no PR, no remote and no gh / glab apart.
// Read when the screen opens and every READ_EVERY (a failed read sooner, RETRY_EVERY), never in a tight loop. The
// menu entry counts the Need-you entries (data-testid pulls-menu-count, removed at 0), read at the app's start and
// when the project changes (current-project.js), and its label follows the project's platform (PrCard's request word).
// Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, t, state, api, errMsg,
// confirmDialog, showToast) and window.CurrentProject, window.showRun, window.PrCard, window.Platforms.
// Browser: window.PullsView = { menuLabel, needYouCount, refreshCount }.

(() => {
  const READ_EVERY = 3 * 60 * 1000;
  const RETRY_EVERY = 30 * 1000;
  const GROUPS = [['needYou', 'need-you', 'pulls.group_need_you'], ['waiting', 'waiting', 'pulls.group_waiting'], ['others', 'others', 'pulls.group_others']];
  const ACTIONS = { merge: 'pr-merge', merge_admin: 'pr-merge-admin', close: 'pr-close' };
  // seq: the latest read (a slow answer of a previous project never overwrites the current one's)
  const pv = { seq: 0, timer: null, answer: null, busy: false };

  const platformOf = (id) => window.Platforms?.findPlatform(id) || window.Platforms?.PLATFORMS?.[0];
  // #812: the menu's word for the platform's requests: PRs (GitHub) / MRs (GitLab), from the adapter's request.short
  const menuLabel = (platformId) => t(`pulls.menu_${String(platformOf(platformId)?.request?.short || 'PR').toLowerCase()}s`);
  // #812: the menu's count: the Need-you entries of every listed project
  const needYouCount = (answer) => (answer?.projects || []).reduce((n, p) => n + (p?.groups?.needYou?.length || 0), 0);

  const currentPlatform = () => {
    const id = window.CurrentProject?.get();
    const project = (state.projects || []).find((p) => p.id === id);
    return project ? window.Platforms?.projectPlatform?.(project)?.id : null;
  };

  // the sidebar's entry: its label (PRs / MRs) and its count, a badge removed at 0 (its name then has no digit)
  function paintMenu(count) {
    const btn = document.querySelector('nav.sidebar .nav-item[data-view="pulls"]');
    if (!btn) return;
    const label = btn.querySelector('span');
    if (label && !label.classList?.contains('nav-badge')) label.textContent = menuLabel(currentPlatform());
    btn.querySelector('[data-testid="pulls-menu-count"]')?.remove();
    if (count > 0) btn.insertAdjacentHTML('beforeend', `<span class="nav-badge pulls-menu-count" data-testid="pulls-menu-count" title="${esc(t('pulls.count_title'))}">${count}</span>`);
  }

  // the next read, one timer at a time; looked up at the time of use (setTimeout is the page's)
  function arm(ms) {
    if (pv.timer) clearTimeout(pv.timer);
    pv.timer = setTimeout(() => { pv.timer = null; read(); }, ms);
  }

  // reads the header's project: the menu's count, and the screen when it is open
  async function read() {
    const projectId = window.CurrentProject?.get();
    const mine = ++pv.seq;
    let answer = null;
    let failed = null;
    try {
      answer = projectId ? await api.listPullRequests(projectId) : { projects: [] };
    } catch (e) { failed = errMsg(e); }
    if (mine !== pv.seq) return;
    pv.answer = answer;
    if (answer) paintMenu(needYouCount(answer));
    if (state.view === 'pulls') render({ answer, failed, projectId });
    arm(failed || (answer?.projects || []).some((p) => p.error) ? RETRY_EVERY : READ_EVERY);
  }

  const refreshCount = () => { read(); };

  // ---- the screen ----------------------------------------------------------------------------

  // the card's buttons, with the same test ids as the run's card; a click is this screen's (data-pull-action)
  function buttonsHtml(pull) {
    const list = window.PrCard.buttons(pull.mergeOptions, { state: pull.state }).filter((b) => ACTIONS[b.id]);
    if (!list.length) return '';
    const row = list.map((b) => `<button type="button" class="btn sm ${b.id === 'merge' ? 'primary' : 'ghost'}" data-testid="${ACTIONS[b.id]}" data-pull-action="${esc(b.id)}" data-url="${esc(pull.url)}" data-number="${esc(pull.number)}"${b.confirm ? ` data-confirm="${esc(b.confirm)}"` : ''} title="${esc(b.confirm || b.label)}">${esc(b.label)}</button>`).join('');
    return `<div class="pr-monitor-actions pulls-actions" role="group" aria-label="${esc(t('pr_card.actions'))}">${row}</div>`;
  }

  // one pull request: its number and title lead, then the PR card's lines (not the comments: the list does not read
  // them), what blocks the merge and its buttons
  function entryHtml(pull) {
    const lines = window.PrCard.lines(pull).filter((l) => l.key !== 'comments').map((l) => window.PrCard.lineHtml(l, `pr-monitor-${l.key}`)).join('');
    const blocked = window.PrCard.blocked(pull);
    const run = pull.runId ? `<button type="button" class="btn sm ghost pulls-run-link" data-testid="pulls-run-link" data-run="${esc(pull.runId)}">${esc(t('pulls.open_run'))}</button>` : '';
    const position = pull.stack ? `<span class="badge pulls-stack-pos">${esc(t('pulls.stack_position', pull.stack))}</span>` : '';
    return `<article class="pulls-entry pr-monitor" data-testid="pulls-entry" data-number="${esc(pull.number)}">
      <div class="pulls-entry-head">
        <a class="mono pulls-number" href="${esc(pull.url)}" target="_blank" rel="noopener" title="${esc(pull.url)}">#${esc(pull.number)}</a>
        <b class="pulls-title" title="${esc(pull.title)}">${esc(pull.title)}</b>${position}
      </div>
      <div class="muted small pulls-meta"><span>${esc(t('pulls.by', { author: pull.author || '?' }))}</span> <span class="mono" title="${esc(`${pull.head} → ${pull.base}`)}">${esc(pull.head)} → ${esc(pull.base)}</span></div>
      <div class="pr-monitor-lines">${lines}</div>
      ${blocked ? `<div class="small muted" data-testid="pr-merge-blocked">${esc(t('pr_card.merge_blocked', { what: blocked }))}</div>` : ''}
      <div class="pulls-entry-actions">${buttonsHtml(pull)}${run}</div>
    </article>`;
  }

  // a group's entries, a stack's PRs wrapped together (the engine lists them bottom first, side by side)
  function entriesHtml(list) {
    let html = '';
    for (let i = 0; i < list.length;) {
      const pull = list[i];
      if (!pull.stack) { html += entryHtml(pull); i += 1; continue; }
      const size = Number(pull.stack.size) || 1;
      const stack = list.slice(i, i + size);
      html += `<div class="pulls-stack" data-testid="pulls-stack" role="group" aria-label="${esc(t('pulls.stack', { size }))}"><div class="muted small pulls-stack-title">${esc(t('pulls.stack', { size }))}</div>${stack.map(entryHtml).join('')}</div>`;
      i += stack.length;
    }
    return html;
  }

  function groupHtml(groups, [key, id, title]) {
    const list = groups?.[key] || [];
    return `<section class="pulls-group" data-testid="pulls-group" data-group="${id}">
      <h2 class="pulls-group-title">${esc(t(title))} <span class="badge">${list.length}</span></h2>
      ${list.length ? entriesHtml(list) : `<p class="muted small">${esc(t('pulls.group_empty'))}</p>`}
    </section>`;
  }

  const emptyHtml = (reason, platform) => {
    const text = reason === 'no_remote' ? t('pulls.empty_no_remote')
      : reason === 'no_cli' ? t('pulls.empty_no_cli', { cli: platformOf(platform)?.cli || '?' }) : t('pulls.empty_none');
    return `<p class="pulls-empty muted" data-testid="pulls-empty" data-reason="${esc(reason || 'none')}">${esc(text)}</p>`;
  };

  function projectHtml(p) {
    if (p.error) return `<p class="error small pulls-project-error" data-testid="pulls-project-error" role="status">${esc(t('pulls.project_unreadable', { name: p.name || p.projectId, error: p.error }))}</p>`;
    const count = GROUPS.reduce((n, [key]) => n + (p.groups?.[key]?.length || 0), 0);
    const empty = p.reason || !count ? emptyHtml(p.reason, p.platform) : '';
    return `${empty}${p.reason ? '' : GROUPS.map((g) => groupHtml(p.groups, g)).join('')}`;
  }

  function render({ answer, failed, projectId }) {
    const box = $('#pulls-body');
    if (!box) return;
    $('#pulls-error').textContent = failed || '';
    if (!projectId) { box.innerHTML = `<p class="muted">${esc(t('pulls.no_project'))}</p>`; return; }
    if (!answer) return;
    box.innerHTML = (answer.projects || []).map(projectHtml).join('') || emptyHtml(null);
  }

  // Merge (no question), Merge ignoring protection and Close (asked first); the list is read again after it
  async function act(btn) {
    if (pv.busy) return;
    const { pullAction: action, url, number, confirm } = btn.dataset;
    if (confirm && !(await confirmDialog(btn.textContent, confirm, btn.textContent))) return;
    const projectId = window.CurrentProject?.get();
    pv.busy = true;
    btn.disabled = true;
    try {
      const r = action === 'close' ? await api.closePullRequest(projectId, url) : await api.mergePullRequest(projectId, url, action === 'merge_admin');
      const done = action === 'close' ? r?.closed : r?.merged;
      if (done) showToast(t(action === 'close' ? 'pulls.closed' : 'pulls.merged', { number }));
      else showToast(t('pulls.action_failed', { number, error: r?.error || (r?.blockers || []).join(', ') || '?' }));
    } catch (e) {
      showToast(t('pulls.action_failed', { number, error: errMsg(e) }));
    } finally {
      pv.busy = false;
      btn.disabled = false;
    }
    await read();
  }

  registerView({
    id: 'pulls',
    nav: { label: 'PRs', order: 46, group: 'build', title: 'Every open pull request of the project, by what it needs from you', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="18" r="2" /><path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-4" /><path d="m13 4-2 2 2 2" /></svg>' },
    markup: () => `
      <section id="view-pulls" class="view hidden" data-testid="pulls-screen">
        <div class="page-head">
          <div>
            <h1 id="pulls-heading">${t('nav.pulls')}</h1>
            <p class="muted small">${t('pulls.subtitle')}</p>
          </div>
          <button type="button" id="pulls-refresh" class="btn sm ghost" data-testid="pulls-refresh">${t('pulls.refresh')}</button>
        </div>
        <p id="pulls-error" class="error small" role="status"></p>
        <div id="pulls-body" class="pulls-body"><p class="muted small">${t('pulls.loading')}</p></div>
      </section>`,
    mount() {
      // a language change repaints the menu with nav.pulls ("PRs", view-registry.js relabelNav): MRs and the count
      // come back right after it (I18n.notify runs once the menu is relabelled)
      window.I18n?.onChange?.(() => paintMenu(needYouCount(pv.answer)));
      $('#pulls-refresh').addEventListener('click', () => read());
      $('#pulls-body').addEventListener('click', (e) => {
        const action = e.target.closest('[data-pull-action]');
        const run = e.target.closest('[data-testid="pulls-run-link"]');
        if (action) act(action);
        else if (run) window.showRun(run.dataset.run);
      });
    },
    show() {
      const heading = $('#pulls-heading');
      if (heading) heading.textContent = menuLabel(currentPlatform());
      if (pv.answer) render({ answer: pv.answer, failed: null, projectId: window.CurrentProject?.get() });
      return read();
    },
  });

  window.PullsView = { menuLabel, needYouCount, refreshCount };
})();
