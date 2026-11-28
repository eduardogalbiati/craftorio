// The Code & Build front's Home card (phase 3 of docs/reorganisation-study-2026-10.md, decision 5;
// the kit's home-cards.js): the flow strip's Backlog To do, Running, Merged locally and Released
// stages with their counts (a count opens the board's column, Workflows › Runs on the project's runs
// in progress, or the Releases screen), the "What needs you" rows of the roadmap (its runs waiting at
// a gate in another app, its failed items, each with Open run / Open roadmap; the Home redesign of 2026-11-28: the PRs
// that need the owner, with Open PRs) and three blocks shown only with content (Now: the project's runs in progress;
// Roadmap: the current stage as a bar; Next release: what merged locally, with the release checks). A composition
// without this front shows none of it. Uses the globals of app.js
// (state, showView, viewRegistry, t) at call time, packages/shared/roadmap-model.js and
// backlog-archive.js, and the Backlog's window.BacklogActions (views/backlog/backlog.js).
(function () {
  const list = (v) => (Array.isArray(v) ? v : []);
  // the roadmap's items, each with its stage's number (1-based, #555: the release entries not counted) and name
  const items = (own) => list(own.backlog?.roadmap?.stages).flatMap((s, n) => {
    const number = RoadmapModel.stageNumber(own.backlog.roadmap, n);
    return list(s.items).map((x) => ({ ...x, stage: number, stageName: s.name || t('dashboard.stage_n', { n: number }) }));
  });
  // "#21 Refund a failed payment" (+ how many more), else the item's workflow
  function itemTitle(x) {
    const issues = list(x.issues);
    if (!issues.length) return x.workflow || 'Roadmap item';
    return `#${issues[0].number}${issues[0].title ? ` ${issues[0].title}` : ''}${issues.length > 1 ? ` +${issues.length - 1} more` : ''}`;
  }
  // the board's columns: no epic (#253), no archived issue (#238)
  const onBoard = (i) => !i.isEpic && window.BacklogArchive?.issueState(i) !== 'archived';
  const column = (own, id) => list(own.backlog?.issues).filter((i) => onBoard(i) && (i.column || (i.state === 'closed' ? 'done' : 'todo')) === id);
  // The project's runs in progress: this app's, and the roadmap's items running in another app.
  function running(own, d) {
    const ids = new Set(list(d.active).filter((r) => (r.projectId || r.project_id) === d.projectId).map((r) => r.runId));
    for (const x of items(own)) if (x.status === 'running' && x.runId) ids.add(x.runId);
    return ids;
  }
  // merged locally: the board's column, and the issues of the commits not pushed yet (a simulated
  // run never moves a card, its local merge still waits for a push)
  const merged = (own) => new Set([...column(own, 'local').map((i) => i.number), ...list(own.backlog?.local?.issues)]);
  // the board's columns for this visit only, the remembered mode kept
  const openBoard = () => { window.BacklogActions?.showColumns(); showView('backlog'); };

  // The Home redesign (2026-11-28): the PRs that need the owner (the PRs screen's "Need you" group: ready to merge,
  // a conflict, changes requested), read at most every 5 minutes (the platform's CLI), per project
  const PR_EVERY_MS = 5 * 60e3;
  const prs = { projectId: null, at: 0, value: null };
  async function readPulls(projectId, api, read) {
    if (!projectId || typeof api.listPullRequests !== 'function') return null;
    if (prs.projectId === projectId && Date.now() - prs.at < PR_EVERY_MS) return prs.value;
    const answer = await read(() => api.listPullRequests(projectId));
    Object.assign(prs, { projectId, at: Date.now(), value: list(answer?.projects?.[0]?.groups?.needYou) });
    return prs.value;
  }
  const prWhy = (p) => (p.state === 'conflict' ? t('dashboard.pr_conflict') : p.review?.status === 'changes_requested' ? t('dashboard.pr_changes_requested') : t('dashboard.pr_ready'));
  // the elapsed time of a run in progress, "12:41" (minutes:seconds), "1:02:05" past an hour
  const elapsed = (iso) => {
    const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    const two = (n) => String(n).padStart(2, '0');
    return s >= 3600 ? `${Math.floor(s / 3600)}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${Math.floor(s / 60)}:${two(s % 60)}`;
  };
  const shown = (s) => esc(String(s ?? ''));
  // Now: the project's runs in progress in this app (the step each is at, waiting or not, its time), each opening its run
  function nowBlock(d) {
    const live = list(d.active).filter((r) => (r.projectId || r.project_id) === d.projectId && r.status === 'running');
    if (!live.length) return null;
    const rows = live.map((r) => {
      const v = state.runs.get(r.runId);
      const step = v?.trail?.steps?.at(-1)?.step;
      const where = step ? (typeof displayName === 'function' ? displayName(step, v?.run?.stepNames) : step) : t('dashboard.starting');
      const pill = StatusPill.statusPill(r.waiting ? 'waiting' : 'running');
      return `<button type="button" class="home-live" data-testid="home-live-run" data-home-run="${shown(r.runId)}"><span class="home-live-text"><b>${shown(r.title || r.workflow)}</b><span class="muted small">${shown(where)}</span></span>${pill}<span class="mono small muted">${r.startedAt ? elapsed(r.startedAt) : ''}</span></button>`;
    }).join('');
    return { id: 'now', order: 10, html: `<div class="home-card-head"><h2 class="home-card-title">${t('dashboard.now')}</h2><span class="muted small">${shown(t('dashboard.n_runs_running', { count: live.length }))}</span><span class="spacer"></span><button type="button" class="link-btn small" data-stage="running">${t('dashboard.view_runs')}</button></div>${rows}` };
  }
  // Roadmap: the stage with work left, its items as a bar (done, running, waiting for you, failed, to do)
  function roadmapBlock(own) {
    const stages = list(own.backlog?.roadmap?.stages);
    const at = RoadmapModel.currentStage({ stages });
    if (at < 0 || !list(stages[at].items).length) return null;
    const its = list(stages[at].items);
    const n = (f) => its.filter(f).length;
    const parts = [
      ['done', n((x) => ['done', 'merged', 'success', 'local', 'released'].includes(x.status))],
      ['running', n((x) => x.status === 'running' && !x.waiting)],
      ['waiting', n((x) => x.status === 'running' && x.waiting)],
      ['failed', n((x) => x.status === 'failed')],
    ];
    const number = RoadmapModel.stageNumber({ stages }, at);
    const name = stages[at].name || t('dashboard.stage_n', { n: number });
    const bar = parts.filter(([, c]) => c).map(([k, c]) => `<span class="home-bar-${k}" style="flex: ${c}"></span>`).join('');
    const rest = its.length - parts.reduce((a, [, c]) => a + c, 0);
    const summary = t('dashboard.roadmap_summary', { done: parts[0][1], all: its.length, running: parts[1][1], waiting: parts[2][1], failed: parts[3][1] });
    return { id: 'roadmap', order: 20, html: `<div class="home-card-head"><h2 class="home-card-title">${t('dashboard.roadmap')}</h2><span class="muted small">${shown(t('dashboard.stage_name', { n: number, name }))}</span><span class="spacer"></span><button type="button" class="link-btn small" data-home-roadmap="${number}">${t('dashboard.open')}</button></div>
      <div class="home-bar" role="img" aria-label="${shown(summary)}">${bar}${rest > 0 ? `<span class="home-bar-todo" style="flex: ${rest}"></span>` : ''}</div><span class="muted small">${shown(summary)}</span>` };
  }
  // Next release: what merged locally and is not pushed yet, with the Releases screen's checks
  function releaseBlock(own) {
    const count = merged(own).size;
    if (!count || !viewRegistry.has('releases')) return null;
    return { id: 'release', order: 30, html: `<div class="home-card-head"><h2 class="home-card-title">${t('dashboard.next_release')}</h2></div>
      <span class="small">${shown(t('dashboard.n_issues_merged_locally', { count }))}</span>
      <div class="row"><button type="button" class="btn sm" data-home-release="checks">${t('dashboard.run_the_release_checks')}</button></div>` };
  }

  window.HomeCards.register({
    id: 'build',
    order: 20,
    async read({ projectId, api, read }) {
      const [backlog, releases, pulls] = await Promise.all([
        read(() => projectId && api.getBacklog(projectId)),
        read(() => projectId && api.listReleases(projectId)),
        readPulls(projectId, api, read),
      ]);
      return { backlog: backlog || null, releases: releases || null, pulls: list(pulls) };
    },
    stages: [
      { id: 'todo', order: 40, view: 'backlog', count: (own) => column(own, 'todo').length, open: openBoard },
      {
        id: 'running',
        order: 50,
        view: 'workflows',
        count: (own, d) => running(own, d).size,
        // the runs in progress of the header's project (the search matches its name), simulated ones included
        open: (own, d) => {
          state.workflowsTab = 'runs';
          Object.assign(state.wr, { filter: 'running', showSim: true, workflow: '', q: state.projects.find((p) => p.id === d.projectId)?.name || '' });
          showView('workflows');
        },
      },
      { id: 'merged', order: 60, view: 'backlog', count: (own) => merged(own).size, open: openBoard },
      { id: 'released', order: 70, view: 'releases', count: (own) => list(own.releases?.releases).length },
    ],
    needs(own, d, shell) {
      const mine = new Set(shell?.gates || []);
      const all = items(own);
      // the roadmap's runs waiting at a gate in another app: opened there, shown here
      const elsewhere = all.filter((x) => x.status === 'running' && x.waiting && x.runId && !mine.has(x.runId)).map((x) => ({
        kind: 'gate', order: 20, since: x.run?.progress?.at(-1)?.ts || x.run?.startedAt || null, phoneUrl: null,
        title: itemTitle(x), detail: x.run?.gate || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
        button: { label: t('dashboard.open_run'), attr: 'data-home-run', value: x.runId, primary: true },
      }));
      const failed = all.filter((x) => x.status === 'failed').map((x) => ({
        kind: 'failed-item', order: 50, title: itemTitle(x), detail: x.error || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
        button: { label: t('dashboard.open_roadmap'), attr: 'data-home-roadmap', value: String(x.stage) },
      }));
      // the Home redesign: the PRs that need the owner, each opening the PRs screen (its Merge asks there)
      const pulls = list(own.pulls).map((p) => ({
        kind: 'pr', order: 25, since: p.updatedAt || null,
        title: `${p.number ? `#${p.number} ` : ''}${p.title || ''}`.trim() || t('dashboard.badge_pr'), detail: prWhy(p),
        button: { label: t('dashboard.open_prs'), attr: 'data-home-pulls', value: String(p.number || ''), primary: true },
      }));
      return [...elsewhere, ...pulls, ...failed];
    },
    // the Home redesign (2026-11-28): Now, Roadmap and Next release, each only while it has something to show
    // (the roadmap's next stage left "Last 24 hours": the Roadmap block names it)
    blocks: (own, d) => [nowBlock(d), roadmapBlock(own), releaseBlock(own)].filter(Boolean),
    actions: {
      'data-home-roadmap': (stage) => window.BacklogActions?.openStage(Number(stage)),
      'data-home-pulls': () => showView('pulls'),
      'data-home-release': () => showView('releases'),
    },
  });
})();
